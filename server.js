/*
  TEMPO — локальный сервер.
  Запуск:  node server.js   → откроется http://localhost:8080
  Нужен Node.js (https://nodejs.org). Никаких пакетов ставить не надо.

  Зачем: многие провайдеры ИИ не разрешают запросы прямо из браузера (CORS),
  из-за этого в чате «Failed to fetch». Сервер отдаёт сайт и пересылает запросы к ИИ сам.
*/
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const { exec } = require('child_process');
const PORT = +process.env.PORT || 8080, ROOT = __dirname;

function baseFromFiles() {
  for (const f of ['config.js', 'index.html']) {
    try { const m = fs.readFileSync(path.join(ROOT, f), 'utf8').match(/baseURL:\s*['"]([^'"]+)['"]/); if (m) return m[1]; } catch (e) {}
  }
  return 'https://api.openai.com/v1';
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  if (req.url === '/tempo-ping') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('tempo'); }

  if (req.url.startsWith('/ai-proxy/')) {
    let base = String(req.headers['x-tempo-base'] || baseFromFiles());
    if (!/^https?:\/\//i.test(base)) base = baseFromFiles();
    const target = new URL(req.url.slice('/ai-proxy/'.length), base.replace(/\/+$/, '') + '/');
    const headers = { ...req.headers };
    ['host', 'origin', 'referer', 'x-tempo-base', 'accept-encoding', 'connection', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest'].forEach(h => delete headers[h]);
    const lib = target.protocol === 'http:' ? http : https;
    const up = lib.request(target, { method: req.method, headers }, r => {
      const h = { ...r.headers, 'access-control-allow-origin': '*' };
      delete h['content-length']; delete h['transfer-encoding'];
      res.writeHead(r.statusCode || 502, h);
      r.pipe(res);
    });
    up.on('error', e => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'Сервер не достучался до провайдера ИИ: ' + e.message } }));
    });
    req.pipe(up);
    return;
  }

  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const fp = path.join(ROOT, path.normalize(f));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(d);
  });
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  TEMPO запущен: ${url}\n  ИИ идёт через этот сервер → ${baseFromFiles()}\n  Остановить: Ctrl+C\n`);
  if (!process.env.NO_OPEN) exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url, () => {});
});
