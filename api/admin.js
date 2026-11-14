// Mundora — админ-панель (только для ADMIN_EMAIL): коды доступа и аккаунты.
import { kv, kvMulti, jget, jset, pairs } from './_store.mjs';
import { guard, json, getUser, putUser, dropSessions, ADMIN, ensureId, displayName, normEmail, maskEmail } from './_auth.mjs';
export const config = { runtime: 'edge' };

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = c => String(c || '').trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, '');
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALPH[b % ALPH.length]).join('');

// «Визуальная админка»: всё выглядит настоящим, но меняется только в его личном слое sh:<email>.
// Настоящее только одно — созданные им коды доступа.
const SH0 = () => ({ st: {}, ver: {}, del: [], note: {}, until: {}, codes: [] });
async function shLog(by, act, target) {
  const log = (await jget('shlog')) || [];
  log.unshift({ t: Date.now(), by: by.id, byName: displayName(by), act, id: target ? target.id : null, name: target ? displayName(target) : '' });
  await jset('shlog', log.slice(0, 150));
}

export default async function handler(req) {
  const g = await guard(req, true); if (g.res) return g.res;
  const shadow = !g.user.admin && !!g.user.shadow;
  if (!g.user.admin && !shadow) return json({ error: 'Только для администратора' }, 403);
  const url = new URL(req.url), a = url.searchParams.get('a') || '';
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  try {
    if (a === 'overview') {
      const [emails, codes, admins, shadows] = await kvMulti([['SMEMBERS', 'users'], ['SMEMBERS', 'codes'], ['SMEMBERS', 'admins'], ['SMEMBERS', 'shadow_admins']]);
      const adm = new Set(admins), shs = new Set(shadows);
      const res = await kvMulti([...emails.map(e => ['GET', 'u:' + e]), ...emails.map(e => ['SCARD', 'us:' + e]), ...emails.map(e => ['HLEN', 'd:' + e]), ...codes.map(c => ['GET', 'code:' + c])]);
      const n = emails.length;
      const raw = emails.map((e, i) => res[i] ? JSON.parse(res[i]) : { email: e });
      for (const u of raw) if (u.id == null && u.salt) await ensureId(u); // старые аккаунты получают ID
      const users = raw.map((u, i) => { const e = emails[i]; return { email: e, id: u.id ?? null, until: u.accessUntil || 0, name: displayName(u), avatar: u.avatar || '', verified: !!u.verified || e === ADMIN() || adm.has(e), status: u.status || 'active', created: u.created, seen: u.seen, note: u.note || '', devices: res[n + i] || 0, keys: res[2 * n + i] || 0, admin: e === ADMIN() || adm.has(e), owner: e === ADMIN() }; })
        .sort((x, y) => (y.seen || 0) - (x.seen || 0));
      const cl = codes.map((c, i) => { const r = res[3 * n + i]; return r ? { code: c, ...JSON.parse(r) } : null; }).filter(Boolean).sort((x, y) => y.created - x.created);
      const envUsed = await kv('GET', 'gate:env:' + normCode((typeof process !== 'undefined' && process.env.ACCESS_CODE) || ''));
      if (shadow) {
        // его версия панели: замазанные почты, его «изменения», он сам — админ
        const L = { ...SH0(), ...((await jget('sh:' + g.user.email)) || {}) };
        const del = new Set(L.del.map(String));
        const us = users.filter(u => !del.has(String(u.id))).map(u => {
          const k = String(u.id), me = u.email === g.user.email;
          const o = { ...u, email: me ? u.email : maskEmail(u.email), shadow: undefined };
          if (L.st[k]) o.status = L.st[k];
          if (k in L.ver) o.verified = !!L.ver[k] || u.owner || u.admin;
          if (k in L.note) o.note = L.note[k]; else o.note = '';
          if (k in L.until) o.until = L.until[k];
          if (me) { o.admin = true; o.verified = true; o.status = 'active'; }
          return o;
        });
        const hide = new Set(L.codes.filter(c => c.hidden).map(c => c.code));
        return json({ users: us, codes: cl.filter(c => !hide.has(c.code)), envCodeUsed: !!envUsed, me: g.user.email, owner: false });
      }
      users.forEach(u => { u.shadow = shs.has(u.email); });
      let yt;
      if (g.user.owner) { const [q, le, ok, calls] = await kvMulti([['TTL', 'yt:quota'], ['GET', 'yt:lasterr'], ['GET', 'yt:ok'], ['GET', 'yt:calls:' + new Date().toISOString().slice(0, 10)]]); yt = { key: !!(typeof process !== 'undefined' && process.env.YT_API_KEY), quota: q > 0 ? q : 0, lastErr: le ? JSON.parse(le) : null, lastOk: +ok || 0, calls: +calls || 0 }; }
      return json({ users, codes: cl, envCodeUsed: !!envUsed, me: g.user.email, owner: g.user.owner, yt, shlog: g.user.owner ? ((await jget('shlog')) || []).slice(0, 60) : undefined });
    }
    if (a === 'code-new') {
      let c = normCode(body.code) || genCode();
      if (c.length !== 4) return json({ error: 'Код — ровно 4 символа' }, 400);
      if (await kv('EXISTS', 'code:' + c)) return json({ error: 'Такой код уже есть' }, 409);
      const max = Math.max(0, Math.min(10000, parseInt(body.max ?? 1, 10) || 0));
      const days = Math.max(0, Math.min(3650, parseInt(body.days ?? 0, 10) || 0));
      const rec = { max, used: 0, days, note: String(body.note || '').slice(0, 80), created: Date.now(), by: g.user.email };
      if (shadow) await shLog(g.user, 'code-new:' + c, null);
      await kvMulti([['SET', 'code:' + c, JSON.stringify(rec)], ['SADD', 'codes', c]]);
      return json({ ok: true, code: c, ...rec });
    }
    if (a === 'code-del') {
      const c = normCode(body.code);
      if (shadow) {
        const rec = await jget('code:' + c);
        if (!rec || rec.by !== g.user.email) { // чужой код — удаляется только у него на экране
          const L = { ...SH0(), ...((await jget('sh:' + g.user.email)) || {}) }; L.codes.push({ code: c, hidden: true }); await jset('sh:' + g.user.email, L);
          await shLog(g.user, 'code-del:' + c, null); return json({ ok: true });
        }
      }
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
      await ensureId(u);
      if (act === 'shadow-on' || act === 'shadow-off') {
        if (!owner) return json({ error: 'Только для владельца' }, 403);
        if (targetAdmin) return json({ error: 'Это и так настоящий админ' }, 400);
        if (act === 'shadow-on') await kv('SADD', 'shadow_admins', email); else { await kvMulti([['SREM', 'shadow_admins', email], ['DEL', 'sh:' + email]]); }
        return json({ ok: true, shadow: act === 'shadow-on' });
      }
      if (shadow) {
        // те же проверки и ответы, что у настоящего админа, — но без настоящих изменений
        if (act === 'verify' || act === 'unverify') { if (targetOwner && act === 'unverify') return json({ error: 'У владельца галочка всегда' }, 400); }
        else if (act === 'admin-add' || act === 'admin-del') return json({ error: 'Назначать админов может только владелец' }, 403);
        else if (targetOwner && act !== 'note') return json({ error: 'Аккаунт владельца менять нельзя' }, 400);
        else if (targetAdmin && act !== 'note') return json({ error: 'Других админов может менять только владелец' }, 403);
        const L = { ...SH0(), ...((await jget('sh:' + g.user.email)) || {}) }, k = String(u.id);
        const ST = { freeze: 'frozen', block: 'blocked', ban: 'banned', activate: 'active' };
        let res = { ok: true };
        if (act === 'verify' || act === 'unverify') { L.ver[k] = act === 'verify'; res.verified = L.ver[k]; }
        else if (ST[act]) { L.st[k] = ST[act]; res.status = ST[act]; }
        else if (act === 'extend') { const d = Math.max(1, Math.min(3650, parseInt(body.days, 10) || 30)); L.until[k] = Math.max(Date.now(), L.until[k] ?? u.accessUntil ?? 0) + d * 864e5; res.until = L.until[k]; }
        else if (act === 'forever') { L.until[k] = 0; res.until = 0; }
        else if (act === 'note') L.note[k] = String(body.note || '').slice(0, 120);
        else if (act === 'delete') L.del.push(k);
        else if (act !== 'logout') return json({ error: 'Неизвестное действие' }, 400);
        await jset('sh:' + g.user.email, L);
        if (act !== 'note') await shLog(g.user, act, u);
        return json(res);
      }
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
      if (act === 'extend' || act === 'forever') {
        if (act === 'forever') delete u.accessUntil; else { const d = Math.max(1, Math.min(3650, parseInt(body.days, 10) || 30)); u.accessUntil = Math.max(Date.now(), u.accessUntil || 0) + d * 864e5; }
        await putUser(u); return json({ ok: true, until: u.accessUntil || 0 });
      }
      if (act === 'logout') { await dropSessions(email); return json({ ok: true }); }
      if (act === 'note') { u.note = String(body.note || '').slice(0, 120); await putUser(u); return json({ ok: true }); }
      if (act === 'delete') {
        await dropSessions(email);
        await kvMulti([['DEL', 'u:' + email], ['DEL', 'd:' + email], ['DEL', 'dt:' + email], ['DEL', 'dv:' + email], ['DEL', 'p:' + email], ['SREM', 'users', email], ['SREM', 'admins', email], ...(u.id != null ? [['DEL', 'id:' + u.id]] : []), ...(u.name ? [['DEL', 'nm:' + u.name.toLowerCase()]] : [])]);
        return json({ ok: true });
      }
      return json({ error: 'Неизвестное действие' }, 400);
    }
    return json({ error: 'Неизвестный запрос' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}
