// Mundora — мессенджер.
// Сообщения и файлы хранятся зашифрованными (AES-256-GCM, у каждого чата свой ключ, выведенный из секрета сервера),
// по сети идут только по HTTPS. Опрос раз в секунду стоит 1 команду базы, пока ничего не изменилось.
// GET  ?a=init                          — токен опроса, мой ID
// GET  ?a=poll&tk&v&c&s                 — изменения: список чатов, новые сообщения открытого чата, «печатает», прочтение
// GET  ?a=peers&ids=1,2                 — имена и аватарки собеседников
// GET  ?a=hist&tk&c&before              — старые сообщения
// POST ?a=send {tk,to,x,fl,tmp}         — отправить
// POST ?a=react {c,i,e} · ?a=edit {c,i,x} · ?a=pin {c,i} · ?a=once {c,i}
// POST ?a=read {tk,c,s} · ?a=typing {tk,c} · ?a=del {tk,c,i}
// POST ?a=up {tk,c,id?,i,n,name,type,size,data} — кусок файла (base64)
// GET  ?a=file&id&tk                    — файл целиком (только участникам чата)
import { kv, kvMulti, jget, jset, pairs } from './_store.mjs';
import { guard, json, sign, sessionFromCookie, getUser, displayName, avatarOf, rand } from './_auth.mjs';
export const config = { runtime: 'edge' };

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const ub64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const ub64u = s => ub64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const KEYS = new Map();
async function ckey(c) { // ключ чата = HMAC(секрет сервера, 'chat:'+c)
  if (KEYS.has(c)) return KEYS.get(c);
  const raw = ub64u(await sign('mundora-chat-key:' + c)).slice(0, 32);
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); KEYS.set(c, k); return k;
}
async function seal(c, data) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await ckey(c), typeof data === 'string' ? enc.encode(data) : data)); return b64(iv) + '.' + b64(ct); }
async function open(c, s, bin) { if (!s) return null; const [iv, ct] = String(s).split('.'); try { const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(iv) }, await ckey(c), ub64(ct))); return bin ? pt : dec.decode(pt); } catch (e) { return null; } }
const chatId = (a, b) => [String(a), String(b)].sort((x, y) => +x - +y).join('_');
const peerOf = (c, me) => c.split('_').find(x => x !== String(me)) ?? String(me);
const inChat = (c, me) => /^\d{1,12}_\d{1,12}$/.test(c) && c.split('_').includes(String(me));

// быстрый токен опроса: без лишних запросов к базе (подпись + cookie сессии)
async function who(req, tk) {
  const s = await sessionFromCookie(req); if (!s) return null;
  const [id, sig] = String(tk || '').split('.'); if (!/^\d{1,12}$/.test(id || '')) return null;
  return sig && sig === (await sign('mp:' + id + ':' + s.email)).slice(0, 32) ? { id, email: s.email } : null;
}
async function decodeMsgs(c, raw, from) {
  return Promise.all((raw || []).map(async (r, k) => { const j = await open(c, r); let m = null; try { m = JSON.parse(j); } catch (e) {} return m ? { ...m, i: from + k } : { i: from + k, f: '?', t: 0, x: '', bad: 1 }; }));
}
// реакции, правки и закреп чата — отдают целиком при любом изменении (их мало)
async function extras(c, me) {
  const [rx, ed, pin, hd] = await kvMulti([['HGETALL', 'cx:' + c], ['HGETALL', 'ce:' + c], ['GET', 'cp:' + c], ['HGETALL', 'ch:' + c + ':' + me]]);
  const R = {}; for (const [i, v] of Object.entries(pairs(rx))) { try { R[i] = JSON.parse(v); } catch (e) {} }
  const E = {}; for (const [i, v] of Object.entries(pairs(ed))) { const j = await open(c, v); if (j) { try { E[i] = JSON.parse(j); } catch (e) {} } }
  return { rx: R, ed: E, pin: pin == null ? -1 : +pin, hid: Object.keys(pairs(hd)).map(Number) };
}
const bump = (me, c) => { const p = peerOf(c, me); return [['INCR', 'mv:' + me], ...(p !== String(me) ? [['INCR', 'mv:' + p]] : [])]; };
async function msgAt(c, i) { const [r] = await kvMulti([['LRANGE', 'cm:' + c, String(i), String(i)]]); try { return JSON.parse((await open(c, r && r[0])) || 'null'); } catch (e) { return null; } }
async function chatList(me) {
  const [ci, cu] = await kvMulti([['HGETALL', 'ci:' + me], ['HGETALL', 'cu:' + me]]);
  const C = pairs(ci), U = pairs(cu);
  const E = Object.entries(C); const RD = E.length ? await kvMulti(E.map(([c]) => ['HGET', 'cr:' + c, peerOf(c, me)])) : [];
  const out = await Promise.all(E.map(async ([c, v], k) => { let o = {}; try { o = JSON.parse(v); } catch (e) {} return { c, p: peerOf(c, me), t: o.t || 0, f: o.f, n: o.n || 0, pv: (await open(c, o.pv)) || '', u: +U[c] || 0, r: RD[k] == null ? -1 : +RD[k] }; }));
  return out.sort((a, b) => b.t - a.t);
}

export default async function handler(req) {
  const url = new URL(req.url), a = url.searchParams.get('a'), q = k => url.searchParams.get(k);
  try {
    if (a === 'init') {
      const g = await guard(req, true); if (g.res) return g.res; const me = g.user;
      if (me.id == null) return json({ error: 'Нет ID аккаунта' }, 400);
      const tk = me.id + '.' + (await sign('mp:' + me.id + ':' + me.email)).slice(0, 32);
      const [v, list] = await Promise.all([kv('GET', 'mv:' + me.id), chatList(me.id)]);
      return json({ tk, me: me.id, v: v || '0', chats: list });
    }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const W = await who(req, body.tk || q('tk')); if (!W) return json({ error: 'Нужно войти заново', relogin: true }, 401);
    const me = W.id;

    if (a === 'poll') {
      if (q('hb')) await kvMulti([['SET', 'on:' + me, '1', 'EX', '35'], ['SET', 'ls:' + me, String(Date.now())]]); // «в сети», пока сайт открыт
      const v = (await kv('GET', 'mv:' + me)) || '0';
      if (v === q('v')) return json({ v, same: 1 });
      const c = q('c'), s = +q('s');
      const out = { v, chats: await chatList(me) };
      if (c && inChat(c, me)) {
        const p = peerOf(c, me);
        const [raw, rd, ty, dl] = await kvMulti([['LRANGE', 'cm:' + c, String(Math.max(0, isFinite(s) ? s + 1 : 0)), '-1'], ['HGET', 'cr:' + c, p], ['GET', 'ty:' + c + ':' + p], ['HGETALL', 'cd:' + c]]);
        out.msgs = await decodeMsgs(c, raw, Math.max(0, isFinite(s) ? s + 1 : 0)); out.read = rd == null ? -1 : +rd; out.typing = !!ty; out.del = Object.keys(pairs(dl)).map(Number); Object.assign(out, await extras(c, me));
      }
      return json(out);
    }
    if (a === 'hist') {
      const c = q('c'); if (!inChat(c, me)) return json({ error: 'Нет доступа' }, 403);
      const len = await kv('LLEN', 'cm:' + c); const before = q('before') == null ? len : Math.min(len, +q('before')); const from = Math.max(0, before - 60);
      const p = peerOf(c, me);
      const [raw, rd, dl] = await kvMulti([['LRANGE', 'cm:' + c, String(from), String(before - 1)], ['HGET', 'cr:' + c, p], ['HGETALL', 'cd:' + c]]);
      return json({ msgs: before > 0 ? await decodeMsgs(c, raw, from) : [], from, read: rd == null ? -1 : +rd, del: Object.keys(pairs(dl)).map(Number), ...(await extras(c, me)) });
    }
    if (a === 'on') {
      const ids = String(q('ids') || '').split(',').filter(x => /^\d{1,12}$/.test(x)).slice(0, 30);
      const r = ids.length ? await kvMulti(ids.flatMap(id => [['GET', 'on:' + id], ['GET', 'ls:' + id]])) : [];
      return json({ on: Object.fromEntries(ids.map((id, i) => [id, { on: !!r[i * 2], t: +r[i * 2 + 1] || 0 }])) });
    }
    if (a === 'off') { await kv('DEL', 'on:' + me); return json({ ok: 1 }); }
    if (a === 'peers') {
      const ids = String(q('ids') || '').split(',').filter(x => /^\d{1,12}$/.test(x)).slice(0, 60);
      const ems = ids.length ? await kvMulti(ids.map(id => ['GET', 'id:' + id])) : [];
      const us = await Promise.all(ems.map(e => e ? getUser(e) : null));
      return json({ peers: ids.map((id, i) => { const u = us[i]; return u ? { id: +id, name: displayName(u), avatar: avatarOf(u), verified: !!u.verified, seen: u.seen ? Math.floor(u.seen / 6e4) * 6e4 : 0, online: Date.now() - (u.seen || 0) < 6 * 60e3 } : { id: +id, name: 'Удалённый аккаунт', avatar: 'planet', gone: 1 }; }) });
    }
    if (req.method !== 'POST' && a !== 'file') return json({ error: 'Неизвестный запрос' }, 404);

    if (a === 'send') {
      const to = String(body.to ?? ''); if (!/^\d{1,12}$/.test(to)) return json({ error: 'Кому?' }, 400);
      const c = chatId(me, to);
      if (to !== me && !(await kv('GET', 'id:' + to))) return json({ error: 'Аккаунт не найден' }, 404);
      const x = String(body.x || '').slice(0, 4000);
      const fl = body.fl && typeof body.fl === 'object' ? { id: String(body.fl.id || '').slice(0, 20), n: String(body.fl.n || 'файл').slice(0, 120), ty: String(body.fl.ty || '').slice(0, 80), sz: +body.fl.sz || 0, w: +body.fl.w || 0, h: +body.fl.h || 0, d: +body.fl.d || 0, th: String(body.fl.th || '').slice(0, 6000), wf: String(body.fl.wf || '').replace(/[^0-9a-z]/g, '').slice(0, 80), vo: body.fl.vo ? 1 : 0, rd: body.fl.rd ? 1 : 0, ...(body.fl.once ? { once: 1 } : {}), ...(body.fl.doc ? { doc: 1 } : {}), ...(+body.fl.a > 0 ? { a: Math.round(+body.fl.a * 100) / 100 } : {}), ...(+body.fl.b > 0 ? { b: Math.round(+body.fl.b * 100) / 100 } : {}) } : null;
      if (fl) { const m = await jget('mf:' + fl.id); if (!m || m.c !== c || m.o !== me) return json({ error: 'Файл не загружен' }, 400); }
      if (!x.trim() && !fl) return json({ error: 'Пустое сообщение' }, 400);
      const t = Date.now(), m = { f: +me, t, x, ...(fl ? { fl } : {}), ...(body.r != null ? { r: +body.r } : {}) };
      const len = await kv('RPUSH', 'cm:' + c, await seal(c, JSON.stringify(m)));
      const pv = await seal(c, x.trim() ? x.slice(0, 80) : (fl.vo ? '🎤 Голосовое' : fl.rd ? '📹 Видеосообщение' : fl.ty.startsWith('image/') ? '🖼 Фото' : fl.ty.startsWith('video/') ? '🎬 Видео' : '📎 ' + fl.n));
      const meta = JSON.stringify({ t, f: +me, pv, n: len });
      await kvMulti([['HSET', 'ci:' + me, c, meta], ['HSET', 'cu:' + me, c, '0'], ['HSET', 'cr:' + c, me, String(len - 1)], ['INCR', 'mv:' + me], ...(to !== me ? [['HSET', 'ci:' + to, c, meta], ['HINCRBY', 'cu:' + to, c, '1'], ['DEL', 'ty:' + c + ':' + me], ['INCR', 'mv:' + to]] : [])]);
      return json({ ok: 1, c, m: { ...m, i: len - 1 }, tmp: body.tmp });
    }
    if (a === 'fwd') { // переслать сообщение (и файл) в другой чат: файл перешифровывается ключом нового чата
      const c0 = String(body.c || ''), i = +body.i, to = String(body.to ?? '');
      if (!inChat(c0, me) || !(i >= 0) || !/^\d{1,12}$/.test(to)) return json({ error: 'Нет доступа' }, 403);
      if (to !== me && !(await kv('GET', 'id:' + to))) return json({ error: 'Аккаунт не найден' }, 404);
      const [r] = await kvMulti([['LRANGE', 'cm:' + c0, String(i), String(i)]]); const m0 = JSON.parse((await open(c0, r && r[0])) || 'null');
      if (!m0 || m0.d) return json({ error: 'Сообщение недоступно' }, 404);
      const c = chatId(me, to); let fl = null;
      if (m0.fl && m0.fl.id) {
        const fm = await jget('mf:' + m0.fl.id); if (!fm) return json({ error: 'Файл не найден' }, 404);
        const parts = await kvMulti(Array.from({ length: fm.k }, (_, k) => ['GET', 'mfc:' + m0.fl.id + ':' + k]));
        const nid = rand(10);
        await jset('mf:' + nid, { ...fm, c, o: me, t: Date.now() });
        for (let k = 0; k < parts.length; k++) await kv('SET', 'mfc:' + nid + ':' + k, await seal(c, await open(c0, parts[k], true)));
        fl = { ...m0.fl, id: nid };
      }
      const t = Date.now(), m = { f: +me, t, x: m0.x || '', ...(fl ? { fl } : {}), ...(body.plain ? {} : { fw: +(m0.fw ?? m0.f) }) };
      const len = await kv('RPUSH', 'cm:' + c, await seal(c, JSON.stringify(m)));
      const pv = await seal(c, '↪ ' + (m.x ? m.x.slice(0, 70) : fl ? (fl.vo ? 'Голосовое' : fl.rd ? 'Видеосообщение' : fl.n) : ''));
      const meta = JSON.stringify({ t, f: +me, pv, n: len });
      await kvMulti([['HSET', 'ci:' + me, c, meta], ['HSET', 'cr:' + c, me, String(len - 1)], ['INCR', 'mv:' + me], ...(to !== me ? [['HSET', 'ci:' + to, c, meta], ['HINCRBY', 'cu:' + to, c, '1'], ['INCR', 'mv:' + to]] : [])]);
      return json({ ok: 1, c });
    }
    if (a === 'read') {
      const c = String(body.c || ''); if (!inChat(c, me)) return json({ error: 'Нет доступа' }, 403);
      const p = peerOf(c, me);
      await kvMulti([['HSET', 'cr:' + c, me, String(+body.s || 0)], ['HSET', 'cu:' + me, c, '0'], ['INCR', 'mv:' + p], ['INCR', 'mv:' + me]]);
      return json({ ok: 1 });
    }
    if (a === 'typing') {
      const c = String(body.c || ''); if (!inChat(c, me)) return json({ error: 'Нет доступа' }, 403);
      const p = peerOf(c, me); if (p === me) return json({ ok: 1 });
      await kvMulti([['SET', 'ty:' + c + ':' + me, '1', 'EX', '5'], ['INCR', 'mv:' + p]]);
      return json({ ok: 1 });
    }
    if (a === 'del') {
      const c = String(body.c || ''), i = +body.i; if (!inChat(c, me) || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const [r] = await kvMulti([['LRANGE', 'cm:' + c, String(i), String(i)]]); const m = JSON.parse((await open(c, r && r[0])) || 'null');
      if (!m) return json({ error: 'Сообщение не найдено' }, 404);
      // «удалить только у меня» — сообщение прячется только для этого человека
      if (body.all === 0 || body.all === false) { await kvMulti([['HSET', 'ch:' + c + ':' + me, String(i), '1'], ['INCR', 'mv:' + me]]); return json({ ok: 1 }); }
      const p = peerOf(c, me);
      await kvMulti([['LSET', 'cm:' + c, String(i), await seal(c, JSON.stringify({ f: m.f, t: m.t, x: '', d: 1 }))], ['HSET', 'cd:' + c, String(i), '1'], ['HDEL', 'cx:' + c, String(i)], ['HDEL', 'ce:' + c, String(i)], ['INCR', 'mv:' + me], ...(p !== me ? [['INCR', 'mv:' + p]] : [])]);
      if (m.fl && m.fl.id) { const fm = await jget('mf:' + m.fl.id); if (fm) await kvMulti([['DEL', 'mf:' + m.fl.id], ...Array.from({ length: fm.k }, (_, k) => ['DEL', 'mfc:' + m.fl.id + ':' + k])]); }
      return json({ ok: 1 });
    }
    if (a === 'react') { // одна реакция от человека на сообщение; та же ещё раз — снять
      const c = String(body.c || ''), i = +body.i, e = String(body.e || '').slice(0, 16);
      if (!inChat(c, me) || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const cur = await kv('HGET', 'cx:' + c, String(i)); let o = {}; try { o = JSON.parse(cur) || {}; } catch (_) {}
      if (!e || o[me] === e) delete o[me]; else o[me] = e;
      await kvMulti([Object.keys(o).length ? ['HSET', 'cx:' + c, String(i), JSON.stringify(o)] : ['HDEL', 'cx:' + c, String(i)], ...bump(me, c)]);
      return json({ ok: 1, rx: o });
    }
    if (a === 'edit') {
      const c = String(body.c || ''), i = +body.i, x = String(body.x || '').slice(0, 4000);
      if (!inChat(c, me) || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const m = await msgAt(c, i); if (!m || m.d || String(m.f) !== me) return json({ error: 'Можно изменить только своё сообщение' }, 403);
      if (!x.trim() && !m.fl) return json({ error: 'Пустое сообщение' }, 400);
      await kvMulti([['HSET', 'ce:' + c, String(i), await seal(c, JSON.stringify({ x, t: Date.now() }))], ...bump(me, c)]);
      return json({ ok: 1 });
    }
    if (a === 'pin') {
      const c = String(body.c || ''), i = +body.i; if (!inChat(c, me)) return json({ error: 'Нет доступа' }, 403);
      await kvMulti([i >= 0 ? ['SET', 'cp:' + c, String(i)] : ['DEL', 'cp:' + c], ...bump(me, c)]);
      return json({ ok: 1 });
    }
    if (a === 'once') { // одноразовое голосовое/кружок: получатель открыл — сообщение и файл стираются у обоих
      const c = String(body.c || ''), i = +body.i; if (!inChat(c, me) || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const m = await msgAt(c, i); if (!m || m.d || !m.fl || !m.fl.once || String(m.f) === me) return json({ ok: 1 });
      await kvMulti([['LSET', 'cm:' + c, String(i), await seal(c, JSON.stringify({ f: m.f, t: m.t, x: '', d: 1, o1: 1 }))], ['HSET', 'cd:' + c, String(i), '1'], ...bump(me, c)]);
      if (m.fl.id) { const fm = await jget('mf:' + m.fl.id); if (fm) await kvMulti([['DEL', 'mf:' + m.fl.id], ...Array.from({ length: fm.k }, (_, k) => ['DEL', 'mfc:' + m.fl.id + ':' + k])]); }
      return json({ ok: 1 });
    }
    if (a === 'up') {
      const to = String(body.to ?? ''); if (!/^\d{1,12}$/.test(to)) return json({ error: 'Кому?' }, 400);
      const c = chatId(me, to), n = Math.min(24, Math.max(1, +body.n || 1)), i = +body.i;
      if (!(i >= 0 && i < n)) return json({ error: 'Неверный кусок' }, 400);
      const data = String(body.data || ''); if (data.length > 760_000) return json({ error: 'Кусок слишком большой' }, 413);
      let id = String(body.id || '');
      if (!id) { if (+body.size > 12 * 1024 * 1024) return json({ error: 'Файл больше 12 МБ' }, 413); id = rand(10); await jset('mf:' + id, { c, o: me, k: n, ty: String(body.type || 'application/octet-stream').slice(0, 80), n: String(body.name || 'файл').slice(0, 120), sz: +body.size || 0, t: Date.now() }); }
      else { const m = await jget('mf:' + id); if (!m || m.o !== me || m.c !== c) return json({ error: 'Нет доступа' }, 403); }
      await kv('SET', 'mfc:' + id + ':' + i, await seal(c, ub64(data)));
      return json({ ok: 1, id });
    }
    if (a === 'file') {
      const id = String(q('id') || ''); const m = await jget('mf:' + id); if (!m || !inChat(m.c, me)) return new Response('Нет доступа', { status: 403 });
      const parts = await kvMulti(Array.from({ length: m.k }, (_, k) => ['GET', 'mfc:' + id + ':' + k]));
      const bufs = await Promise.all(parts.map(p => open(m.c, p, true)));
      if (bufs.some(b => !b)) return new Response('Файл ещё загружается или повреждён', { status: 409 });
      const total = bufs.reduce((n, b) => n + b.length, 0), out = new Uint8Array(total); let o = 0; bufs.forEach(b => { out.set(b, o); o += b.length; });
      return new Response(out, { headers: { 'content-type': m.ty, 'content-length': String(total), 'cache-control': 'private, max-age=31536000, immutable', 'content-disposition': (q('dl') ? 'attachment' : 'inline') + '; filename="' + (m.n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'file') + "\"; filename*=UTF-8''" + encodeURIComponent(m.n) } });
    }
    return json({ error: 'Неизвестный запрос' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}
