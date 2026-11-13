/*
  TEMPO — локальный сервер (то же, что делает Vercel).
  Запуск (настройки ИИ — переменными окружения):
    Полные версии треков (необязательно): YT_API_KEY — ключ YouTube Data API v3.
    Windows PowerShell:  $env:AI_API_KEY="sk-..."; $env:AI_BASE_URL="https://api.drakezakuru.com/v1"; $env:AI_MODEL="gpt-6-astra"; node server.js
    macOS / Linux:       AI_API_KEY=sk-... AI_BASE_URL=https://api.drakezakuru.com/v1 AI_MODEL=gpt-6-astra node server.js
  Откроется http://localhost:8080. Нужен Node.js 18+.
*/
const http = require('http'), fs = require('fs'), path = require('path');
const { exec } = require('child_process');
const PORT = +process.env.PORT || 8080, ROOT = __dirname;
const env = process.env;
const BASE = (env.AI_BASE_URL || 'https://api.drakezakuru.com/v1').replace(/\/+$/, '');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  if (req.url === '/tempo-ping') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('tempo' + (env.AI_API_KEY ? ' key' : '') + (env.YT_API_KEY ? ' yt' : '')); }
  if (req.url.startsWith('/crypto-api/')) {
    const u = new URL(req.url, 'http://x'), what = u.pathname.split('/')[2], q = u.searchParams;
    const send = (code, body, cache) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache || 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const BN = ['https://data-api.binance.vision', 'https://api.binance.com'], CG = 'https://api.coingecko.com/api/v3';
    const bn = async p => { let last; for (const b of BN) { try { const r = await fetch(b + p); if (r.ok) return r.json(); last = new Error('binance ' + r.status); } catch (e) { last = e; } } throw last; };
    try {
      if (what === 'tickers') { const syms = (q.get('symbols') || '').split(',').filter(x => /^[A-Z0-9]{2,20}$/.test(x)); const set = new Set(syms); const d = await bn('/api/v3/ticker/24hr?type=MINI'); return send(200, { t: Date.now(), data: d.filter(t => set.has(t.symbol)).map(t => ({ s: t.symbol, c: t.lastPrice, o: t.openPrice, h: t.highPrice, l: t.lowPrice, q: t.quoteVolume })) }); }
      if (what === 'lwc') { const r = await fetch('https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'); res.writeHead(r.status, { 'content-type': 'application/javascript; charset=utf-8' }); return res.end(await r.text()); }
      if (what === 'klines') return send(200, await bn(`/api/v3/klines?symbol=${encodeURIComponent(q.get('symbol') || '')}&interval=${encodeURIComponent(q.get('interval') || '1h')}&limit=${+q.get('limit') || 200}`));
      if (what === 'markets') { const r = await fetch(CG + '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d'); return send(r.status, await r.text()); }
      if (what === 'chart') { const r = await fetch(`${CG}/coins/${encodeURIComponent(q.get('id') || '')}/market_chart?vs_currency=usd&days=${encodeURIComponent(q.get('days') || '1')}`); return send(r.status, await r.text()); }
      if (what === 'rub') { const r = await fetch(CG + '/simple/price?ids=tether&vs_currencies=rub'); const j = await r.json(); return send(200, { rub: j.tether && j.tether.rub }); }
      return send(400, { error: 'unknown' });
    } catch (e) { return send(502, { error: e.message }); }
  }
  if (req.url.startsWith('/music/')) {
    const u = new URL(req.url, 'http://x'); const [, , src, ...rest] = u.pathname.split('/'); const p = rest.join('/');
    const SRC = { deezer: 'https://api.deezer.com/', itunes: 'https://itunes.apple.com/', applerss: 'https://rss.applemarketingtools.com/api/v2/' };
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    try {
      if (src === 'yt') {
        if (!env.YT_API_KEY) return send(501, { error: 'YT_API_KEY не задан' });
        const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', videoEmbeddable: 'true', videoCategoryId: '10', q: u.searchParams.get('q') || '', key: env.YT_API_KEY }));
        const j = await r.json(); if (!r.ok) return send(r.status, { error: (j.error && j.error.message) || 'YouTube ' + r.status });
        return send(200, { items: (j.items || []).map(x => ({ id: x.id && x.id.videoId, title: x.snippet && x.snippet.title, channel: x.snippet && x.snippet.channelTitle })).filter(x => x.id) });
      }
      if (!SRC[src] || !/^[\w\-./]*$/.test(p) || p.includes('..')) return send(400, { error: 'bad request' });
      const r = await fetch(SRC[src] + p + u.search); return send(r.status, await r.text());
    } catch (e) { return send(502, { error: e.message }); }
  }
  if (req.url.startsWith('/ai-proxy/')) {
    // Та же логика, что на Vercel (api/_ai.mjs): автозамена модели, если основная не отвечает
    const [p, q] = req.url.slice('/ai-proxy/'.length).replace(/^\/+/, '').split('?');
    const chunks = []; for await (const c of req) chunks.push(c);
    try {
      const { handleAI } = await import('./api/_ai.mjs');
      const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') h.set(k, v);
      const wreq = new Request('http://local/api/proxy?' + new URLSearchParams({ path: p }) + (q ? '&' + q : ''), { method: req.method, headers: h, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const r = await handleAI(wreq, env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) for await (const c of r.body) res.write(c);
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'Сервер не достучался до провайдера ИИ: ' + e.message } }));
    }
    return;
  }
  let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
  const fp = path.join(ROOT, path.normalize(f));
  if (!fp.startsWith(ROOT) || /[\\/]api[\\/]/.test(fp)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(d); });
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  TEMPO: ${url}\n  ИИ: ${env.AI_API_KEY ? 'ключ задан' : 'НЕТ ключа — задай AI_API_KEY'} · ${BASE} · модель: ${env.AI_MODEL || 'авто'}\n  Остановить: Ctrl+C\n`);
  if (!env.NO_OPEN) exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url, () => {});
});
