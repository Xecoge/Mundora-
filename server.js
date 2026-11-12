/*
  TEMPO — локальный сервер (то же, что делает Vercel).
  Запуск (настройки ИИ — переменными окружения):
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

let MODELS = { t: 0, list: [] };
async function listModels(auth) {
  if (MODELS.list.length && Date.now() - MODELS.t < 5 * 60e3) return MODELS.list;
  try { const r = await fetch(BASE + '/models', { headers: auth ? { authorization: auth } : {} }); const j = await r.json(); const list = (j.data || j.models || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean); if (list.length) MODELS = { t: Date.now(), list }; } catch (e) {}
  return MODELS.list;
}
const norm = m => String(m).toLowerCase().replace(/[^a-z0-9.]/g, '');
const rank = (m, h) => { const n = norm(m); let r = 0; if (h && n.includes(norm(h))) r += 10; if (/gpt/i.test(m)) r += 2; if (/mini|nano|audio|realtime|image|tts|whisper|embed|search|transcribe/i.test(m)) r -= 4; return r; };
async function resolveModel(auth, requested) {
  const want = String(env.AI_MODEL || '').trim(), list = await listModels(auth);
  if (want) { if (!list.length || list.includes(want)) return want; const w = want.toLowerCase(); return list.find(m => m.toLowerCase().endsWith('/' + w)) || list.find(m => m.toLowerCase().includes(w)) || want; }
  if (requested && requested !== 'auto' && (!list.length || list.includes(requested))) return requested;
  const hint = env.AI_MODEL_HINT || 'gpt-6-astra';
  return list.length ? [...list].sort((a, b) => rank(b, hint) - rank(a, hint))[0] : hint;
}

http.createServer(async (req, res) => {
  if (req.url === '/tempo-ping') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(env.AI_API_KEY ? 'tempo key' : 'tempo'); }
  if (req.url.startsWith('/ai-proxy/')) {
    const p = req.url.slice('/ai-proxy/'.length).replace(/^\/+/, '');
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = chunks.length ? Buffer.concat(chunks) : undefined;
    const auth = env.AI_API_KEY ? 'Bearer ' + env.AI_API_KEY : req.headers.authorization;
    try { if (body && /completions(\?|$)/.test(p)) { const j = JSON.parse(body.toString()); j.model = await resolveModel(auth, j.model); body = JSON.stringify(j); } } catch (e) {}
    try {
      const r = await fetch(BASE + '/' + p, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', ...(auth ? { authorization: auth } : {}) }, body });
      const h = { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' };
      res.writeHead(r.status, h);
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
