// Mundora — вход на сайт: код доступа, регистрация и вход по почте с кодом из письма.
// Переменные окружения (Vercel → Settings → Environment Variables):
//   ACCESS_CODE — стартовый код доступа (например 2134). Срабатывает ОДИН раз, дальше коды создаёт админ.
//   ADMIN_EMAIL — почта админа (по умолчанию protakolov@gmail.com)
//   SMTP_USER / SMTP_PASS — почта, с которой уходят коды (Gmail + пароль приложения)
//   + база данных Upstash Redis (см. api/_store.mjs)
import { kv, kvMulti, jget, jset, limit, dbReady } from './_store.mjs';
import { mailReady, sendMail, codeMail } from './_mail.mjs';
import { checkName, claimName } from './_names.mjs';
import {
  ENV, ADMIN, SUPPORT, STATUS_RU, rand, code6, normEmail, okEmail, sign, signed, unsign, hashPass, cookies, setCookie, clearCookie,
  ipOf, getUser, putUser, ensureId, gateInfo, accessExpired, displayName, createSession, currentUser, sessionFromCookie, gatePassed, json, jsonC, b64uStr, unb64uStr
} from './_auth.mjs';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const CODE_TTL = 600, RESEND_GAP = 45;
const err = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);
const normCode = c => String(c || '').trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, '');

async function banInfo(req) {
  // устройство, где уже был забанен аккаунт
  const p = await unsign(cookies(req).tempo_b); if (!p) return null;
  const email = unb64uStr(p.slice(2)); const u = email && await getUser(email);
  return u && u.status === 'banned' ? email : null;
}
const banCookie = async (req, email) => setCookie(req, 'tempo_b', await signed('b:' + b64uStr(email)), 3650);

async function sendCode(req, email, kind, extra = {}) {
  if (!mailReady()) throw Object.assign(new Error('Почта на сервере не настроена: добавь SMTP_USER и SMTP_PASS в Vercel'), { status: 503 });
  const prev = await jget('p:' + email);
  if (prev && Date.now() - prev.sent < RESEND_GAP * 1000) {
    const wait = Math.ceil((RESEND_GAP * 1000 - (Date.now() - prev.sent)) / 1000);
    if (prev.kind === kind) { if (Object.keys(extra).length) await jset('p:' + email, { ...prev, ...extra }, CODE_TTL); return { wait }; }
  }
  if (!(await limit('mail:' + email, 8, 3600))) throw Object.assign(new Error('Слишком много писем на эту почту. Попробуй через час'), { status: 429 });
  const code = code6();
  await jset('p:' + email, { kind, h: await sign('c:' + email + ':' + code), tries: 0, sent: Date.now(), ...extra }, CODE_TTL);
  await sendMail(email, codeMail(code, kind));
  if (ENV().MAIL_DEV) console.log(`  код для ${email}: ${code}`);
  return { wait: RESEND_GAP };
}

async function handle(req) {
  const url = new URL(req.url); const a = url.searchParams.get('a') || '';
  if (!dbReady()) return a === 'state' ? json({ db: false, mail: mailReady(), code: !!ENV().ACCESS_CODE }) : err('База данных не подключена: Vercel → Storage → Upstash for Redis', 503);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const ip = ipOf(req);

  if (a === 'state') {
    const u = await currentUser(req).catch(() => null);
    const banned = await banInfo(req);
    return json({ db: true, mail: mailReady(), code: !!ENV().ACCESS_CODE || (await kv('SCARD', 'codes')) > 0, gate: await gatePassed(req), user: u ? { email: u.email, status: u.status, expired: accessExpired(u), until: u.accessUntil || 0, name: u.name ? u.name : '' } : null, banned, support: SUPPORT() });
  }

  if (a === 'gate') {
    if (!(await limit('gate:' + ip, 8, 900))) return err('Слишком много попыток. Подожди 15 минут', 429);
    const c = normCode(body.code); if (c.length !== 4) return err('Код — 4 символа');
    let ok = false, days = 0;
    const envCode = normCode(ENV().ACCESS_CODE);
    if (envCode && c === envCode) {
      // стартовый код из Vercel — срабатывает один раз
      ok = (await kv('SET', 'gate:env:' + envCode, JSON.stringify({ t: Date.now(), ip }), 'NX')) === 'OK';
    }
    if (!ok) {
      const rec = await jget('code:' + c);
      if (rec && (!rec.max || (rec.used || 0) < rec.max)) {
        rec.used = (rec.used || 0) + 1; rec.last = Date.now(); await jset('code:' + c, rec); ok = true; days = +rec.days || 0;
      }
    }
    if (!ok) return err('Неверный или уже использованный код', 403);
    // вошедший человек с закончившимся доступом — продлеваем аккаунт
    const me = await currentUser(req).catch(() => null);
    let renewed = false;
    if (me) { const u = await getUser(me.email); u.accessUntil = days ? Date.now() + days * 864e5 : null; if (!u.accessUntil) delete u.accessUntil; await putUser(u); renewed = true; }
    return jsonC({ ok: true, days, renewed }, [setCookie(req, 'tempo_g', await signed('g:' + rand(9) + ':' + days), 3650)]);
  }

  if (a === 'register' || a === 'login' || a === 'forgot') {
    const email = normEmail(body.email), pw = String(body.password || '');
    if (!okEmail(email)) return err('Проверь адрес почты');
    if (!(await limit('auth:' + ip, 30, 3600))) return err('Слишком много попыток. Попробуй позже', 429);
    const u = await getUser(email);
    if (u && u.status === 'banned') return jsonC({ error: 'Аккаунт забанен', banned: email, support: SUPPORT() }, [await banCookie(req, email)], 403);
    if (a === 'register') {
      if (!(await gatePassed(req))) return err('Сначала введи код доступа', 403, { needGate: true });
      if (await banInfo(req)) return err('С этого устройства регистрация недоступна', 403);
      if (u) return err('Аккаунт с этой почтой уже есть — войди', 409, { exists: true });
      if (pw.length < 6) return err('Пароль — минимум 6 символов');
      const nc = await checkName(body.name, email);
      if (!nc.ok) return err(nc.reason, 400, { field: 'name' });
      const gi = await gateInfo(req);
      const salt = rand(12);
      const r = await sendCode(req, email, 'reg', { salt, hash: await hashPass(pw, salt), name: nc.name, days: gi.days });
      return json({ ok: true, step: 'code', ...r });
    }
    if (!u) return err('Аккаунт не найден — создай его', 404, { missing: true });
    if (a === 'login') {
      if (!(await limit('pw:' + email, 10, 900))) return err('Слишком много попыток входа. Подожди 15 минут', 429);
      if (await hashPass(pw, u.salt) !== u.hash) return err('Неверный пароль', 403);
      if (u.status === 'blocked') return err('Аккаунт заблокирован администратором', 403, { blocked: email, support: SUPPORT() });
      const r = await sendCode(req, email, 'login');
      return json({ ok: true, step: 'code', ...r });
    }
    const r = await sendCode(req, email, 'reset');
    return json({ ok: true, step: 'code', ...r });
  }

  if (a === 'resend') {
    const email = normEmail(body.email); const p = await jget('p:' + email);
    if (!p) return err('Код устарел — начни заново', 410);
    const { kind, h, tries, sent, ...extra } = p;
    const r = await sendCode(req, email, kind, extra);
    return json({ ok: true, ...r });
  }

  if (a === 'verify') {
    const email = normEmail(body.email), c = String(body.code || '').replace(/\D/g, '');
    const p = await jget('p:' + email);
    if (!p) return err('Код устарел — запроси новый', 410);
    if (p.tries >= 5) { await kv('DEL', 'p:' + email); return err('Слишком много неверных попыток — запроси новый код', 429); }
    if (c.length !== 6 || await sign('c:' + email + ':' + c) !== p.h) {
      p.tries++; await jset('p:' + email, p, CODE_TTL);
      return err(`Неверный код. Осталось попыток: ${5 - p.tries}`, 403);
    }
    let u = await getUser(email);
    if (p.kind === 'reg') {
      if (u) return err('Аккаунт уже создан — войди', 409);
      u = { email, salt: p.salt, hash: p.hash, created: Date.now(), seen: Date.now(), status: 'active' };
      if (p.name && await claimName(p.name, email)) u.name = p.name;
      if (p.days) u.accessUntil = Date.now() + p.days * 864e5;
      await putUser(u); await kv('SADD', 'users', email); await ensureId(u);
    } else if (p.kind === 'reset') {
      const pw = String(body.password || '');
      if (pw.length < 6) return err('Новый пароль — минимум 6 символов');
      u.salt = rand(12); u.hash = await hashPass(pw, u.salt); await putUser(u);
    }
    if (!u) return err('Аккаунт не найден', 404);
    if (u.status === 'banned') return jsonC({ error: 'Аккаунт забанен', banned: email }, [await banCookie(req, email)], 403);
    if (u.status === 'blocked') return err('Аккаунт заблокирован администратором', 403, { blocked: email, support: SUPPORT() });
    await kv('DEL', 'p:' + email);
    const cs = [await createSession(req, email)];
    if (!(await gatePassed(req))) cs.push(setCookie(req, 'tempo_g', await signed('g:' + rand(9)), 3650));
    return jsonC({ ok: true, admin: email === ADMIN() }, cs);
  }

  if (a === 'check') { // проверить код до ввода нового пароля
    const email = normEmail(body.email), c = String(body.code || '').replace(/\D/g, '');
    const p = await jget('p:' + email);
    if (!p) return err('Код устарел — запроси новый', 410);
    if (c.length !== 6 || await sign('c:' + email + ':' + c) !== p.h) { p.tries++; await jset('p:' + email, p, CODE_TTL); return err(`Неверный код. Осталось попыток: ${Math.max(0, 5 - p.tries)}`, 403); }
    return json({ ok: true });
  }

  if (a === 'name') {
    if (!(await limit('nm:' + ip, 40, 600))) return err('Слишком много проверок, подожди', 429);
    const r = await checkName(body.name, normEmail(body.email));
    return json(r.ok ? { ok: true, name: r.name } : { ok: false, error: r.reason });
  }

  if (a === 'logout') {
    const s = await sessionFromCookie(req);
    if (s) await kvMulti([['DEL', 's:' + s.sid], ['SREM', 'us:' + s.email, s.sid]]);
    return jsonC({ ok: true }, [clearCookie(req, 'tempo_s')]);
  }

  if (a === 'me') {
    const u = await currentUser(req);
    return u ? json({ email: u.email, status: u.status, admin: u.admin }) : err('Не выполнен вход', 401);
  }
  return err('Неизвестное действие', 404);
}

export async function handler(req) {
  try { return await handle(req); }
  catch (e) { return json({ error: e.message || 'Ошибка сервера' }, e.status || 500); }
}
export const GET = handler, POST = handler;
