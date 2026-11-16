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
// уровни по очкам опыта: 1 ур. 0–1000, 2 ур. 1000–2500, 3 ур. 2500–5000 … 10 ур. — максимум
const LV = [0, 1000, 2500, 5000, 8500, 13000, 19000, 27000, 37000, 50000];
const TITLES = [[1, 'Новичок'], [2, 'Слушатель'], [4, 'Меломан'], [6, 'Знаток'], [8, 'Легенда'], [10, 'Икона Mundora']];
const titleOf = l => TITLES.filter(([n]) => l >= n).pop()[1];
// ---------- Подарки: покупаются за очки опыта (XP), показываются у аватарки ----------
const GIFTS = {
  usdt: { n: 'Стопка USDT', p: 250 }, btc: { n: 'Золотой биткоин', p: 300 }, doge: { n: 'Doge-монета', p: 350 },
  eth: { n: 'Эфир-кристалл', p: 400 }, ton: { n: 'Алмаз TON', p: 450 }, ledger: { n: 'Холодный кошелёк', p: 600 },
  rocket: { n: 'Ракета to the Moon', p: 800 }, bull: { n: 'Бык', p: 1200 }, bear: { n: 'Медведь', p: 1200 },
  miner: { n: 'Майнинг-риг', p: 1500 }, whale: { n: 'Кит', p: 2500 }, diamond: { n: 'Diamond Hands', p: 5000 }
};
const MAXPOS = 10; // сколько подарков можно разложить вокруг аватарки
const DEFPOS = [[20, 18], [80, 16], [10, 50], [90, 48], [22, 82], [78, 84], [36, 8], [64, 8], [6, 22], [94, 76]];
const giftsOut = u => (Array.isArray(u.gifts) ? u.gifts : []).filter(g => GIFTS[g.k]).map(g => ({ id: g.id, k: g.k, t: g.t, from: g.from || null }));
const clampP = v => Math.max(2, Math.min(98, Math.round(+v * 10) / 10 || 0));
function posOut(u) {
  const ids = new Set(giftsOut(u).map(g => g.id));
  let pos = Array.isArray(u.giftPos) ? u.giftPos : null;
  if (!pos && Array.isArray(u.giftSlots)) pos = u.giftSlots.map((id, i) => id && { id, x: DEFPOS[i][0], y: DEFPOS[i][1] }).filter(Boolean); // старые «места»
  const seen = new Set();
  return (pos || []).filter(p => p && ids.has(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, MAXPOS).map(p => ({ id: p.id, x: clampP(p.x), y: clampP(p.y) }));
}
// ---------- Криптокошелёк в профиле: только адрес для просмотра (баланс из блокчейна), ничего нельзя сделать ----------
const CHAINS = {
  btc: { n: 'Bitcoin', sym: 'BTC', cg: 'bitcoin', rx: /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, ex: a => 'https://mempool.space/address/' + a },
  eth: { n: 'Ethereum', sym: 'ETH', cg: 'ethereum', rx: /^0x[a-fA-F0-9]{40}$/, ex: a => 'https://etherscan.io/address/' + a },
  ton: { n: 'TON', sym: 'TON', cg: 'the-open-network', rx: /^((EQ|UQ|kQ|0Q|Ef|Uf)[A-Za-z0-9_-]{46}|-?[01]:[a-fA-F0-9]{64})$/, ex: a => 'https://tonviewer.com/' + a },
  tron: { n: 'TRON', sym: 'TRX', cg: 'tron', rx: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, ex: a => 'https://tronscan.org/#/address/' + a },
  sol: { n: 'Solana', sym: 'SOL', cg: 'solana', rx: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, ex: a => 'https://solscan.io/account/' + a }
};
const chainOf = a => ['eth', 'ton', 'tron', 'btc', 'sol'].find(k => CHAINS[k].rx.test(a)) || null;
const walletOut = u => (u.wallet && CHAINS[u.wallet.chain] ? { name: u.wallet.name || CHAINS[u.wallet.chain].n, chain: u.wallet.chain, net: CHAINS[u.wallet.chain].n, sym: CHAINS[u.wallet.chain].sym, addr: u.wallet.addr } : null);
async function fj(url, body) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
  try { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
async function walletBalance(chain, a) {
  const tokens = [];
  if (chain === 'btc') { const j = await fj('https://mempool.space/api/address/' + a); const c = j.chain_stats || {}, m = j.mempool_stats || {}; return { amt: ((c.funded_txo_sum || 0) - (c.spent_txo_sum || 0) + (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0)) / 1e8, tokens, txs: (c.tx_count || 0) + (m.tx_count || 0) }; }
  if (chain === 'eth') { let j; try { j = await fj('https://ethereum-rpc.publicnode.com', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [a, 'latest'] }); } catch (e) { j = await fj('https://cloudflare-eth.com', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [a, 'latest'] }); } return { amt: Number(BigInt(j.result || '0x0')) / 1e18, tokens }; }
  if (chain === 'ton') { try { const j = await fj('https://toncenter.com/api/v2/getAddressBalance?address=' + encodeURIComponent(a)); return { amt: Number(j.result || 0) / 1e9, tokens }; } catch (e) { const j = await fj('https://tonapi.io/v2/accounts/' + encodeURIComponent(a)); return { amt: Number(j.balance || 0) / 1e9, tokens }; } }
  if (chain === 'tron') { const j = await fj('https://api.trongrid.io/v1/accounts/' + a); const d = (j.data || [])[0] || {}; (d.trc20 || []).forEach(o => { const v = o.TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t; if (v != null) tokens.push({ sym: 'USDT', amt: Number(v) / 1e6, cg: 'tether' }); }); return { amt: Number(d.balance || 0) / 1e6, tokens }; }
  if (chain === 'sol') { const j = await fj('https://api.mainnet-beta.solana.com', { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [a] }); return { amt: Number((j.result || {}).value || 0) / 1e9, tokens }; }
  return { amt: 0, tokens };
}
async function cgPrices() {
  const c = await jget('wb:prices'); if (c && Date.now() - c.t < 180e3) return c.p;
  try { const p = await fj('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=' + Object.values(CHAINS).map(x => x.cg).concat('tether').join(',')); await jset('wb:prices', { t: Date.now(), p }); return p; } catch (e) { return (c && c.p) || {}; }
}
const nickOut = u => (u.nickGift && giftsOut(u).some(g => g.id === u.nickGift) ? u.nickGift : null);
const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

// «Капитализация» — очки за то, что человек делал на сайте (без сумм денег и текстов заметок)
function capital(u, d) {
  const likes = Object.keys(d.likes || {}).length, pls = Array.isArray(d.playlists) ? d.playlists : [];
  const plTracks = pls.reduce((n, p) => n + ((p.tracks || []).length), 0);
  const events = (d.taste && d.taste.events) || 0, plays = Array.isArray(d.plays) ? d.plays.length : 0;
  const notes = Array.isArray(d.notes) ? d.notes.length : 0, ops = Array.isArray(d.ops) ? d.ops.length : 0;
  const days = Math.max(1, Math.ceil((Date.now() - (u.created || Date.now())) / 864e5));
  const parts = [['Лайки', likes * 5], ['Плейлисты', pls.length * 20 + plTracks * 2], ['Прослушивания', Math.max(events, plays)], ['Заметки', notes * 8], ['Финансы', ops * 3], ['Дни в Mundora', days * 10], ['Галочка', u.verified ? 500 : 0], ['Бонус основателя', u.id != null && (String(u.id) === '0' || String(u.id) === '1') ? 50000 : 0]];
  const score = parts.reduce((n, p) => n + p[1], 0);
  const level = LV.filter(x => score >= x).length;
  return { score, level, max: LV.length, title: titleOf(level), from: LV[level - 1], to: LV[level] ?? null, ladder: LV, parts: parts.filter(p => p[1] > 0), stats: { likes, playlists: pls.length, plTracks, plays: Math.max(events, plays), notes, ops, days } };
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
    online: Date.now() - (u.seen || 0) < 6 * 60e3, seen: u.seen ? Math.floor(u.seen / 6e4) * 6e4 : 0, joined: u.created || 0, open: u.open !== false,
    gifts: giftsOut(u), pos: posOut(u), nick: nickOut(u), wallet: walletOut(u)
  };
  // визуальный админ видит свои «изменения» чужих обложек/аватарок только сам
  if (L && !self) { const k = String(u.id); if (L.cov && k in L.cov) base.cover = L.cov[k] ? `/api/people?img=cov&id=${u.id}&sh=1&v=${L.cov[k]}` : ''; if (L.ava && L.ava[k]) base.avatar = owner ? 'gem_orbit' : 'planet'; }
  if (!full) return base;
  const keys = ['likes', 'playlists', 'plays', 'taste', 'cryptoFav', 'notes', 'ops'];
  const vals = await kv('HMGET', 'd:' + email, ...keys);
  const d = {}; keys.forEach((k, i) => { d[k] = parse(vals[i]); });
  const cap = capital(u, d);
  cap.spent = Math.max(0, u.xpSpent || 0); cap.avail = Math.max(0, cap.score - cap.spent); // траты видны всем, как и рейтинг
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
    if (req.method === 'POST' && a === 'wallet-set') {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — профиль не меняется' }, 423);
      const b = await req.json().catch(() => ({})); const u = await getUser(me.email);
      const addr = String(b.addr || '').trim();
      if (!addr) { delete u.wallet; await putUser(u); return json({ ok: true, profile: await card(me.email, me, true) }); }
      const chain = chainOf(addr); if (!chain) return json({ error: 'Не похоже на адрес кошелька. Поддерживаются BTC, Ethereum (и сети EVM), TON, TRON и Solana' }, 400);
      const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || CHAINS[chain].n;
      u.wallet = { addr, chain, name, t: Date.now() }; await putUser(u);
      return json({ ok: true, profile: await card(me.email, me, true) });
    }
    if (a === 'wallet' && req.method === 'GET') {
      const id0 = url.searchParams.get('id'), em = /^\d{1,12}$/.test(id0 || '') ? await kv('GET', 'id:' + id0) : null;
      const u = em && await getUser(em); const w = u && walletOut(u); if (!w) return json({ error: 'Кошелёк не привязан' }, 404);
      const key = 'wb:' + w.chain + ':' + w.addr; let c = await jget(key);
      if (!c || Date.now() - c.t > 60e3) {
        try { const bal = await walletBalance(w.chain, w.addr); c = { t: Date.now(), ...bal }; await jset(key, c, 600); }
        catch (e) { if (!c) return json({ wallet: { ...w, explorer: CHAINS[w.chain].ex(w.addr) }, error: 'Блокчейн сейчас не отвечает — попробуй позже' }); }
      }
      const P = await cgPrices(), pr = (P[CHAINS[w.chain].cg] || {}).usd || 0, ch = (P[CHAINS[w.chain].cg] || {}).usd_24h_change;
      const tokens = (c.tokens || []).map(t => ({ sym: t.sym, amt: t.amt, usd: t.amt * (((P[t.cg] || {}).usd) || 1) }));
      const usd = c.amt * pr + tokens.reduce((n, t) => n + t.usd, 0);
      return json({ wallet: { ...w, explorer: CHAINS[w.chain].ex(w.addr) }, bal: { amt: c.amt, usd: c.amt * pr, price: pr, ch24: ch ?? null, tokens, total: usd, txs: c.txs ?? null, t: c.t } });
    }
    if (a === 'gifts' && req.method === 'GET') return json({ catalog: GIFTS, max: MAXPOS });
    if (req.method === 'POST' && a === 'gift-buy') {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — покупки недоступны' }, 423);
      const b = await req.json().catch(() => ({})), G = GIFTS[b.k];
      if (!G) return json({ error: 'Такого подарка нет' }, 400);
      const u = await getUser(me.email);
      const vals = await kv('HMGET', 'd:' + me.email, 'likes', 'playlists', 'plays', 'taste', 'notes', 'ops');
      const d = {}; ['likes', 'playlists', 'plays', 'taste', 'notes', 'ops'].forEach((k, i) => { d[k] = parse(vals[i]); });
      const avail = capital(u, d).score - (u.xpSpent || 0);
      if (avail < G.p) return json({ error: `Не хватает ${(G.p - avail).toLocaleString('ru-RU')} XP` }, 402);
      let tEmail = me.email;
      if (b.to != null && String(b.to) !== String(u.id)) { tEmail = /^\d{1,12}$/.test(String(b.to)) ? await kv('GET', 'id:' + b.to) : null; if (!tEmail) return json({ error: 'Получатель не найден' }, 404); }
      const t = tEmail === me.email ? u : await getUser(tEmail);
      if (!t) return json({ error: 'Получатель не найден' }, 404);
      t.gifts = Array.isArray(t.gifts) ? t.gifts : [];
      if (t.gifts.length >= 200) return json({ error: 'У получателя уже слишком много подарков' }, 400);
      const g = { id: rand(8), k: b.k, t: Date.now(), from: t === u ? null : { id: u.id, name: displayName(u) } };
      t.gifts.unshift(g);
      if (t === u && b.place !== false) { const ps = posOut(u); if (ps.length < MAXPOS) { const d = DEFPOS.find(([x, y]) => !ps.some(p => Math.abs(p.x - x) < 6 && Math.abs(p.y - y) < 6)) || DEFPOS[ps.length]; ps.push({ id: g.id, x: d[0], y: d[1] }); u.giftPos = ps; delete u.giftSlots; } }
      u.xpSpent = (u.xpSpent || 0) + G.p;
      await putUser(u); if (t !== u) await putUser(t);
      return json({ ok: true, gift: g, profile: await card(me.email, me, true) });
    }
    if (req.method === 'POST' && a === 'gift-layout') { // где лежат подарки у аватарки и какой стоит у ника
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — профиль не меняется' }, 423);
      const b = await req.json().catch(() => ({})); const u = await getUser(me.email);
      if (Array.isArray(b.pos)) { u.giftPos = b.pos; delete u.giftSlots; u.giftPos = posOut(u); }
      if (b.nick !== undefined) u.nickGift = b.nick && giftsOut(u).some(g => g.id === b.nick) ? b.nick : null;
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
    // ---------- Обменники: справочник, ведут админы ----------
    if (a === 'exch' && req.method === 'GET') {
      const list = (await jget('exch:list')) || [];
      // рейтинг каждого обменника из отзывов
      if (list.length) { const r = await kvMulti(list.map(x => ['GET', 'rvs:ex:' + x.id])); list.forEach((x, i) => { const v = parse(r[i]); x.rating = v && v.n ? { n: v.n, avg: Math.round(v.sum / v.n * 10) / 10 } : null; }); }
      return json({ list });
    }
    // ---------- Отзывы и рейтинг: о сайте (target=site) и об обменниках (target=ex:<id>) ----------
    if (a === 'reviews' || a === 'review' || a === 'review-del') {
      const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      const target = String(b.target || url.searchParams.get('target') || '');
      if (!/^(site|ex:[a-z0-9]{1,20})$/.test(target)) return json({ error: 'Неизвестно, к чему отзыв' }, 400);
      if (target.startsWith('ex:') && !((await jget('exch:list')) || []).some(x => 'ex:' + x.id === target)) return json({ error: 'Обменник не найден' }, 404);
      let list = (await jget('rv:' + target)) || [];
      const summary = L => { const n = L.length, sum = L.reduce((q, r) => q + r.s, 0); return { n, sum }; };
      const outList = L => ({ list: L.slice(0, 200).map(r => ({ uid: r.u, name: r.name, avatar: r.ava, stars: r.s, text: r.x, t: r.t, mine: r.u === me.id })), n: L.length, avg: L.length ? Math.round(summary(L).sum / L.length * 10) / 10 : 0, dist: [5, 4, 3, 2, 1].map(k => L.filter(r => r.s === k).length) });
      const save = async L => { await jset('rv:' + target, L.slice(0, 1000)); await kv('SET', 'rvs:' + target, JSON.stringify(summary(L))); };
      if (a === 'reviews') return json(outList(list));
      if (a === 'review') {
        if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — отзывы недоступны' }, 423);
        const st = Math.round(+b.stars); if (!(st >= 1 && st <= 5)) return json({ error: 'Поставь оценку от 1 до 5 звёзд' }, 400);
        const text = String(b.text || '').replace(/\s+\n/g, '\n').trim().slice(0, 800);
        const u = await getUser(me.email); await ensureId(u);
        const r = { u: u.id, name: displayName(u), ava: avatarOf(u), s: st, x: text, t: Date.now() };
        list = [r, ...list.filter(x => x.u !== u.id)];
        await save(list);
        return json(outList(list));
      }
      // удалить: свой отзыв — любой, чужой — только админ
      const uid = +b.uid; const own = uid === me.id;
      if (!own && !me.admin && !me.shadow) return json({ error: 'Удалять чужие отзывы могут только администраторы' }, 403);
      list = list.filter(x => x.u !== uid);
      if (own || me.admin) await save(list);
      return json(outList(list));
    }
    if (req.method === 'POST' && (a === 'exch-save' || a === 'exch-del')) {
      if (!me.admin && !me.shadow) return json({ error: 'Это могут только администраторы' }, 403);
      const b = await req.json().catch(() => ({}));
      let list = (await jget('exch:list')) || [];
      const fake = !me.admin; // визуальный админ: изменения только на экране, в базу не пишем
      if (a === 'exch-del') { list = list.filter(x => x.id !== b.id); if (!fake) await jset('exch:list', list); return json({ list }); }
      const str = (v, n) => String(v ?? '').trim().slice(0, n);
      const num = v => { const x = +String(v ?? '').replace(',', '.').replace(/\s/g, ''); return isFinite(x) && x > 0 ? x : null; };
      const pairs = (Array.isArray(b.pairs) ? b.pairs : []).slice(0, 30).map(r => ({ asset: str(r.asset, 10).toUpperCase(), fiat: str(r.fiat, 10).toUpperCase(), buy: num(r.buy), sell: num(r.sell), min: num(r.min), max: num(r.max), reserve: num(r.reserve) })).filter(r => r.asset && r.fiat && (r.buy || r.sell));
      const tg = str(b.tg, 40).replace(/^@|https?:\/\/t\.me\//g, '').replace(/[^\w]/g, '');
      if (!str(b.name, 60)) return json({ error: 'Укажи название' }, 400);
      if (!tg) return json({ error: 'Укажи Telegram-ник обменника' }, 400);
      const item = { id: str(b.id, 20) || Math.random().toString(36).slice(2, 10), name: str(b.name, 60), tg, countries: str(b.countries, 160), methods: str(b.methods, 240), note: str(b.note, 600), verified: !!b.verified, pairs, updated: Date.now(), by: me.id };
      const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = item; else list.unshift(item);
      if (!fake) await jset('exch:list', list.slice(0, 300)); return json({ list, item });
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
