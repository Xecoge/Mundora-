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
// Группы и каналы: id чата «g<число>», описание в gr:<id> {type,title,about,owner,admins,members,inv,t,col}
// POST ?a=gnew {type,title,about,ids} · ?a=gadd {c,ids} · ?a=gkick {c,u} · ?a=gleave {c} · ?a=gedit {c,title,about} · ?a=gjoin {c,inv} · ?a=gadmin {c,u,on}
// GET  ?a=ginfo&c                        — описание, участники, ссылка-приглашение (для участников)
import { kv, kvMulti, jget, jset, pairs } from './_store.mjs';
import { guard, json, sign, sessionFromCookie, getUser, displayName, avatarOf, rand } from './_auth.mjs';
import { isBotEmail, botById, botByToken, botFatherId, botFatherReply, botEnqueue, botUpdates } from './_bots.mjs';
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
const isG = c => /^g\d{1,12}$/.test(String(c || ''));
const gget = c => isG(c) ? jget('gr:' + c) : null;
// ID 0 и ID 1 — главные админы Mundora: в любой группе/канале права как у владельца, выдают галочки
const SUP = me => me != null && ['0', '1'].includes(String(me));
const isAdm = (g, me) => !!g && ((g.admins || []).map(String).includes(String(me)) || SUP(me));
const isOwn = (g, me) => !!g && (String(g.owner) === String(me) || SUP(me));
// доступ к чату: личный — по id, группа/канал — если ты участник
async function access(c, me) { if (isG(c)) { const g = await gget(c); return g && (g.members || []).map(String).includes(String(me)) ? g : null; } return inChat(c, me) ? { dm: 1 } : null; }
const others = (c, me, G) => G && !G.dm ? (G.members || []).map(String).filter(x => x !== String(me)) : (peerOf(c, me) !== String(me) ? [peerOf(c, me)] : []);
const bumpAll = (me, c, G) => [['INCR', 'mv:' + me], ...others(c, me, G).map(u => ['INCR', 'mv:' + u])];
// куда пишем: личный чат с человеком или группа/канал
async function dest(to, me) { to = String(to ?? '');
  if (isG(to)) { const g = await access(to, me); if (!g) return { err: 'Нет доступа' }; if (g.type === 'channel' && !isAdm(g, me)) return { err: 'В канале пишут только администраторы' }; return { c: to, G: g }; }
  if (!/^\d{1,12}$/.test(to)) return { err: 'Кому?' }; const em = to !== me ? await kv('GET', 'id:' + to) : null; if (to !== me && !em) return { err: 'Аккаунт не найден' };
  if (isBotEmail(em)) { const b = await getUser(em); if (!b || b.status === 'deleted' || !b.bot) return { err: 'Бот удалён' }; return { c: chatId(me, to), G: { dm: 1 }, to, bot: b }; }
  return { c: chatId(me, to), G: { dm: 1 }, to }; }
// ---- Web Push: уведомления, даже когда сайт закрыт. Ключи VAPID создаются один раз и хранятся в базе (в коде их нет). ----
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let VAP = null;
async function vapid() {
  if (VAP) return VAP;
  let v = await jget('vapid');
  if (!v) {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), jwk: await crypto.subtle.exportKey('jwk', k.privateKey) };
    const ok = await kv('SET', 'vapid', JSON.stringify(v), 'NX'); if (!ok) v = await jget('vapid');
  }
  VAP = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  return VAP;
}
async function pushTo(uid, urgent) {
  const subs = pairs(await kv('HGETALL', 'ps:' + uid)); const L = Object.entries(subs); if (!L.length) return;
  const V = await vapid(), enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  await Promise.allSettled(L.map(async ([h, raw]) => {
    let sub; try { sub = JSON.parse(raw); } catch (e) { return; }
    const aud = new URL(sub.endpoint).origin, head = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:support@mundora.app' });
    const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, V.key, new TextEncoder().encode(head)));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3500);
    try {
      const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: urgent ? '50' : '3600', Urgency: urgent ? 'high' : 'normal', Authorization: `vapid t=${head}.${sig}, k=${V.pub}`, 'Content-Length': '0' }, signal: ctl.signal });
      if (r.status === 404 || r.status === 410) await kv('HDEL', 'ps:' + uid, h);
    } catch (e) {} clearTimeout(t);
  }));
}
const inCall = (k, me) => !!k && (k.members.includes(+me) || k.inv.includes(+me) || +k.from === +me);
const ringing = (k, me) => { if (!k || k.st === 'end' || !k.inv.includes(+me)) return null; const t = (k.invT || {})[me] || k.t; if (Date.now() - t > 50000) return null; return { by: (k.invBy || {})[me] || k.from, group: k.members.length + k.inv.length > 2 }; };
// сообщение в чат + обновление списков чатов у всех участников
async function push(c, me, G, m, pvText) {
  const len = await kv('RPUSH', 'cm:' + c, await seal(c, JSON.stringify(m)));
  const meta = JSON.stringify({ t: m.t, f: +me, pv: await seal(c, pvText), n: len });
  const O = others(c, me, G);
  await kvMulti([['HSET', 'ci:' + me, c, meta], ['HSET', 'cu:' + me, c, '0'], ['HSET', 'cr:' + c, me, String(len - 1)], ['INCR', 'mv:' + me], ...(isG(c) ? [['DEL', 'tyg:' + c]] : [['DEL', 'ty:' + c + ':' + me]]),
    ...O.flatMap(u => [['HSET', 'ci:' + u, c, meta], ['HINCRBY', 'cu:' + u, c, '1'], ['INCR', 'mv:' + u]])]);
  if (O.length && O.length <= 30 && !m.cl) { const on = await kvMulti(O.map(u => ['GET', 'on:' + u])); await Promise.allSettled(O.filter((u, i) => !on[i]).map(u => pushTo(u, false))); }
  return len;
}
const okAva = a => typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length < 160000;
const gOut = (g, me) => ({ id: g.id, type: g.type, title: g.title, about: g.about || '', n: (g.members || []).length, col: g.col || 0, av: g.av || 0, owner: +g.owner, admin: isAdm(g, me), own: isOwn(g, me), vf: !!g.vf, ...(isOwn(g, me) ? { inv: g.inv } : {}) });
// «прочитано» в группе — кто-нибудь кроме меня дочитал до…
const readOf = (crAll, me) => { let r = -1; for (const [u, v] of Object.entries(pairs(crAll))) if (u !== String(me)) r = Math.max(r, +v); return r; };

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
  const E = Object.entries(C); const RD = E.length ? await kvMulti(E.map(([c]) => isG(c) ? ['HGETALL', 'cr:' + c] : ['HGET', 'cr:' + c, peerOf(c, me)])) : [];
  const GS = await Promise.all(E.map(([c]) => isG(c) ? gget(c) : null));
  const out = await Promise.all(E.map(async ([c, v], k) => { let o = {}; try { o = JSON.parse(v); } catch (e) {} const g = GS[k];
    if (isG(c) && (!g || !(g.members || []).map(String).includes(String(me)))) return null;
    return { c, p: isG(c) ? null : peerOf(c, me), ...(g ? { g: gOut(g, me) } : {}), t: o.t || 0, f: o.f, n: o.n || 0, pv: (await open(c, o.pv)) || '', u: +U[c] || 0, r: isG(c) ? readOf(RD[k], me) : RD[k] == null ? -1 : +RD[k] }; }));
  return out.filter(Boolean).sort((a, b) => b.t - a.t);
}

// ---- боты ----
async function botGot(b, me, email, c, i, m) {
  if (b.bot.uname === 'BotFather' && b.verified) {
    const reply = await botFatherReply(me, m.x || '');
    const t = Date.now(); await push(c, String(b.id), { dm: 1 }, { f: +b.id, t, x: reply }, reply.slice(0, 80)); return;
  }
  const u = await getUser(email);
  await botEnqueue(b.id, { message: { message_id: i, from: { id: +me, is_bot: false, first_name: u ? displayName(u) : 'ID ' + me }, chat: { id: +me, type: 'private' }, date: Math.floor(m.t / 1000), ...(m.x ? { text: m.x } : {}), ...(m.fl ? { file: { name: m.fl.n, type: m.fl.ty } } : {}), ...(m.r != null ? { reply_to_message_id: m.r } : {}) } });
}
async function botApi(req, url) {
  const R = (result, ok = true) => new Response(JSON.stringify(ok ? { ok: true, result } : { ok: false, error_code: result[0], description: result[1] }), { status: ok ? 200 : result[0], headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  const b = await botByToken(url.searchParams.get('token'));
  if (!b || b.status === 'deleted') return R([401, 'Unauthorized: неверный токен'], false);
  let P = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') { const ct = req.headers.get('content-type') || ''; try { P = { ...P, ...(ct.includes('json') ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()))) }; } catch (e) {} }
  const me = String(b.id), mt = String(P.method || '');
  if (mt === 'getMe') return R({ id: +me, is_bot: true, first_name: displayName(b), username: b.bot.uname, can_join_groups: false });
  if (mt === 'getUpdates') {
    const off = +P.offset || 0, lim = Math.min(100, Math.max(1, +P.limit || 100)), tmo = Math.min(20, Math.max(0, +P.timeout || 0)), t0 = Date.now();
    let L = await botUpdates(me, off, lim);
    while (!L.length && Date.now() - t0 < tmo * 1000) { await new Promise(r => setTimeout(r, 1000)); L = await botUpdates(me, off, lim); }
    return R(L);
  }
  if (mt === 'sendMessage') {
    const to = String(P.chat_id ?? ''), x = String(P.text ?? '').slice(0, 4000);
    if (!/^\d{1,12}$/.test(to)) return R([400, 'Bad Request: chat_id'], false);
    if (!x.trim()) return R([400, 'Bad Request: text is empty'], false);
    const c = chatId(me, to);
    if (!(await kv('HGET', 'ci:' + me, c))) return R([403, 'Forbidden: пользователь ещё не писал боту'], false);
    const t = Date.now(), m = { f: +me, t, x, ...(P.reply_to_message_id != null && P.reply_to_message_id !== '' ? { r: +P.reply_to_message_id } : {}) };
    const len = await push(c, me, { dm: 1 }, m, x.slice(0, 80));
    return R({ message_id: len - 1, from: { id: +me, is_bot: true, first_name: displayName(b), username: b.bot.uname }, chat: { id: +to, type: 'private' }, date: Math.floor(t / 1000), text: x });
  }
  if (mt === 'setMyCommands') {
    let cm = P.commands; try { if (typeof cm === 'string') cm = JSON.parse(cm); } catch (e) { cm = null; }
    if (!Array.isArray(cm)) return R([400, 'Bad Request: commands'], false);
    b.bot.cmds = cm.slice(0, 50).map(o => ({ c: String(o.command || '').replace(/^\//, '').toLowerCase().slice(0, 32), d: String(o.description || '').slice(0, 256) })).filter(o => /^[a-z0-9_]+$/.test(o.c));
    await kv('SET', 'u:' + b.email, JSON.stringify(b)); return R(true);
  }
  if (mt === 'getMyCommands') return R((b.bot.cmds || []).map(o => ({ command: o.c, description: o.d })));
  return R([404, 'Not Found: метод ' + mt], false);
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
    if (a === 'vapid') return json({ key: (await vapid()).pub });
    if (a === 'botapi') return botApi(req, url);
    if (a === 'pend') { // для service worker: что случилось — звонок, пропущенный или сообщение
      const g = await guard(req, true); if (g.res) return g.res; const me = String(g.user.id);
      const card = async id => { const e = await kv('GET', 'id:' + id); const u = e ? await getUser(e) : null; const av = u ? avatarOf(u) : 'planet'; return { name: u ? displayName(u) : 'ID ' + id, ava: typeof av === 'string' && av.startsWith('/') ? av : '/img/' + (av || 'planet') + '.webp' }; };
      const cin = await kv('GET', 'cin:' + me);
      if (cin) { const k = await jget('call:' + cin); const r = ringing(k, me); if (r) return json({ call: { id: k.id, from: r.by, kind: k.kind, group: r.group, ...(await card(r.by)) } }); }
      const mi = await kv('GET', 'cmiss:' + me);
      if (mi) { await kv('DEL', 'cmiss:' + me); const k = JSON.parse(mi); return json({ end: 1, miss: { id: k.id, from: k.from, ...(await card(k.from)) } }); }
      const L = (await chatList(me)).filter(c => c.u > 0).sort((x, y) => y.t - x.t)[0];
      if (L) { const from = L.g ? L.f : L.p, cd = await card(from); return json({ msg: { c: L.c, name: L.g ? L.g.title : cd.name, pv: (L.g && L.g.type !== 'channel' ? cd.name + ': ' : '') + (L.pv || 'Новое сообщение') + (L.u > 1 ? ' (+' + (L.u - 1) + ')' : ''), ava: L.g ? null : cd.ava, url: '/#msg-' + (L.g ? L.c : from) } }); }
      return json({ end: 1 });
    }
    if (a === 'gava') { const d = isG(q('c')) ? await kv('GET', 'ga:' + q('c')) : null; if (!d) return new Response('', { status: 404 }); const [h, b64] = String(d).split(','); return new Response(ub64(b64), { headers: { 'content-type': h.slice(5, h.indexOf(';')), 'cache-control': 'public, max-age=31536000, immutable' } }); }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const W = await who(req, body.tk || q('tk')); if (!W) return json({ error: 'Нужно войти заново', relogin: true }, 401);
    const me = W.id;

    if (a === 'poll') {
      if (q('hb')) await kvMulti([['SET', 'on:' + me, '1', 'EX', '35'], ['SET', 'ls:' + me, String(Date.now())]]); // «в сети», пока сайт открыт
      const v = (await kv('GET', 'mv:' + me)) || '0';
      if (v === q('v')) return json({ v, same: 1 });
      const c = q('c'), s = +q('s');
      const out = { v, chats: await chatList(me) };
      const cin = await kv('GET', 'cin:' + me);
      if (cin) { const k = await jget('call:' + cin); const r = ringing(k, me); if (r) out.call = { id: k.id, from: r.by, kind: k.kind, group: r.group, t: k.t }; }
      const G = c ? await access(c, me) : null;
      if (c && G) {
        const p = isG(c) ? null : peerOf(c, me);
        const [raw, rd, ty, dl] = await kvMulti([['LRANGE', 'cm:' + c, String(Math.max(0, isFinite(s) ? s + 1 : 0)), '-1'], isG(c) ? ['HGETALL', 'cr:' + c] : ['HGET', 'cr:' + c, p], isG(c) ? ['GET', 'tyg:' + c] : ['GET', 'ty:' + c + ':' + p], ['HGETALL', 'cd:' + c]]);
        out.msgs = await decodeMsgs(c, raw, Math.max(0, isFinite(s) ? s + 1 : 0)); out.read = isG(c) ? readOf(rd, me) : rd == null ? -1 : +rd; out.typing = isG(c) ? (ty && ty !== String(me) ? +ty : 0) : !!ty; out.del = Object.keys(pairs(dl)).map(Number); Object.assign(out, await extras(c, me));
        if (isG(c)) out.g = gOut(G, me);
      }
      return json(out);
    }
    if (a === 'hist') {
      const c = q('c'); const G = await access(c, me); if (!G) return json({ error: 'Нет доступа' }, 403);
      const len = await kv('LLEN', 'cm:' + c); const before = q('before') == null ? len : Math.min(len, +q('before')); const from = Math.max(0, before - 60);
      const [raw, rd, dl] = await kvMulti([['LRANGE', 'cm:' + c, String(from), String(before - 1)], isG(c) ? ['HGETALL', 'cr:' + c] : ['HGET', 'cr:' + c, peerOf(c, me)], ['HGETALL', 'cd:' + c]]);
      return json({ msgs: before > 0 ? await decodeMsgs(c, raw, from) : [], from, read: isG(c) ? readOf(rd, me) : rd == null ? -1 : +rd, del: Object.keys(pairs(dl)).map(Number), ...(await extras(c, me)), ...(isG(c) ? { g: gOut(G, me) } : {}) });
    }
    if (a === 'ginfo') {
      const c = q('c'); const G = await access(c, me);
      if (!G || G.dm) { const g = await gget(c); if (g && q('inv') && q('inv') === g.inv) return json({ g: { ...gOut(g, me), inv: undefined }, join: 1 }); return json({ error: 'Нет доступа' }, 403); }
      return json({ g: gOut(G, me), members: (G.members || []).map(Number), admins: (G.admins || []).map(Number) });
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
      const pr = ids.length ? await kvMulti(ids.flatMap(id => [['GET', 'on:' + id], ['GET', 'ls:' + id]])) : [];
      return json({ peers: ids.map((id, i) => { const u = us[i]; return u ? { id: +id, name: displayName(u), avatar: avatarOf(u), verified: !!u.verified, ...(u.bot ? { bot: u.bot.uname, about: u.bot.about || '', cmds: u.bot.cmds || [] } : {}), seen: Math.max(u.seen || 0, +pr[i * 2 + 1] || 0) ? Math.floor(Math.max(u.seen || 0, +pr[i * 2 + 1] || 0) / 6e4) * 6e4 : 0, online: !!pr[i * 2] } : { id: +id, name: 'Удалённый аккаунт', avatar: 'planet', gone: 1 }; }) });
    }
    // настройки списка чатов (закреп, архив, без звука, удалённые) — одинаковые на сайте и в приложении
    if (a === 'prefs') return json({ p: (await jget('mp:' + me)) || {} });
    if (a === 'pch') { const u = String(q('u') || ''); if (!/^\d{1,12}$/.test(u)) return json({ ch: null }); const c = await kv('GET', 'pch:' + u); const g = c ? await gget(c) : null;
      if (!g || g.type !== 'channel') return json({ ch: null });
      const meta = await kv('HGET', 'ci:' + g.owner, c); let o = {}; try { o = JSON.parse(meta || '{}'); } catch (e) {}
      return json({ ch: { id: g.id, title: g.title, about: g.about || '', n: (g.members || []).length, col: g.col || 0, av: g.av || 0, vf: !!g.vf, type: 'channel', inv: g.inv, pv: o.pv ? (await open(c, o.pv)) || '' : '', t: o.t || 0, member: (g.members || []).map(String).includes(String(me)) } }); }
    // ---- звонки (WebRTC): сервер только передаёт описания соединения, сам звук и видео идут напрямую между людьми ----
    if (a === 'ice') {
      const L = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
      if (process.env.TURN_URL) L.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
      // запасной публичный TURN (Open Relay): помогает, когда напрямую не соединиться (мобильный интернет, VPN). Свой TURN из переменных надёжнее.
      else L.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
      return json({ ice: L });
    }
    if (a === 'cget') {
      const id = String(q('id') || ''), k = await jget('call:' + id);
      if (!k || !inCall(k, me)) return json({ st: 'end', why: k ? k.why || '' : '' });
      const n = Math.max(0, +q('n') || 0), L = (await kv('LRANGE', 'cq:' + id + ':' + me, String(n), '-1')) || [];
      return json({ st: k.st, kind: k.kind, from: k.from, members: k.members, inv: k.inv, t0: k.t0 || 0, why: k.why || '', vid: k.vid || {}, mic: k.mic || {}, msgs: L.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean), n: n + L.length });
    }
    if (req.method !== 'POST' && a !== 'file') return json({ error: 'Неизвестный запрос' }, 404);
    if (a === 'psub') {
      const sub = body.sub; if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return json({ error: 'Плохая подписка' }, 400);
      const h = (await sign('ps:' + sub.endpoint)).slice(0, 16);
      await kv('HSET', 'ps:' + me, h, JSON.stringify({ endpoint: sub.endpoint }));
      return json({ ok: 1 });
    }
    // ---- звонок = комната: members — в разговоре, inv — кому звонят. Каждый новый участник сам соединяется со всеми (сетка WebRTC). ----
    if (a === 'call' || a === 'cadd') {
      const to = String(body.to || ''), kind = body.kind === 'video' ? 'video' : 'audio';
      if (!/^\d{1,12}$/.test(to) || to === String(me)) return json({ error: 'Кому звонить?' }, 400);
      if (!(await kv('GET', 'id:' + to))) return json({ error: 'Аккаунт не найден' }, 404);
      const busy = await kv('GET', 'cin:' + to); if (busy) { const b = await jget('call:' + busy); if (b && b.st !== 'end' && Date.now() - b.t < 3 * 3600e3 && (b.members.includes(+to) || ringing(b, to))) return json({ error: 'Абонент разговаривает' }, 409); }
      let k;
      if (a === 'call') {
        const id = String(await kv('INCR', 'callseq')) + Math.random().toString(36).slice(2, 7);
        k = { id, from: +me, first: +to, kind, st: 'ring', t: Date.now(), members: [+me], inv: [+to], invT: { [to]: Date.now() }, invBy: { [to]: +me }, vid: { [me]: kind === 'video' }, mic: {} };
      } else {
        k = await jget('call:' + String(body.id || '')); if (!k || k.st === 'end' || !k.members.includes(+me)) return json({ error: 'Звонок не найден' }, 404);
        if (k.members.includes(+to) || k.inv.includes(+to)) return json({ ok: 1 });
        if (k.members.length + k.inv.length >= 8) return json({ error: 'В звонке максимум 8 человек' }, 400);
        k.inv.push(+to); k.invT = { ...(k.invT || {}), [to]: Date.now() }; k.invBy = { ...(k.invBy || {}), [to]: +me };
      }
      await jset('call:' + k.id, k);
      await kvMulti([['EXPIRE', 'call:' + k.id, '21600'], ['SET', 'cin:' + to, k.id, 'EX', '60'], ['INCR', 'mv:' + to]]);
      await pushTo(to, true);
      return json({ id: k.id });
    }
    if (a === 'cjoin' || a === 'csig' || a === 'cstate' || a === 'cend') {
      const id = String(body.id || ''); const k = await jget('call:' + id);
      if (!k || !inCall(k, me)) return json({ error: 'Звонок уже завершён' }, 409);
      if (a === 'csig') {
        const to = String(body.to || ''); if (!k.members.includes(+to) && !k.inv.includes(+to)) return json({ ok: 1 });
        const d = JSON.stringify({ from: +me, d: body.d }); if (d.length > 70000) return json({ error: 'Слишком большие данные' }, 400);
        await kvMulti([['RPUSH', 'cq:' + id + ':' + to, d], ['EXPIRE', 'cq:' + id + ':' + to, '21600']]); return json({ ok: 1 });
      }
      if (a === 'cstate') { k.vid = { ...(k.vid || {}), [me]: !!body.vid }; k.mic = { ...(k.mic || {}), [me]: body.mic === false ? false : true }; await jset('call:' + id, k); return json({ ok: 1 }); }
      if (k.st === 'end') return json({ error: 'Звонок уже завершён' }, 409);
      if (a === 'cjoin') {
        if (!k.inv.includes(+me)) return json({ others: k.members.filter(x => x !== +me) });
        const others = k.members.slice();
        k.inv = k.inv.filter(x => x !== +me); k.members.push(+me); k.st = 'on'; k.t0 = k.t0 || Date.now(); k.vid = { ...(k.vid || {}), [me]: !!body.video };
        await jset('call:' + id, k); await kv('SET', 'cin:' + me, id, 'EX', '21600');
        return json({ others });
      }
      // cend: отклонить приглашение или выйти из звонка
      const wasInv = k.inv.includes(+me);
      k.inv = k.inv.filter(x => x !== +me); k.members = k.members.filter(x => x !== +me);
      const ops = [['DEL', 'cin:' + me]];
      const alive = k.members.length + (k.members.length ? k.inv.filter(x => Date.now() - ((k.invT || {})[x] || 0) < 50000).length : 0);
      if (alive <= 1 || !k.members.length) {
        k.st = 'end'; k.t1 = Date.now(); k.why = wasInv ? 'decline' : k.t0 ? 'hang' : String(body.why || 'hang').slice(0, 12);
        for (const u of [...k.members, ...k.inv]) ops.push(['DEL', 'cin:' + u]);
        for (const u of new Set([k.from, k.first, ...k.members, ...k.inv, +me])) ops.push(['INCR', 'mv:' + u]);
        await jset('call:' + id, k); await kvMulti(ops);
        // запись о звонке в переписке звонившего и первого собеседника
        const c = chatId(k.from, k.first), d = k.t0 ? Math.round((k.t1 - k.t0) / 1000) : 0, miss = !k.t0;
        const pv = (k.kind === 'video' ? 'Видеозвонок' : 'Звонок') + (miss ? (k.why === 'decline' ? ' · отклонён' : ' · пропущен') : ' · ' + Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0'));
        await push(c, String(k.from), { dm: 1 }, { f: +k.from, t: Date.now(), x: '', cl: { k: k.kind, d, miss: miss ? 1 : 0, why: k.why } }, pv);
        if (miss && !wasInv) { await kv('SET', 'cmiss:' + k.first, JSON.stringify({ id: k.id, from: k.from }), 'EX', '600'); await pushTo(String(k.first), true); }
      } else { await jset('call:' + id, k); await kvMulti(ops); }
      return json({ ok: 1 });
    }

    if (a === 'send') {
      const D = await dest(body.to, me); if (D.err) return json({ error: D.err }, 403); const c = D.c;
      const x = String(body.x || '').slice(0, 4000);
      const fl = body.fl && typeof body.fl === 'object' ? { id: String(body.fl.id || '').slice(0, 20), n: String(body.fl.n || 'файл').slice(0, 120), ty: String(body.fl.ty || '').slice(0, 80), sz: +body.fl.sz || 0, w: +body.fl.w || 0, h: +body.fl.h || 0, d: +body.fl.d || 0, th: String(body.fl.th || '').slice(0, 6000), wf: String(body.fl.wf || '').replace(/[^0-9a-z]/g, '').slice(0, 80), vo: body.fl.vo ? 1 : 0, rd: body.fl.rd ? 1 : 0, ...(body.fl.once ? { once: 1 } : {}), ...(body.fl.doc ? { doc: 1 } : {}), ...(+body.fl.a > 0 ? { a: Math.round(+body.fl.a * 100) / 100 } : {}), ...(+body.fl.b > 0 ? { b: Math.round(+body.fl.b * 100) / 100 } : {}) } : null;
      if (fl) { const m = await jget('mf:' + fl.id); if (!m || m.c !== c || m.o !== me) return json({ error: 'Файл не загружен' }, 400); }
      if (!x.trim() && !fl) return json({ error: 'Пустое сообщение' }, 400);
      const t = Date.now(), m = { f: +me, t, x, ...(fl ? { fl } : {}), ...(body.r != null ? { r: +body.r } : {}) };
      const len = await push(c, me, D.G, m, x.trim() ? x.slice(0, 80) : (fl.vo ? '🎤 Голосовое' : fl.rd ? '📹 Видеосообщение' : fl.ty.startsWith('image/') ? '🖼 Фото' : fl.ty.startsWith('video/') ? '🎬 Видео' : '📎 ' + fl.n));
      if (D.bot) await botGot(D.bot, me, W.email, c, len - 1, m);
      return json({ ok: 1, c, m: { ...m, i: len - 1 }, tmp: body.tmp });
    }
    if (a === 'fwd') { // переслать сообщение (и файл) в другой чат: файл перешифровывается ключом нового чата
      const c0 = String(body.c || ''), i = +body.i;
      if (!(await access(c0, me)) || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const D = await dest(body.to, me); if (D.err) return json({ error: D.err }, 403);
      const [r] = await kvMulti([['LRANGE', 'cm:' + c0, String(i), String(i)]]); const m0 = JSON.parse((await open(c0, r && r[0])) || 'null');
      if (!m0 || m0.d) return json({ error: 'Сообщение недоступно' }, 404);
      const c = D.c; let fl = null;
      if (m0.fl && m0.fl.id) {
        const fm = await jget('mf:' + m0.fl.id); if (!fm) return json({ error: 'Файл не найден' }, 404);
        const parts = await kvMulti(Array.from({ length: fm.k }, (_, k) => ['GET', 'mfc:' + m0.fl.id + ':' + k]));
        const nid = rand(10);
        await jset('mf:' + nid, { ...fm, c, o: me, t: Date.now() });
        for (let k = 0; k < parts.length; k++) await kv('SET', 'mfc:' + nid + ':' + k, await seal(c, await open(c0, parts[k], true)));
        fl = { ...m0.fl, id: nid };
      }
      const t = Date.now(), m = { f: +me, t, x: m0.x || '', ...(fl ? { fl } : {}), ...(body.plain ? {} : { fw: +(m0.fw ?? m0.f) }) };
      await push(c, me, D.G, m, '↪ ' + (m.x ? m.x.slice(0, 70) : fl ? (fl.vo ? 'Голосовое' : fl.rd ? 'Видеосообщение' : fl.n) : ''));
      return json({ ok: 1, c });
    }
    if (a === 'read') {
      const c = String(body.c || ''); const G = await access(c, me); if (!G) return json({ error: 'Нет доступа' }, 403);
      await kvMulti([['HSET', 'cr:' + c, me, String(+body.s || 0)], ['HSET', 'cu:' + me, c, '0'], ...bumpAll(me, c, G)]);
      return json({ ok: 1 });
    }
    if (a === 'typing') {
      const c = String(body.c || ''); const G = await access(c, me); if (!G) return json({ error: 'Нет доступа' }, 403);
      if (isG(c)) { if (G.type === 'channel') return json({ ok: 1 }); await kvMulti([['SET', 'tyg:' + c, String(me), 'EX', '5'], ...others(c, me, G).map(u => ['INCR', 'mv:' + u])]); return json({ ok: 1 }); }
      const p = peerOf(c, me); if (p === me) return json({ ok: 1 });
      await kvMulti([['SET', 'ty:' + c + ':' + me, '1', 'EX', '5'], ['INCR', 'mv:' + p]]);
      return json({ ok: 1 });
    }
    if (a === 'del') {
      const c = String(body.c || ''), i = +body.i; const G = await access(c, me); if (!G || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const [r] = await kvMulti([['LRANGE', 'cm:' + c, String(i), String(i)]]); const m = JSON.parse((await open(c, r && r[0])) || 'null');
      if (!m) return json({ error: 'Сообщение не найдено' }, 404);
      if (isG(c) && (body.all !== 0 && body.all !== false) && String(m.f) !== String(me) && !isAdm(G, me)) return json({ error: 'Удалить у всех можно только свои сообщения' }, 403);
      // «удалить только у меня» — сообщение прячется только для этого человека
      if (body.all === 0 || body.all === false) { await kvMulti([['HSET', 'ch:' + c + ':' + me, String(i), '1'], ['INCR', 'mv:' + me]]); return json({ ok: 1 }); }
      await kvMulti([['LSET', 'cm:' + c, String(i), await seal(c, JSON.stringify({ f: m.f, t: m.t, x: '', d: 1 }))], ['HSET', 'cd:' + c, String(i), '1'], ['HDEL', 'cx:' + c, String(i)], ['HDEL', 'ce:' + c, String(i)], ...bumpAll(me, c, G)]);
      if (m.fl && m.fl.id) { const fm = await jget('mf:' + m.fl.id); if (fm) await kvMulti([['DEL', 'mf:' + m.fl.id], ...Array.from({ length: fm.k }, (_, k) => ['DEL', 'mfc:' + m.fl.id + ':' + k])]); }
      return json({ ok: 1 });
    }
    if (a === 'react') { // одна реакция от человека на сообщение; та же ещё раз — снять
      const c = String(body.c || ''), i = +body.i, e = String(body.e || '').slice(0, 16);
      const G = await access(c, me); if (!G || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const cur = await kv('HGET', 'cx:' + c, String(i)); let o = {}; try { o = JSON.parse(cur) || {}; } catch (_) {}
      if (!e || o[me] === e) delete o[me]; else o[me] = e;
      await kvMulti([Object.keys(o).length ? ['HSET', 'cx:' + c, String(i), JSON.stringify(o)] : ['HDEL', 'cx:' + c, String(i)], ...bumpAll(me, c, G)]);
      return json({ ok: 1, rx: o });
    }
    if (a === 'edit') {
      const c = String(body.c || ''), i = +body.i, x = String(body.x || '').slice(0, 4000);
      const G = await access(c, me); if (!G || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const m = await msgAt(c, i); if (!m || m.d || String(m.f) !== me) return json({ error: 'Можно изменить только своё сообщение' }, 403);
      if (!x.trim() && !m.fl) return json({ error: 'Пустое сообщение' }, 400);
      await kvMulti([['HSET', 'ce:' + c, String(i), await seal(c, JSON.stringify({ x, t: Date.now() }))], ...bumpAll(me, c, G)]);
      return json({ ok: 1 });
    }
    if (a === 'pin') {
      const c = String(body.c || ''), i = +body.i; const G = await access(c, me); if (!G) return json({ error: 'Нет доступа' }, 403);
      if (isG(c) && !isAdm(G, me)) return json({ error: 'Закреплять могут только администраторы' }, 403);
      await kvMulti([i >= 0 ? ['SET', 'cp:' + c, String(i)] : ['DEL', 'cp:' + c], ...bumpAll(me, c, G)]);
      return json({ ok: 1 });
    }
    if (a === 'once') { // одноразовое голосовое/кружок: получатель открыл — сообщение и файл стираются у обоих
      const c = String(body.c || ''), i = +body.i; const G = await access(c, me); if (!G || !G.dm || !(i >= 0)) return json({ error: 'Нет доступа' }, 403);
      const m = await msgAt(c, i); if (!m || m.d || !m.fl || !m.fl.once || String(m.f) === me) return json({ ok: 1 });
      await kvMulti([['LSET', 'cm:' + c, String(i), await seal(c, JSON.stringify({ f: m.f, t: m.t, x: '', d: 1, o1: 1 }))], ['HSET', 'cd:' + c, String(i), '1'], ...bumpAll(me, c, G)]);
      if (m.fl.id) { const fm = await jget('mf:' + m.fl.id); if (fm) await kvMulti([['DEL', 'mf:' + m.fl.id], ...Array.from({ length: fm.k }, (_, k) => ['DEL', 'mfc:' + m.fl.id + ':' + k])]); }
      return json({ ok: 1 });
    }
    if (a === 'up') {
      const D = await dest(body.to, me); if (D.err) return json({ error: D.err }, 403);
      const c = D.c, n = Math.min(24, Math.max(1, +body.n || 1)), i = +body.i;
      if (!(i >= 0 && i < n)) return json({ error: 'Неверный кусок' }, 400);
      const data = String(body.data || ''); if (data.length > 760_000) return json({ error: 'Кусок слишком большой' }, 413);
      let id = String(body.id || '');
      if (!id) { if (+body.size > 12 * 1024 * 1024) return json({ error: 'Файл больше 12 МБ' }, 413); id = rand(10); await jset('mf:' + id, { c, o: me, k: n, ty: String(body.type || 'application/octet-stream').slice(0, 80), n: String(body.name || 'файл').slice(0, 120), sz: +body.size || 0, t: Date.now() }); }
      else { const m = await jget('mf:' + id); if (!m || m.o !== me || m.c !== c) return json({ error: 'Нет доступа' }, 403); }
      await kv('SET', 'mfc:' + id + ':' + i, await seal(c, ub64(data)));
      return json({ ok: 1, id });
    }
    if (a === 'file') {
      const id = String(q('id') || ''); const m = await jget('mf:' + id); if (!m || !(await access(m.c, me))) return new Response('Нет доступа', { status: 403 });
      const parts = await kvMulti(Array.from({ length: m.k }, (_, k) => ['GET', 'mfc:' + id + ':' + k]));
      const bufs = await Promise.all(parts.map(p => open(m.c, p, true)));
      if (bufs.some(b => !b)) return new Response('Файл ещё загружается или повреждён', { status: 409 });
      const total = bufs.reduce((n, b) => n + b.length, 0), out = new Uint8Array(total); let o = 0; bufs.forEach(b => { out.set(b, o); o += b.length; });
      return new Response(out, { headers: { 'content-type': m.ty, 'content-length': String(total), 'cache-control': 'private, max-age=31536000, immutable', 'content-disposition': (q('dl') ? 'attachment' : 'inline') + '; filename="' + (m.n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'file') + "\"; filename*=UTF-8''" + encodeURIComponent(m.n) } });
    }
    if (a === 'gnew') {
      const type = body.type === 'channel' ? 'channel' : 'group', title = String(body.title || '').trim().slice(0, 64);
      if (!title) return json({ error: type === 'channel' ? 'Назови канал' : 'Назови группу' }, 400);
      const ids = [...new Set((body.ids || []).map(String).filter(x => /^\d{1,12}$/.test(x) && x !== String(me)))].slice(0, 199);
      const ok = ids.length ? await kvMulti(ids.map(id => ['GET', 'id:' + id])) : [];
      const members = [String(me), ...ids.filter((_, k) => ok[k])];
      const n = await kv('INCR', 'gseq'); const c = 'g' + n;
      const g = { id: c, type, title, about: String(body.about || '').slice(0, 255), owner: String(me), admins: [String(me)], members, inv: rand(8), t: Date.now(), col: n % 7 };
      if (okAva(body.ava)) { g.av = Date.now(); await kv('SET', 'ga:' + c, body.ava); }
      await jset('gr:' + c, g);
      await push(c, me, g, { f: +me, t: Date.now(), x: '', sys: 'new', st: type }, type === 'channel' ? 'Канал создан' : 'Группа создана');
      return json({ ok: 1, c, g: gOut(g, me) });
    }
    if (a === 'gadd' || a === 'gkick' || a === 'gedit' || a === 'gadmin' || a === 'gleave' || a === 'gverify') {
      const c = String(body.c || ''); const g = await access(c, me); if (!g || g.dm) return json({ error: 'Нет доступа' }, 403);
      const adm = isAdm(g, me);
      if (a === 'gadd') {
        if (g.type === 'channel' ? !adm : false) return json({ error: 'Добавлять могут только администраторы' }, 403);
        const ids = [...new Set((body.ids || []).map(String).filter(x => /^\d{1,12}$/.test(x) && !g.members.map(String).includes(x)))].slice(0, 200 - g.members.length);
        const ok = ids.length ? await kvMulti(ids.map(id => ['GET', 'id:' + id])) : []; const add = ids.filter((_, k) => ok[k]); if (!add.length) return json({ ok: 1, g: gOut(g, me) });
        g.members.push(...add); await jset('gr:' + c, g);
        await push(c, me, g, { f: +me, t: Date.now(), x: '', sys: 'add', u: add.map(Number) }, 'Новые участники');
        return json({ ok: 1, g: gOut(g, me) });
      }
      if (a === 'gverify') { if (!SUP(me)) return json({ error: 'Нет прав' }, 403); g.vf = !!body.on; await jset('gr:' + c, g); await kvMulti(bumpAll(me, c, g)); return json({ ok: 1, g: gOut(g, me) }); }
      if (a === 'gkick') { const u = String(body.u || ''); if (!isOwn(g, me) || u === String(g.owner) || SUP(u)) return json({ error: 'Нет прав' }, 403);
        g.members = g.members.filter(x => String(x) !== u); g.admins = g.admins.filter(x => String(x) !== u); await jset('gr:' + c, g);
        await kvMulti([['HDEL', 'ci:' + u, c], ['HDEL', 'cu:' + u, c], ['INCR', 'mv:' + u]]); await push(c, me, g, { f: +me, t: Date.now(), x: '', sys: 'kick', u: [+u] }, 'Участник удалён'); return json({ ok: 1, g: gOut(g, me) }); }
      if (a === 'gedit') { if (!adm) return json({ error: 'Нет прав' }, 403); const t = String(body.title || '').trim().slice(0, 64); if (t) g.title = t; if (body.about != null) g.about = String(body.about).slice(0, 255);
        if (body.ava === '') { g.av = 0; await kv('DEL', 'ga:' + c); } else if (okAva(body.ava)) { g.av = Date.now(); await kv('SET', 'ga:' + c, body.ava); }
        await jset('gr:' + c, g); await kvMulti(bumpAll(me, c, g)); return json({ ok: 1, g: gOut(g, me) }); }
      if (a === 'gadmin') { const u = String(body.u || ''); if (!isOwn(g, me) || !g.members.map(String).includes(u) || u === String(g.owner)) return json({ error: 'Нет прав' }, 403);
        g.admins = body.on ? [...new Set([...g.admins.map(String), u])] : g.admins.filter(x => String(x) !== u || u === String(g.owner)); await jset('gr:' + c, g); await kvMulti(bumpAll(me, c, g)); return json({ ok: 1 }); }
      if (a === 'gleave') {
        g.members = g.members.filter(x => String(x) !== String(me)); g.admins = g.admins.filter(x => String(x) !== String(me));
        if (String(g.owner) === String(me) && g.members.length) { g.owner = String(g.admins[0] || g.members[0]); if (!g.admins.map(String).includes(g.owner)) g.admins.push(g.owner); }
        await jset('gr:' + c, g); await kvMulti([['HDEL', 'ci:' + me, c], ['HDEL', 'cu:' + me, c], ['INCR', 'mv:' + me]]);
        if (g.members.length && g.type !== 'channel') await push(c, me, g, { f: +me, t: Date.now(), x: '', sys: 'left' }, 'Участник вышел'); else if (g.members.length) await kvMulti(g.members.map(u => ['INCR', 'mv:' + u]));
        return json({ ok: 1 });
      }
    }
    if (a === 'prefset') {
      const cur = (await jget('mp:' + me)) || {}, b = body.p || {}, ok = x => /^[\w-]{1,40}$/.test(String(x));
      if (Array.isArray(b.pins)) cur.pins = b.pins.filter(ok).slice(0, 5);
      if (Array.isArray(b.arch)) cur.arch = b.arch.filter(ok).slice(0, 500);
      if (Array.isArray(b.mute)) cur.mute = b.mute.filter(ok).slice(0, 500);
      if (b.hide && typeof b.hide === 'object') cur.hide = Object.fromEntries(Object.entries(b.hide).filter(([k, v]) => ok(k) && +v > 0).slice(-500).map(([k, v]) => [k, +v]));
      await jset('mp:' + me, cur); return json({ ok: 1, p: cur });
    }
    if (a === 'pchset') { const c = String(body.c || ''); if (!c) { await kv('DEL', 'pch:' + me); return json({ ok: 1 }); }
      const g = await gget(c); if (!g || g.type !== 'channel' || !isOwn(g, me)) return json({ error: 'Можно добавить только свой канал' }, 403); await kv('SET', 'pch:' + me, c); return json({ ok: 1 }); }
    if (a === 'gjoin') {
      const c = String(body.c || ''); const g = await gget(c); if (!g || String(body.inv || '') !== g.inv) return json({ error: 'Ссылка недействительна' }, 403);
      if (g.members.map(String).includes(String(me))) return json({ ok: 1, c });
      if (g.members.length >= 200) return json({ error: 'Достигнут лимит участников' }, 403);
      g.members.push(String(me)); await jset('gr:' + c, g);
      if (g.type === 'channel') { const meta = await kv('HGET', 'ci:' + g.owner, c); const len = await kv('LLEN', 'cm:' + c); await kvMulti([['HSET', 'ci:' + me, c, meta || JSON.stringify({ t: Date.now(), f: +g.owner, pv: await seal(c, 'Канал'), n: len })], ['HSET', 'cu:' + me, c, '0'], ['HSET', 'cr:' + c, me, String(len - 1)], ['INCR', 'mv:' + me]]); }
      else await push(c, me, g, { f: +me, t: Date.now(), x: '', sys: 'join' }, 'Новый участник');
      return json({ ok: 1, c });
    }
    return json({ error: 'Неизвестный запрос' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}
