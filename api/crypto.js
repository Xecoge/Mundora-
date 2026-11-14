// Vercel: живые курсы крипты для сайта. Функция работает из Франкфурта (fra1), где Binance доступна,
// поэтому цены обновляются и там, где сама Binance заблокирована (например, мобильные сети в РФ).
export const config = { runtime: 'edge', regions: ['fra1'] };

const H = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
const out = (o, cache = 'no-store', status = 200) => new Response(JSON.stringify(o), { status, headers: { ...H, 'cache-control': cache } });
const BN = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const CG = 'https://api.coingecko.com/api/v3';

async function bn(path) {
  let last;
  for (const b of BN) {
    try { const r = await fetch(b + path, { headers: { accept: 'application/json' } }); if (r.ok) return await r.json(); last = new Error('binance ' + r.status); }
    catch (e) { last = e; }
  }
  throw last;
}
async function okxTickers(want) {
  const r = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  const j = await r.json(); const set = new Set(want);
  return (j.data || []).map(t => { const s = String(t.instId || '').replace('-', ''); return set.has(s) ? { s, c: t.last, o: t.open24h, h: t.high24h, l: t.low24h, q: t.volCcy24h } : null; }).filter(Boolean);
}
const okSym = s => /^[A-Z0-9]{2,20}$/.test(s);

import { guard } from './_auth.mjs';
import { kv, dbReady } from './_store.mjs';
// монеты, которых нет в топ-100 по капитализации, но которые нужны в списке
const EXTRA_COINS = ['official-trump'];

// ---------- курсы ценностей: золото, серебро, платина, палладий (за тройскую унцию, USD) ----------
const METALS = ['XAU', 'XAG', 'XPT', 'XPD'];
async function goldApi(s) {
  const r = await fetch('https://api.gold-api.com/price/' + s, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('gold-api ' + r.status);
  const j = await r.json(); const p = +(j.price ?? (j.data && j.data.price));
  if (!(p > 0)) throw new Error('gold-api: нет цены');
  return { s, price: p, t: Date.parse(j.updatedAt || '') || Date.now() };
}
async function paxg() { // запасной источник для золота: токен PAXG = 1 унция золота
  const d = await bn('/api/v3/ticker/price?symbol=PAXGUSDT'); const p = +d.price; if (!(p > 0)) throw new Error('paxg'); return { s: 'XAU', price: p, t: Date.now(), src: 'paxg' };
}
async function metals() {
  const res = await Promise.all(METALS.map(s => goldApi(s).catch(e => s === 'XAU' ? paxg().catch(() => null) : null)));
  const now = Date.now(), cur = {}; res.forEach(x => { if (x) cur[x.s] = x.price; });
  if (!Object.keys(cur).length) throw new Error('Курсы металлов временно недоступны');
  // история в базе: точка раз в 5 минут, ~26 часов — для изменения за сутки и графика
  let hist = [];
  if (dbReady()) {
    try {
      hist = JSON.parse((await kv('GET', 'met:hist')) || '[]');
      const last = hist[hist.length - 1];
      if (!last || now - last.t >= 5 * 60e3) { hist.push({ t: now, p: cur }); hist = hist.filter(h => now - h.t <= 26 * 3600e3); await kv('SET', 'met:hist', JSON.stringify(hist)); }
    } catch (e) {}
  }
  const data = METALS.filter(s => cur[s]).map(s => {
    const pts = hist.filter(h => h.p && h.p[s]);
    const base = pts.find(h => now - h.t <= 24 * 3600e3) || pts[0];
    const step = Math.max(1, Math.floor(pts.length / 60));
    return { s, price: cur[s], ch24: base && base.t < now - 30 * 60e3 ? (cur[s] / base.p[s] - 1) * 100 : null, since: base ? base.t : now, spark: pts.filter((_, i) => i % step === 0).map(h => h.p[s]) };
  });
  return { t: now, data };
}
export default async function handler(req) {
  { const g = await guard(req); if (g.res) return g.res; }
  const u = new URL(req.url), what = u.searchParams.get('what');
  try {
    if (what === 'tickers') {
      const syms = (u.searchParams.get('symbols') || '').split(',').filter(okSym).slice(0, 150);
      if (!syms.length) return out({ error: 'no symbols' }, 'no-store', 400);
      let data, src = 'binance';
      try {
        const d = await bn('/api/v3/ticker/24hr?type=MINI&symbols=' + encodeURIComponent(JSON.stringify(syms)));
        data = d.map(t => ({ s: t.symbol, c: t.lastPrice, o: t.openPrice, h: t.highPrice, l: t.lowPrice, q: t.quoteVolume }));
      } catch (e) {
        // некоторые символы Binance не знает — тогда запрашиваем все и фильтруем, иначе OKX
        try { const set = new Set(syms); const d = await bn('/api/v3/ticker/24hr?type=MINI'); data = d.filter(t => set.has(t.symbol)).map(t => ({ s: t.symbol, c: t.lastPrice, o: t.openPrice, h: t.highPrice, l: t.lowPrice, q: t.quoteVolume })); }
        catch (e2) { data = await okxTickers(syms); src = 'okx'; }
      }
      return out({ t: Date.now(), src, data }, 'public, s-maxage=1, stale-while-revalidate=2');
    }
    if (what === 'lwc') {
      for (const src of ['https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js', 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js']) {
        try { const r = await fetch(src); if (r.ok) return new Response(await r.text(), { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable', 'access-control-allow-origin': '*' } }); } catch (e) {}
      }
      return new Response('/* lwc unavailable */', { status: 502, headers: { 'content-type': 'application/javascript' } });
    }
    if (what === 'klines') {
      const symbol = u.searchParams.get('symbol') || '', interval = u.searchParams.get('interval') || '1h', limit = Math.min(1000, +u.searchParams.get('limit') || 200);
      if (!okSym(symbol) || !/^\d+[mhdwM]$/.test(interval)) return out({ error: 'bad request' }, 'no-store', 400);
      const d = await bn(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return out(d, limit <= 3 ? 'public, s-maxage=1, stale-while-revalidate=2' : 'public, s-maxage=20');
    }
    if (what === 'metals') return out(await metals(), 'public, s-maxage=1, stale-while-revalidate=3');
    if (what === 'markets') {
      const q = CG + '/coins/markets?vs_currency=usd&sparkline=true&price_change_percentage=1h,24h,7d';
      const [r, rx] = await Promise.all([fetch(q + '&order=market_cap_desc&per_page=100&page=1', { headers: { accept: 'application/json' } }), fetch(q + '&ids=' + EXTRA_COINS.join(','), { headers: { accept: 'application/json' } }).catch(() => null)]);
      if (!r.ok) return new Response(await r.text(), { status: r.status, headers: { ...H, 'cache-control': 'no-store' } });
      const list = await r.json();
      try { if (rx && rx.ok) { const have = new Set(list.map(c => c.id)); (await rx.json()).forEach(c => { if (!have.has(c.id)) list.push(c); }); } } catch (e) {}
      return out(list, 'public, s-maxage=60, stale-while-revalidate=300');
    }
    if (what === 'chart') {
      const id = u.searchParams.get('id') || '', days = u.searchParams.get('days') || '1';
      if (!/^[a-z0-9-]+$/.test(id) || !/^(\d+|max)$/.test(days)) return out({ error: 'bad request' }, 'no-store', 400);
      const r = await fetch(`${CG}/coins/${id}/market_chart?vs_currency=usd&days=${days}`, { headers: { accept: 'application/json' } });
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { ...H, 'cache-control': r.ok ? 'public, s-maxage=120' : 'no-store' } });
    }
    if (what === 'rub') {
      const r = await fetch(CG + '/simple/price?ids=tether&vs_currencies=rub', { headers: { accept: 'application/json' } });
      const j = await r.json();
      return out({ rub: j.tether && j.tether.rub }, 'public, s-maxage=600');
    }
    return out({ error: 'unknown' }, 'no-store', 400);
  } catch (e) {
    return out({ error: String(e.message || e) }, 'no-store', 502);
  }
}
