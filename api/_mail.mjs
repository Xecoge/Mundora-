// Mundora — отправка писем с кодом. Только для Node (Vercel Node.js function или локальный server.js).
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
  const site = String(process.env.SITE_URL || 'https://mundorai.vercel.app').replace(/\/+$/, '');
  const what = kind === 'reg' ? 'create your account' : kind === 'reset' ? 'reset your password' : 'sign in';
  const title = kind === 'reg' ? 'Welcome to Mundora' : kind === 'reset' ? 'Reset your password' : 'Your sign-in code';
  const subject = `${code} is your Mundora code`;
  const text = `${title}\n\nUse this code to ${what}: ${code}\n\nIt expires in 10 minutes. If you didn't request it, just ignore this email.\n\n— Mundora\n${site}`;
  const spaced = code.split('').join('&#8202;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${subject}</title></head>
<body style="margin:0;background:#07040f;padding:32px 12px;font-family:-apple-system,'Segoe UI',Roboto,Inter,Arial,sans-serif;color:#fbf9ff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your code is ${code}. It expires in 10 minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="440" cellspacing="0" cellpadding="0" style="max-width:440px;width:100%;background:#140c26;background-image:linear-gradient(160deg,#2a1752,#120a22 60%);border:1px solid #33255c;border-radius:28px">
<tr><td style="padding:30px 28px 4px;text-align:center"><img src="${site}/img/logo-mail.png" width="150" alt="Mundora" style="display:block;margin:0 auto;width:150px;height:auto;border:0"></td></tr>
<tr><td style="padding:10px 28px 0;text-align:center">
<h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;letter-spacing:-.3px">${title}</h1>
<p style="margin:0;color:#b3aacf;font-size:15px;line-height:1.5">Use this code to ${what}.<br>You can type it in or simply paste it — it's checked instantly.</p></td></tr>
<tr><td style="padding:22px 28px 6px;text-align:center"><div style="display:inline-block;padding:16px 26px;border-radius:20px;background:#ffffff;color:#1c0b3d;font-size:36px;font-weight:800;letter-spacing:.28em;font-family:'SF Mono',Menlo,Consolas,monospace">${spaced}</div></td></tr>
<tr><td style="padding:14px 28px 0;text-align:center;color:#8f86ad;font-size:13px;line-height:1.6">This code expires in <b style="color:#d6c4ff">10 minutes</b>.<br>If you didn't request it, you can safely ignore this email.</td></tr>
<tr><td style="padding:22px 28px 28px;text-align:center"><a href="${site}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:linear-gradient(120deg,#b98bff,#ff6ec7);color:#ffffff;font-weight:700;font-size:14px;text-decoration:none">Open Mundora</a></td></tr>
</table>
<p style="margin:18px 0 0;color:#5f587a;font-size:12px;line-height:1.6">Mundora — music, money, crypto and AI in one place.<br>Need help? Write to <a href="mailto:mundoraaiapp@gmail.com" style="color:#9b8cc9">mundoraaiapp@gmail.com</a></p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendMail(to, { subject, text, html }) {
  const e = ENV();
  const from = e.MAIL_FROM || e.SMTP_USER || 'mundoraaiapp@gmail.com', fromName = e.MAIL_FROM_NAME || 'Mundora';
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
