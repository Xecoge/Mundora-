// TEMPO — отправка писем с кодом. Только для Node (Vercel Node.js function или локальный server.js).
// Вариант 1 (Gmail): SMTP_USER=mundoraaiapp@gmail.com, SMTP_PASS=пароль приложения Google (16 букв).
//   Необязательно: SMTP_HOST (smtp.gmail.com), SMTP_PORT (465), MAIL_FROM.
// Вариант 2: BREVO_API_KEY (brevo.com) + MAIL_FROM — подтверждённый отправитель.
// Вариант 3: RESEND_API_KEY (+ MAIL_FROM с подтверждённым доменом).
import tls from 'node:tls';
import net from 'node:net';

const ENV = () => process.env;
export const mailReady = () => !!((ENV().SMTP_USER && ENV().SMTP_PASS) || ENV().BREVO_API_KEY || ENV().RESEND_API_KEY || ENV().MAIL_DEV);

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
const encH = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;

function smtp({ host, port, user, pass, from, fromName, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const secure = +port === 465;
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', waiters = [], done = false;
    const fail = e => { if (done) return; done = true; try { sock.destroy(); } catch (x) {} reject(e); };
    const timer = setTimeout(() => fail(new Error('почтовый сервер не ответил')), 20000);
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      for (;;) {
        const lines = buf.split('\r\n'); let end = -1;
        for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i])) { end = i; break; }
        if (end < 0) break;
        const resp = lines.slice(0, end + 1).join('\n'); buf = lines.slice(end + 1).join('\r\n');
        const w = waiters.shift(); if (w) w(resp);
      }
    });
    sock.on('error', fail);
    const read = () => new Promise(r => waiters.push(r));
    const cmd = async (line, ok) => { if (line != null) sock.write(line + '\r\n'); const r = await read(); if (!ok.test(r)) throw new Error('SMTP: ' + r.split('\n').pop()); return r; };
    (async () => {
      await cmd(null, /^220/);
      await cmd('EHLO tempo.local', /^250/);
      await cmd('AUTH LOGIN', /^334/);
      await cmd(b64(user), /^334/);
      await cmd(b64(pass), /^235/);
      await cmd(`MAIL FROM:<${from}>`, /^250/);
      await cmd(`RCPT TO:<${to}>`, /^25[01]/);
      await cmd('DATA', /^354/);
      const bd = 'b' + Math.random().toString(36).slice(2);
      const msg = [
        `From: ${encH(fromName)} <${from}>`, `To: <${to}>`, `Subject: ${encH(subject)}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@tempo>`,
        'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${bd}"`, '',
        `--${bd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
        `--${bd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html)),
        `--${bd}--`, ''
      ].join('\r\n');
      await cmd(msg + '\r\n.', /^250/);
      sock.write('QUIT\r\n'); done = true; clearTimeout(timer); sock.end(); resolve();
    })().catch(e => { clearTimeout(timer); fail(e); });
  });
}

export function codeMail(code, kind) {
  const what = kind === 'reg' ? 'создания аккаунта' : kind === 'reset' ? 'смены пароля' : 'входа';
  const subject = `${code} — код для ${what} в TEMPO`;
  const text = `Твой код для ${what} в TEMPO: ${code}\n\nКод действует 10 минут. Если это был не ты — просто проигнорируй письмо.`;
  const html = `<!doctype html><html><body style="margin:0;background:#0d0a1a;padding:28px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="420" cellspacing="0" cellpadding="0" style="max-width:420px;width:100%;background:#17122b;border:1px solid #2f2650;border-radius:22px">
<tr><td style="padding:30px 28px 8px;text-align:center">
<div style="display:inline-block;padding:7px 14px;border-radius:999px;background:#241b45;color:#c4b5fd;font-weight:800;letter-spacing:.14em;font-size:12px">TEMPO</div>
<h1 style="margin:18px 0 6px;color:#fff;font-size:21px">Код для ${what}</h1>
<p style="margin:0;color:#a59bc8;font-size:14px">Введи его на сайте — или просто вставь, он проверится сам</p></td></tr>
<tr><td style="padding:18px 28px 6px;text-align:center"><div style="display:inline-block;padding:16px 22px;border-radius:16px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-size:34px;font-weight:800;letter-spacing:.32em;font-family:Menlo,Consolas,monospace">${code}</div></td></tr>
<tr><td style="padding:14px 28px 28px;text-align:center;color:#8b82ad;font-size:12.5px;line-height:1.55">Код действует 10 минут.<br>Если это был не ты — просто проигнорируй письмо.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendMail(to, { subject, text, html }) {
  const e = ENV();
  const from = e.MAIL_FROM || e.SMTP_USER || 'mundoraaiapp@gmail.com', fromName = e.MAIL_FROM_NAME || 'TEMPO';
  if (e.SMTP_USER && e.SMTP_PASS) {
    return smtp({ host: e.SMTP_HOST || 'smtp.gmail.com', port: +(e.SMTP_PORT || 465), user: e.SMTP_USER, pass: String(e.SMTP_PASS).replace(/\s+/g, ''), from, fromName, to, subject, text, html });
  }
  if (e.BREVO_API_KEY) {
    // Brevo (brevo.com): ключ из SMTP & API → API Keys; отправитель MAIL_FROM должен быть подтверждён в Brevo → Senders
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': e.BREVO_API_KEY.trim(), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: fromName, email: e.MAIL_FROM || 'mundoraaiapp@gmail.com' }, to: [{ email: to }], subject, htmlContent: html, textContent: text }) });
    if (!r.ok) throw new Error('Brevo: ' + (await r.text()).slice(0, 200));
    return;
  }
  if (e.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + e.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html }) });
    if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
    return;
  }
  if (e.MAIL_DEV) { console.log(`\n  [почта → ${to}] ${subject}\n`); return; }
  throw new Error('Почта не настроена на сервере (SMTP_USER и SMTP_PASS)');
}
