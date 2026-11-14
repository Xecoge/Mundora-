// Mundora — люди: публичные профили, поиск аккаунтов по ID и нику, «капитализация» (очки активности).
// GET  /api/people?id=100001   — профиль
// GET  /api/people?q=…         — поиск (ID, ник; админы — ещё и по почте)
// POST /api/people?a=me {name,bio,avatar,open} — изменить свой профиль
import { kv, kvMulti, pairs } from './_store.mjs';
import { guard, json, ensureId, maskEmail, displayName, AVATARS, ADMIN, putUser, getUser } from './_auth.mjs';
import { checkName, claimName } from './_names.mjs';
export const config = { runtime: 'edge' };

const parse = v => { try { return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
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
  const [uj, adm0, sh] = await kvMulti([['GET', 'u:' + email], ['SISMEMBER', 'admins', email], ['SISMEMBER', 'shadow_admins', email]]);
  const u = parse(uj); if (!u) return null;
  await ensureId(u);
  const owner = email === ADMIN(), self = viewer.email === email;
  const adm = adm0 || (self && sh); // визуальный админ видит галочку только у себя
  const base = {
    id: u.id, name: displayName(u), bio: u.bio || '', avatar: AVATARS.includes(u.avatar) ? u.avatar : (owner ? 'gem_orbit' : 'planet'),
    verified: !!(u.verified || owner || adm), admin: owner || !!adm, owner, self,
    email: viewer.admin || self ? email : maskEmail(email), status: viewer.admin ? (u.status || 'active') : undefined,
    online: Date.now() - (u.seen || 0) < 6 * 60e3, seen: u.seen ? Math.floor(u.seen / 6e4) * 6e4 : 0, joined: u.created || 0, open: u.open !== false
  };
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
