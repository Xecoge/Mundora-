// Mundora — люди: публичные профили, поиск аккаунтов по ID и нику, «капитализация» (очки активности).
// GET  /api/people?id=100001   — профиль
// GET  /api/people?q=…         — поиск (ID, ник; админы — ещё и по почте)
// POST /api/people?a=me {name,bio,avatar,open} — изменить свой профиль
// POST /api/people?a=avatar {data}        — своя аватарка из галереи (видят все)
// POST /api/people?a=cover {data|null}    — обложка СВОЕГО профиля (только админы); чужие обложки и аватарки не меняет никто
// GET  /api/people?img=ava|cov&id=…       — сама картинка
import { kv, kvMulti, pairs, jget, jset } from './_store.mjs';
import { guard, json, ensureId, maskEmail, displayName, AVATARS, ADMIN, putUser, getUser, avatarOf, coverOf, unlinkTg, rand } from './_auth.mjs';
import { checkName, claimName } from './_names.mjs';
export const config = { runtime: 'edge' };

const parse = v => { try { return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
// картинки приходят уже сжатыми с телефона/ПК: data:image/…;base64
const IMG_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/;
const LIMIT = { ava: 260e3, cov: 700e3 };
function checkImg(d, kind) { d = String(d || ''); if (!IMG_RE.test(d)) return 'Нужна картинка JPG, PNG или WebP'; if (d.length > LIMIT[kind]) return 'Картинка слишком большая'; return ''; }
function imgResponse(d) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(d || ''); if (!m) return new Response('Not found', { status: 404 });
  const bin = atob(m[2]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(u8, { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=31536000, immutable' } });
}
const SH0 = () => ({ st: {}, ver: {}, del: [], note: {}, until: {}, codes: [] });
async function shLog(by, act, target) {
  const log = (await jget('shlog')) || [];
  log.unshift({ t: Date.now(), by: by.id, byName: displayName(by), act, id: target ? target.id : null, name: target ? displayName(target) : '' });
  await jset('shlog', log.slice(0, 150));
}
const TITLES = [[1, 'Новичок'], [3, 'Слушатель'], [5, 'Меломан'], [8, 'Знаток'], [12, 'Легенда'], [18, 'Икона Mundora']];
const titleOf = l => TITLES.filter(([n]) => l >= n).pop()[1];
const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

// «Капитализация» — очки за то, что человек делал на сайте (без сумм денег и текстов заметок)
function capital(u, d) {
  const likes = Object.keys(d.likes || {}).length, pls = Array.isArray(d.playlists) ? d.playlists : [];
  const plTracks = pls.reduce((n, p) => n + ((p.tracks || []).length), 0);
  const events = (d.taste && d.taste.events) || 0, plays = Array.isArray(d.plays) ? d.plays.length : 0;
  const notes = Array.isArray(d.notes) ? d.notes.length : 0, ops = Array.isArray(d.ops) ? d.ops.length : 0;
  const days = Math.max(1, Math.ceil((Date.now() - (u.created || Date.now())) / 864e5));
  const parts = [['Лайки', likes * 5], ['Плейлисты', pls.length * 20 + plTracks * 2], ['Прослушивания', Math.max(events, plays)], ['Заметки', notes * 8], ['Финансы', ops * 3], ['Дни в Mundora', days * 10], ['Галочка', u.verified ? 500 : 0]];
  const score = parts.reduce((n, p) => n + p[1], 0);
  const level = Math.floor(Math.sqrt(score / 50)) + 1;
  return { score, level, title: titleOf(level), from: 50 * (level - 1) ** 2, to: 50 * level ** 2, parts: parts.filter(p => p[1] > 0), stats: { likes, playlists: pls.length, plTracks, plays: Math.max(events, plays), notes, ops, days } };
}

async function card(email, viewer, full) {
  const L = viewer.shadow ? ((await jget('sh:' + viewer.email)) || {}) : null;
  const [uj, adm0, sh] = await kvMulti([['GET', 'u:' + email], ['SISMEMBER', 'admins', email], ['SISMEMBER', 'shadow_admins', email]]);
  const u = parse(uj); if (!u) return null;
  await ensureId(u);
  const owner = email === ADMIN(), self = viewer.email === email;
  const adm = adm0 || (self && sh); // визуальный админ видит галочку только у себя
  const base = {
    id: u.id, name: displayName(u), bio: u.bio || '', avatar: avatarOf(u), cover: coverOf(u), tg: u.tg ? { username: u.tg.username || '', name: u.tg.name || '' } : null,
    verified: !!(u.verified || owner || adm), admin: owner || !!adm, owner, self,
    email: viewer.admin || self ? email : maskEmail(email), status: viewer.admin ? (u.status || 'active') : undefined,
    online: Date.now() - (u.seen || 0) < 6 * 60e3, seen: u.seen ? Math.floor(u.seen / 6e4) * 6e4 : 0, joined: u.created || 0, open: u.open !== false
  };
  // визуальный админ видит свои «изменения» чужих обложек/аватарок только сам
  if (L && !self) { const k = String(u.id); if (L.cov && k in L.cov) base.cover = L.cov[k] ? `/api/people?img=cov&id=${u.id}&sh=1&v=${L.cov[k]}` : ''; if (L.ava && L.ava[k]) base.avatar = owner ? 'gem_orbit' : 'planet'; }
  if (!full) return base;
  const keys = ['likes', 'playlists', 'plays', 'taste', 'cryptoFav', 'notes', 'ops'];
  const vals = await kv('HMGET', 'd:' + email, ...keys);
  const d = {}; keys.forEach((k, i) => { d[k] = parse(vals[i]); });
  const cap = capital(u, d);
  const out = { ...base, capital: cap };
  if (base.open || self || viewer.admin) {
    const t = d.taste || {};
    out.genres = top(t.genre, 4).map(x => x[0]);
    out.artists = top(t.artist, 6).map(([id]) => (t.artistName || {})[id]).filter(Boolean);
    out.likes = Object.values(d.likes || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 12);
    out.playlists = (Array.isArray(d.playlists) ? d.playlists : []).slice(0, 12).map(p => ({ id: p.id, name: p.name, count: (p.tracks || []).length, tracks: (p.tracks || []).slice(0, 60) }));
    out.crypto = Array.isArray(d.cryptoFav) ? d.cryptoFav.slice(0, 12) : [];
  }
  return out;
}

export default async function handler(req) {
  const g = await guard(req, true); if (g.res) return g.res;
  const me = g.user, url = new URL(req.url), a = url.searchParams.get('a');
  try {
    if (req.method === 'POST' && a === 'me') {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — профиль не меняется' }, 423);
      const b = await req.json().catch(() => ({}));
      const u = await getUser(me.email);
      if (b.name != null && String(b.name).trim() !== (u.name || '')) {
        const nc = await checkName(b.name, me.email, { admin: me.admin });
        if (!nc.ok) return json({ error: nc.reason, field: 'name' }, 400);
        if (!(await claimName(nc.name, me.email, u.name))) return json({ error: 'Это имя уже занято', field: 'name' }, 409);
        u.name = nc.name;
      }
      if (b.bio != null) u.bio = String(b.bio).replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, 160);
      if (b.avatar != null && AVATARS.includes(b.avatar)) u.avatar = b.avatar;
      if (b.open != null) u.open = !!b.open;
      await putUser(u);
      return json({ ok: true, profile: await card(me.email, me, true) });
    }
    const img = url.searchParams.get('img');
    if (img === 'ava' || img === 'cov') {
      const id0 = url.searchParams.get('id'), em = /^\d{1,12}$/.test(id0 || '') ? await kv('GET', 'id:' + id0) : null;
      if (!em) return new Response('Not found', { status: 404 });
      const key = img === 'cov' && url.searchParams.get('sh') && me.shadow ? 'img:cov:sh:' + me.email + ':' + id0 : 'img:' + img + ':' + em;
      return imgResponse(await kv('GET', key));
    }
    if (req.method === 'POST' && a === 'tg-link') { // ссылка на бота: /start acc_<token> привяжет Telegram
      let me2 = (await jget('tg:me')) || null;
      const tok = String((typeof process !== 'undefined' && process.env && (process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN)) || '').trim();
      if (!me2 && tok) { try { const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`); const j = await r.json(); if (j.ok) { me2 = j.result; await jset('tg:me', me2); } } catch (e) {} }
      if (!me2 || !me2.username) return json({ error: 'Бот Mundora ещё не подключён — напиши администратору' }, 503);
      const t = rand(12); await kv('SET', 'tg:acc:' + t, me.email, 'EX', 900);
      return json({ url: `https://t.me/${me2.username}?start=acc_${t}` });
    }
    if (req.method === 'POST' && a === 'tg-unlink') { await unlinkTg(me.email); return json({ ok: true, profile: await card(me.email, me, true) }); }
    if (req.method === 'POST' && a === 'avatar') {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — профиль не меняется' }, 423);
      const b = await req.json().catch(() => ({})), bad = checkImg(b.data, 'ava'); if (bad) return json({ error: bad }, 400);
      const u = await getUser(me.email); await ensureId(u);
      u.avatar = 'up:' + Date.now().toString(36);
      await kv('SET', 'img:ava:' + me.email, b.data); await putUser(u);
      return json({ ok: true, profile: await card(me.email, me, true) });
    }
    if (req.method === 'POST' && (a === 'cover' || a === 'avatar-reset')) {
      if (!me.admin && !me.shadow) return json({ error: 'Это могут только администраторы' }, 403);
      const b = await req.json().catch(() => ({})), tid = String(b.id ?? '');
      const em = /^\d{1,12}$/.test(tid) ? await kv('GET', 'id:' + tid) : null; if (!em) return json({ error: 'Аккаунт не найден' }, 404);
      const t = await getUser(em); if (!t) return json({ error: 'Аккаунт не найден' }, 404);
      const self = em === me.email, tOwner = em === ADMIN();
      if (!self || a !== 'cover') return json({ error: 'Чужие обложки и аватарки менять нельзя — только свои' }, 403);
      if (tOwner && !me.owner) return json({ error: 'Профиль владельца менять нельзя' }, 403);
      if (a === 'cover' && b.data) { const bad = checkImg(b.data, 'cov'); if (bad) return json({ error: bad }, 400); }
      if (me.shadow && !self) { // визуальный админ: меняется только его личный слой
        const L = { ...SH0(), ...((await jget('sh:' + me.email)) || {}) };
        if (a === 'cover') { L.cov = L.cov || {}; if (b.data) { const v = Date.now().toString(36); await kv('SET', 'img:cov:sh:' + me.email + ':' + tid, b.data); L.cov[tid] = v; } else L.cov[tid] = ''; }
        else { L.ava = L.ava || {}; L.ava[tid] = 1; }
        await jset('sh:' + me.email, L); await shLog(me, a === 'cover' ? (b.data ? 'cover' : 'cover-del') : 'avatar-reset', t);
        return json({ ok: true, profile: await card(em, me, true) });
      }
      if (a === 'cover') {
        if (b.data) { t.cover = 'up:' + Date.now().toString(36); await kv('SET', 'img:cov:' + em, b.data); }
        else { delete t.cover; await kv('DEL', 'img:cov:' + em); }
      } else if (typeof t.avatar === 'string' && t.avatar.startsWith('up:')) { t.avatar = tOwner ? 'gem_orbit' : 'planet'; await kv('DEL', 'img:ava:' + em); }
      await putUser(t);
      return json({ ok: true, profile: await card(em, me, true) });
    }
    const id = url.searchParams.get('id');
    if (id) {
      const email = /^\d{1,12}$/.test(id) ? await kv('GET', 'id:' + id) : null;
      const p = email && await card(email, me, true);
      return p ? json({ profile: p }) : json({ error: 'Аккаунт с таким ID не найден' }, 404);
    }
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().replace(/^(id|#)\s*/i, '');
    if (!q) return json({ people: [] });
    const emails = await kv('SMEMBERS', 'users');
    const us = (await kvMulti(emails.map(e => ['GET', 'u:' + e]))).map(parse).filter(u => u && u.status !== 'banned');
    const hit = u => (u.id != null && (String(u.id) === q || (/^\d{2,}$/.test(q) && String(u.id).startsWith(q)))) || displayName(u).toLowerCase().includes(q) || (me.admin && u.email.includes(q));
    const found = us.filter(hit).sort((x, y) => (String(y.id) === q) - (String(x.id) === q) || (displayName(y).toLowerCase() === q) - (displayName(x).toLowerCase() === q) || (y.seen || 0) - (x.seen || 0)).slice(0, 20);
    const people = await Promise.all(found.map(u => card(u.email, me, false)));
    return json({ people: people.filter(Boolean) });
  } catch (e) { return json({ error: e.message }, 500); }
}
