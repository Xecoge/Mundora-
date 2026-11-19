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
const walletsRaw = u => { let L = Array.isArray(u.wallets) ? u.wallets : []; if (!L.length && u.wallet && u.wallet.addr) L = [{ id: 'w0', ...u.wallet }]; return L.filter(w => w && CHAINS[w.chain]).slice(0, 5); };
const walletsOut = u => walletsRaw(u).map(w => ({ id: w.id, name: w.name || CHAINS[w.chain].n, chain: w.chain, net: w.chain === 'eth' ? 'Ethereum + EVM' : CHAINS[w.chain].n, sym: CHAINS[w.chain].sym, addr: w.addr }));
async function fj(url, body) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
  try { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
// ---- полный баланс: основная монета + все токены с ценой ----
const EVM = [
  { net: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', sym: 'BNB', cg: 'binancecoin', tok: [['USDT', '0x55d398326f99059fF775485246999027B3197955', 18], ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18]] },
  { net: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', sym: 'POL', cg: 'polygon-ecosystem-token', tok: [['USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6], ['USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6]] },
  { net: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', sym: 'ETH', cg: 'ethereum', tok: [['USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6], ['USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6]] },
  { net: 'Base', rpc: 'https://base-rpc.publicnode.com', sym: 'ETH', cg: 'ethereum', tok: [['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6]] }
];
const big = (hex, dec) => { try { const v = BigInt(hex || '0x0'); const d = 10n ** BigInt(dec); return Number(v / d) + Number(v % d) / Number(d); } catch (e) { return 0; } };
const rpc = (url, method, params) => fj(url, { jsonrpc: '2.0', id: 1, method, params }).then(j => j.result);
async function evmChain(c, a) {
  const pad = a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const [nat, ...tk] = await Promise.all([rpc(c.rpc, 'eth_getBalance', [a, 'latest']).catch(() => '0x0'), ...c.tok.map(([, ct]) => rpc(c.rpc, 'eth_call', [{ to: ct, data: '0x70a08231' + pad }, 'latest']).catch(() => '0x0'))]);
  const out = [{ sym: c.sym, name: c.sym, net: c.net, amt: big(nat, 18), cg: c.cg }];
  c.tok.forEach(([sym, , dec], i) => out.push({ sym, name: sym, net: c.net, amt: big(tk[i], dec), stable: 1 }));
  return out;
}
async function walletAssets(chain, a) {
  const A = [];
  if (chain === 'btc') { const j = await fj('https://mempool.space/api/address/' + a); const c = j.chain_stats || {}, m = j.mempool_stats || {}; A.push({ sym: 'BTC', name: 'Bitcoin', net: 'Bitcoin', amt: ((c.funded_txo_sum || 0) - (c.spent_txo_sum || 0) + (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0)) / 1e8, cg: 'bitcoin' }); return A; }
  if (chain === 'ton') {
    const [acc, jt] = await Promise.all([fj('https://tonapi.io/v2/accounts/' + encodeURIComponent(a)).catch(() => null), fj('https://tonapi.io/v2/accounts/' + encodeURIComponent(a) + '/jettons?currencies=usd').catch(() => null)]);
    let ton = acc ? Number(acc.balance || 0) / 1e9 : null;
    if (ton == null) { const j = await fj('https://toncenter.com/api/v2/getAddressBalance?address=' + encodeURIComponent(a)); ton = Number(j.result || 0) / 1e9; }
    A.push({ sym: 'TON', name: 'Toncoin', net: 'TON', amt: ton, cg: 'the-open-network' });
    ((jt && jt.balances) || []).forEach(b => { const J = b.jetton || {}; if (J.verification === 'blacklist') return; const amt = Number(b.balance || 0) / 10 ** (+J.decimals || 9); const pr = ((b.price || {}).prices || {}).USD; A.push({ sym: J.symbol || '?', name: J.name || J.symbol, net: 'TON', amt, usd: pr != null ? amt * pr : undefined, icon: J.image }); });
    return A;
  }
  if (chain === 'tron') {
    try {
      const j = await fj('https://apilist.tronscanapi.com/api/account/tokens?address=' + a + '&start=0&limit=50&hidden=0&show=0&sortType=0');
      (j.data || []).forEach(t => { const amt = Number(t.quantity ?? (Number(t.balance || 0) / 10 ** (+t.tokenDecimal || 0))); if (!amt) return; A.push({ sym: t.tokenAbbr || t.tokenName || '?', name: t.tokenName, net: 'TRON', amt, usd: t.amountInUsd != null ? Number(t.amountInUsd) : undefined, icon: t.tokenLogo, cg: t.tokenId === '_' ? 'tron' : undefined }); });
      if (!A.some(x => x.sym === 'TRX')) A.unshift({ sym: 'TRX', name: 'TRON', net: 'TRON', amt: 0, cg: 'tron' });
      return A;
    } catch (e) {
      const j = await fj('https://api.trongrid.io/v1/accounts/' + a); const d = (j.data || [])[0] || {};
      A.push({ sym: 'TRX', name: 'TRON', net: 'TRON', amt: Number(d.balance || 0) / 1e6, cg: 'tron' });
      (d.trc20 || []).forEach(o => { const v = o.TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t; if (v != null) A.push({ sym: 'USDT', name: 'Tether', net: 'TRON', amt: Number(v) / 1e6, stable: 1 }); });
      return A;
    }
  }
  if (chain === 'eth') {
    const [ep, ...rest] = await Promise.all([fj('https://api.ethplorer.io/getAddressInfo/' + a + '?apiKey=freekey').catch(() => null), ...EVM.map(c => evmChain(c, a).catch(() => []))]);
    if (ep) {
      A.push({ sym: 'ETH', name: 'Ethereum', net: 'Ethereum', amt: Number((ep.ETH || {}).balance || 0), cg: 'ethereum' });
      (ep.tokens || []).forEach(t => { const I = t.tokenInfo || {}; const pr = I.price && I.price.rate; if (!pr) return; const amt = Number(t.rawBalance || t.balance || 0) / 10 ** (+I.decimals || 0); A.push({ sym: I.symbol || '?', name: I.name, net: 'Ethereum', amt, usd: amt * pr, icon: I.image ? 'https://ethplorer.io' + I.image : undefined }); });
    } else {
      const nat = await rpc('https://ethereum-rpc.publicnode.com', 'eth_getBalance', [a, 'latest']).catch(() => '0x0');
      A.push({ sym: 'ETH', name: 'Ethereum', net: 'Ethereum', amt: big(nat, 18), cg: 'ethereum' });
    }
    rest.flat().forEach(x => A.push(x));
    return A;
  }
  if (chain === 'sol') {
    const [lam, tk] = await Promise.all([rpc('https://api.mainnet-beta.solana.com', 'getBalance', [a]), rpc('https://api.mainnet-beta.solana.com', 'getTokenAccountsByOwner', [a, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]).catch(() => null)]);
    A.push({ sym: 'SOL', name: 'Solana', net: 'Solana', amt: Number((lam || {}).value || 0) / 1e9, cg: 'solana' });
    const acc = ((tk || {}).value || []).map(v => ((v.account || {}).data || {}).parsed || {}).map(p => p.info || {}).filter(i => i.tokenAmount && +i.tokenAmount.uiAmount > 0).slice(0, 40);
    if (acc.length) {
      let meta = [];
      try { meta = await fj('https://lite-api.jup.ag/tokens/v2/search?query=' + acc.map(i => i.mint).join(',')); } catch (e) {}
      const M = Object.fromEntries((Array.isArray(meta) ? meta : []).map(m => [m.id, m]));
      const KN = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYb: 'USDT' };
      acc.forEach(i => { const m = M[i.mint], amt = +i.tokenAmount.uiAmount; const sym = (m && m.symbol) || KN[i.mint]; if (!sym) return; A.push({ sym, name: (m && m.name) || sym, net: 'Solana', amt, usd: m && m.usdPrice != null ? amt * m.usdPrice : KN[i.mint] ? amt : undefined, icon: m && m.icon }); });
    }
    return A;
  }
  return A;
}
async function cgPrices() {
  const c = await jget('wb:prices'); if (c && Date.now() - c.t < 180e3) return c.p;
  try { const p = await fj('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=' + Object.values(CHAINS).map(x => x.cg).concat('tether', 'binancecoin', 'polygon-ecosystem-token').join(',')); await jset('wb:prices', { t: Date.now(), p }); return p; } catch (e) { return (c && c.p) || {}; }
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
  const earned = parts.reduce((n, p) => n + p[1], 0), spent = Math.max(0, u.xpSpent || 0);
  const score = Math.max(0, earned - spent); // рейтинг = заработано минус потрачено на подарки
  const level = LV.filter(x => score >= x).length;
  return { score, earned, spent, avail: score, level, max: LV.length, title: titleOf(level), from: LV[level - 1], to: LV[level] ?? null, ladder: LV, parts: parts.filter(p => p[1] > 0), stats: { likes, playlists: pls.length, plTracks, plays: Math.max(events, plays), notes, ops, days } };
}

async function card(email, viewer, full) {
  const L = viewer.shadow ? ((await jget('sh:' + viewer.email)) || {}) : null;
  const [uj, adm0, sh] = await kvMulti([['GET', 'u:' + email], ['SISMEMBER', 'admins', email], ['SISMEMBER', 'shadow_admins', email]]);
  const u = parse(uj); if (!u) return null;
  await ensureId(u);
  const [onK, lsK] = u.id != null ? await kvMulti([['GET', 'on:' + u.id], ['GET', 'ls:' + u.id]]) : [null, null];
  const lastSeen = Math.max(u.seen || 0, +lsK || 0);
  const owner = email === ADMIN(), self = viewer.email === email;
  const adm = adm0 || (self && sh); // визуальный админ видит галочку только у себя
  const base = {
    id: u.id, name: displayName(u), bio: u.bio || '', avatar: avatarOf(u), cover: coverOf(u), tg: u.tg ? { username: u.tg.username || '', name: u.tg.name || '' } : null,
    verified: !!(u.verified || owner || adm), admin: owner || !!adm, owner, self,
    email: viewer.admin || self ? email : maskEmail(email), status: viewer.admin ? (u.status || 'active') : undefined,
    online: !!onK, seen: lastSeen ? Math.floor(lastSeen / 6e4) * 6e4 : 0, joined: u.created || 0, open: u.open !== false,
    gifts: giftsOut(u), pos: posOut(u), nick: nickOut(u), anim: ['orbit', 'bubbles'].includes(u.giftAnim) ? u.giftAnim : (u.giftOrbit ? 'orbit' : 'none'), wallets: walletsOut(u)
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
    if (req.method === 'POST' && (a === 'wallet-add' || a === 'wallet-del')) {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — профиль не меняется' }, 423);
      const b = await req.json().catch(() => ({})); const u = await getUser(me.email);
      let L = walletsRaw(u);
      if (a === 'wallet-del') L = L.filter(w => w.id !== b.id);
      else {
        const addr = String(b.addr || '').trim(); const chain = chainOf(addr);
        if (!chain) return json({ error: 'Не похоже на адрес кошелька. Поддерживаются Bitcoin, Ethereum и сети EVM (BNB, Polygon, Arbitrum, Base), TON, TRON и Solana' }, 400);
        if (L.some(w => w.addr.toLowerCase() === addr.toLowerCase())) return json({ error: 'Этот кошелёк уже привязан' }, 409);
        if (L.length >= 5) return json({ error: 'Можно привязать до 5 кошельков' }, 400);
        const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || CHAINS[chain].n;
        L.push({ id: rand(6), addr, chain, name, t: Date.now() });
      }
      u.wallets = L; delete u.wallet; await putUser(u);
      return json({ ok: true, profile: await card(me.email, me, true) });
    }
    if (a === 'wallets' && req.method === 'GET') {
      const id0 = url.searchParams.get('id'), em = /^\d{1,12}$/.test(id0 || '') ? await kv('GET', 'id:' + id0) : null;
      const u = em && await getUser(em); const W = u ? walletsOut(u) : []; if (!W.length) return json({ wallets: [], total: 0 });
      const P = await cgPrices();
      const MAIN = ['BTC', 'ETH', 'TON', 'TRX', 'SOL'];
      const res = await Promise.all(W.map(async w => {
        const key = 'wa:' + w.chain + ':' + w.addr; let c = await jget(key), err = '';
        if (!c || Date.now() - c.t > 90e3) {
          try { c = { t: Date.now(), A: await walletAssets(w.chain, w.addr) }; await jset(key, c, 900); }
          catch (e) { err = 'Блокчейн сейчас не отвечает — попробуй позже'; }
        }
        const assets = ((c && c.A) || []).map(x => { const pr = x.cg ? ((P[x.cg] || {}).usd || 0) : x.stable ? 1 : null; const usd = x.usd != null ? x.usd : pr != null ? x.amt * pr : null; return { sym: x.sym, name: x.name, net: x.net, amt: x.amt, usd, icon: x.icon || null, ch24: x.cg ? ((P[x.cg] || {}).usd_24h_change ?? null) : null, main: !!x.cg && x.net === ({ btc: 'Bitcoin', eth: 'Ethereum', ton: 'TON', tron: 'TRON', sol: 'Solana' })[w.chain] }; })
          .filter(x => x.main || (x.amt > 0 && (x.usd == null || x.usd >= 0.01)))
          .sort((x, y) => (y.main - x.main) || ((y.usd || 0) - (x.usd || 0))).slice(0, 40);
        const total = assets.reduce((n, x) => n + (x.usd || 0), 0);
        return { ...w, explorer: CHAINS[w.chain].ex(w.addr), assets, total, t: c ? c.t : Date.now(), error: err || undefined };
      }));
      return json({ wallets: res, total: res.reduce((n, w) => n + w.total, 0) });
    }
    if (a === 'gifts' && req.method === 'GET') return json({ catalog: GIFTS, max: MAXPOS });
    if (req.method === 'POST' && a === 'gift-buy') {
      if (me.status === 'frozen') return json({ error: 'Аккаунт заморожен — покупки недоступны' }, 423);
      const b = await req.json().catch(() => ({})), G = GIFTS[b.k];
      if (!G) return json({ error: 'Такого подарка нет' }, 400);
      const u = await getUser(me.email);
      const vals = await kv('HMGET', 'd:' + me.email, 'likes', 'playlists', 'plays', 'taste', 'notes', 'ops');
      const d = {}; ['likes', 'playlists', 'plays', 'taste', 'notes', 'ops'].forEach((k, i) => { d[k] = parse(vals[i]); });
      const avail = capital(u, d).score;
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
      if (b.anim !== undefined) { u.giftAnim = ['orbit', 'bubbles'].includes(b.anim) ? b.anim : 'none'; delete u.giftOrbit; }
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
