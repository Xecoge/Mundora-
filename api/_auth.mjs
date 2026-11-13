// TEMPO — аккаунты, сессии, код доступа. Работает и в Edge, и в Node (только Web Crypto + fetch).
import { kv, kvMulti, jget, jset, dbReady } from './_store.mjs';

export const ENV = () => (typeof process !== 'undefined' && process.env) || {};
export const ADMIN = () => String(ENV().ADMIN_EMAIL || 'protakolov@gmail.com').trim().toLowerCase();
export const SUPPORT = () => String(ENV().SUPPORT_EMAIL || 'mundoraaiapp@gmail.com').trim();
export const SESSION_DAYS = 180;
export const STATUS_RU = { active: 'активен', frozen: 'заморожен', blocked: 'заблокирован', banned: 'забанен' };

const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64uStr = s => b64u(enc.encode(s));
export const unb64uStr = s => { try { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))); } catch (e) { return ''; } };
export const rand = (n = 24) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const code6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
export const normEmail = e => String(e || '').trim().toLowerCase();
export const okEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);

// Секрет для подписи: AUTH_SECRET из окружения или создаётся один раз и хранится в базе
let KEY = null;
async function key() {
  if (KEY) return KEY;
  let s = ENV().AUTH_SECRET;
  if (!s) { await kv('SET', 'sys:secret', rand(32), 'NX'); s = await kv('GET', 'sys:secret'); }
  KEY = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return KEY;
}
export async function sign(data) { return b64u(await crypto.subtle.sign('HMAC', await key(), enc.encode(data))); }
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export async function signed(payload) { return payload + '.' + await sign(payload); }
export async function unsign(tok) { if (!tok) return null; const i = tok.lastIndexOf('.'); if (i < 0) return null; const p = tok.slice(0, i); return eq(tok.slice(i + 1), await sign(p)) ? p : null; }

export async function hashPass(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256));
}

// ---------- cookies ----------
export function cookies(req) { const o = {}; (req.headers.get('cookie') || '').split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); }); return o; }
const isHttps = req => (req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '')) === 'https';
export const setCookie = (req, name, val, days) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(days * 86400)}${isHttps(req) ? '; Secure' : ''}`;
export const clearCookie = (req, name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
export const ipOf = req => (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'local').split(',')[0].trim();

// ---------- пользователи и сессии ----------
export const getUser = email => jget('u:' + email);
export const putUser = u => jset('u:' + u.email, u);

export async function createSession(req, email) {
  const sid = rand(18), exp = Date.now() + SESSION_DAYS * 864e5;
  await kvMulti([
    ['SET', 's:' + sid, JSON.stringify({ email, t: Date.now(), ua: (req.headers.get('user-agent') || '').slice(0, 160), ip: ipOf(req) }), 'EX', SESSION_DAYS * 86400],
    ['SADD', 'us:' + email, sid]
  ]);
  const tok = await signed(`${sid}.${b64uStr(email)}.${exp}`);
  return setCookie(req, 'tempo_s', tok, SESSION_DAYS);
}
// Быстрая проверка подписи (без базы) — для музыки, крипты
export async function sessionFromCookie(req) {
  const p = await unsign(cookies(req).tempo_s); if (!p) return null;
  const [sid, em, exp] = p.split('.'); if (!sid || +exp < Date.now()) return null;
  return { sid, email: unb64uStr(em) };
}
// Полная проверка: сессия есть в базе + данные аккаунта
export async function currentUser(req) {
  const s = await sessionFromCookie(req); if (!s) return null;
  const [sess, u] = await kvMulti([['GET', 's:' + s.sid], ['GET', 'u:' + s.email]]);
  if (!sess || !u) return null;
  const user = JSON.parse(u);
  return { ...user, sid: s.sid, admin: user.email === ADMIN() };
}
export async function dropSessions(email) {
  const sids = await kv('SMEMBERS', 'us:' + email);
  await kvMulti([...sids.map(s => ['DEL', 's:' + s]), ['DEL', 'us:' + email]]);
}
export async function touch(u) { if (Date.now() - (u.seen || 0) > 5 * 60e3) { u.seen = Date.now(); const { sid, admin, ...rest } = u; await putUser(rest); } }

// Проход через код доступа (на устройстве)
export async function gatePassed(req) { const p = await unsign(cookies(req).tempo_g); return !!(p && p.startsWith('g:')); }

export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const jsonC = (obj, cookiesArr, status = 200) => { const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); cookiesArr.forEach(c => h.append('set-cookie', c)); return new Response(JSON.stringify(obj), { status, headers: h }); };

// Защита API (музыка, крипта, ИИ): пускаем только вошедших
export async function guard(req, full = false) {
  if (!dbReady()) return { res: json({ error: 'База данных не подключена' }, 503) };
  try {
    if (full) {
      const u = await currentUser(req);
      if (!u) return { res: json({ error: 'Нужно войти в аккаунт' }, 401) };
      if (u.status === 'blocked' || u.status === 'banned') return { res: json({ error: 'Аккаунт ' + STATUS_RU[u.status] }, 403) };
      return { user: u };
    }
    const s = await sessionFromCookie(req);
    return s ? { user: s } : { res: json({ error: 'Нужно войти в аккаунт' }, 401) };
  } catch (e) { return { res: json({ error: 'Ошибка проверки входа: ' + e.message }, 500) }; }
}
