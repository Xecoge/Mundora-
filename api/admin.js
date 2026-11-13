// TEMPO — админ-панель (только для ADMIN_EMAIL): коды доступа и аккаунты.
import { kv, kvMulti, jget, jset, pairs } from './_store.mjs';
import { guard, json, getUser, putUser, dropSessions, ADMIN, ensureId, displayName, normEmail } from './_auth.mjs';
export const config = { runtime: 'edge' };

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = c => String(c || '').trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, '');
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALPH[b % ALPH.length]).join('');

export default async function handler(req) {
  const g = await guard(req, true); if (g.res) return g.res;
  if (!g.user.admin) return json({ error: 'Только для администратора' }, 403);
  const url = new URL(req.url), a = url.searchParams.get('a') || '';
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  try {
    if (a === 'overview') {
      const [emails, codes, admins] = await kvMulti([['SMEMBERS', 'users'], ['SMEMBERS', 'codes'], ['SMEMBERS', 'admins']]);
      const adm = new Set(admins);
      const res = await kvMulti([...emails.map(e => ['GET', 'u:' + e]), ...emails.map(e => ['SCARD', 'us:' + e]), ...emails.map(e => ['HLEN', 'd:' + e]), ...codes.map(c => ['GET', 'code:' + c])]);
      const n = emails.length;
      const raw = emails.map((e, i) => res[i] ? JSON.parse(res[i]) : { email: e });
      for (const u of raw) if (!u.id && u.salt) await ensureId(u); // старые аккаунты получают ID
      const users = raw.map((u, i) => { const e = emails[i]; return { email: e, id: u.id || 0, name: displayName(u), avatar: u.avatar || '', verified: !!u.verified || e === ADMIN() || adm.has(e), status: u.status || 'active', created: u.created, seen: u.seen, note: u.note || '', devices: res[n + i] || 0, keys: res[2 * n + i] || 0, admin: e === ADMIN() || adm.has(e), owner: e === ADMIN() }; })
        .sort((x, y) => (y.seen || 0) - (x.seen || 0));
      const cl = codes.map((c, i) => { const r = res[3 * n + i]; return r ? { code: c, ...JSON.parse(r) } : null; }).filter(Boolean).sort((x, y) => y.created - x.created);
      const envUsed = await kv('GET', 'gate:env:' + normCode((typeof process !== 'undefined' && process.env.ACCESS_CODE) || ''));
      return json({ users, codes: cl, envCodeUsed: !!envUsed, me: g.user.email, owner: g.user.owner });
    }
    if (a === 'code-new') {
      let c = normCode(body.code) || genCode();
      if (c.length !== 4) return json({ error: 'Код — ровно 4 символа' }, 400);
      if (await kv('EXISTS', 'code:' + c)) return json({ error: 'Такой код уже есть' }, 409);
      const max = Math.max(0, Math.min(10000, parseInt(body.max ?? 1, 10) || 0));
      const rec = { max, used: 0, note: String(body.note || '').slice(0, 80), created: Date.now() };
      await kvMulti([['SET', 'code:' + c, JSON.stringify(rec)], ['SADD', 'codes', c]]);
      return json({ ok: true, code: c, ...rec });
    }
    if (a === 'code-del') {
      const c = normCode(body.code);
      await kvMulti([['DEL', 'code:' + c], ['SREM', 'codes', c]]);
      return json({ ok: true });
    }
    if (a === 'user') {
      // цель — по почте или по ID
      let email = normEmail(body.email);
      const idq = String(body.id || body.email || '').trim().replace(/^(id|#)\s*/i, '');
      if ((!email || !email.includes('@')) && /^\d{1,12}$/.test(idq)) email = (await kv('GET', 'id:' + idq)) || '';
      const act = body.action;
      const u = await getUser(email); if (!u) return json({ error: 'Аккаунт не найден' }, 404);
      const owner = g.user.owner, targetOwner = email === ADMIN(), targetAdmin = targetOwner || !!(await kv('SISMEMBER', 'admins', email));
      if (act === 'verify' || act === 'unverify') {
        if (targetOwner && act === 'unverify') return json({ error: 'У владельца галочка всегда' }, 400);
        u.verified = act === 'verify'; await putUser(u); return json({ ok: true, verified: u.verified });
      }
      if (act === 'admin-add' || act === 'admin-del') {
        if (!owner) return json({ error: 'Назначать админов может только владелец' }, 403);
        if (targetOwner) return json({ error: 'Владелец — админ всегда' }, 400);
        if (act === 'admin-add') { if (u.status && u.status !== 'active') return json({ error: 'Сначала сделай аккаунт активным' }, 400); await kv('SADD', 'admins', email); }
        else await kv('SREM', 'admins', email);
        return json({ ok: true, admin: act === 'admin-add', email });
      }
      if (targetOwner && act !== 'note') return json({ error: 'Аккаунт владельца менять нельзя' }, 400);
      if (targetAdmin && !owner && act !== 'note') return json({ error: 'Других админов может менять только владелец' }, 403);
      const ST = { freeze: 'frozen', block: 'blocked', ban: 'banned', activate: 'active' };
      if (ST[act]) { if (ST[act] !== 'active') await kv('SREM', 'admins', email); u.status = ST[act]; u.statusAt = Date.now(); await putUser(u); return json({ ok: true, status: u.status }); }
      if (act === 'logout') { await dropSessions(email); return json({ ok: true }); }
      if (act === 'note') { u.note = String(body.note || '').slice(0, 120); await putUser(u); return json({ ok: true }); }
      if (act === 'delete') {
        await dropSessions(email);
        await kvMulti([['DEL', 'u:' + email], ['DEL', 'd:' + email], ['DEL', 'dt:' + email], ['DEL', 'dv:' + email], ['DEL', 'p:' + email], ['SREM', 'users', email], ['SREM', 'admins', email], ...(u.id ? [['DEL', 'id:' + u.id]] : [])]);
        return json({ ok: true });
      }
      return json({ error: 'Неизвестное действие' }, 400);
    }
    return json({ error: 'Неизвестный запрос' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}
