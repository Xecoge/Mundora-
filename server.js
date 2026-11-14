// Mundora — локальный сервер (то же, что на Vercel). Запуск:  node server.js   (Node 20+)
// Переменные окружения — те же, что в Vercel: AI_API_KEY, AI_BASE_URL, AI_MODEL, YT_API_KEY,
// ACCESS_CODE, ADMIN_EMAIL, SMTP_USER, SMTP_PASS, KV_REST_API_URL/KV_REST_API_TOKEN.
// Без базы Upstash данные хранятся в data/db.json. Без почты коды для входа печатаются здесь, в консоли.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const env = process.env, PORT = +env.PORT || 8080;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const store = await import('./api/_store.mjs');
if (!store.kvConfig()) {
  const file = path.join(ROOT, 'data', 'db.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let load = null; try { load = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  store.useLocalStore(store.memoryStore(load, d => fs.writeFile(file, JSON.stringify(d), () => {})));
}
if (!env.SMTP_USER && !env.RESEND_API_KEY) env.MAIL_DEV = '1';
const auth = await import('./api/_auth.mjs');

const H = {
  auth: () => import('./api/auth.js').then(m => m.handler),
  sync: () => import('./api/sync.js').then(m => m.default),
  admin: () => import('./api/admin.js').then(m => m.default),
  people: () => import('./api/people.js').then(m => m.default),
  tg: () => import('./api/tg.js').then(m => m.handler),
  ping: () => import('./api/ping.js').then(m => m.default),
  proxy: () => import('./api/proxy.js').then(m => m.default),
  music: () => import('./api/music.js').then(m => m.default),
  crypto: () => import('./api/crypto.js').then(m => m.default)
};

// Главная: как api/app.js, но страницы читаются из src/ заново (удобно править)
async function page(req) {
  const read = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  let u = null; try { u = await auth.currentUser(req); } catch (e) {}
  if (u && (u.status === 'active' || u.status === 'frozen') && !auth.accessExpired(u)) {
    const boot = `<script>window.TEMPO_USER=${JSON.stringify({ email: u.email, id: u.id, name: auth.displayName(u), avatar: u.avatar || (u.owner ? 'gem_orbit' : 'planet'), bio: u.bio || '', hasName: !!(u.name && u.name.trim()), until: u.accessUntil || 0, open: u.open !== false, verified: !!(u.verified || u.admin || u.shadow), admin: !!(u.admin || u.shadow), owner: u.owner, status: u.status, support: auth.SUPPORT() }).replace(/</g, '\\u003c')}</script>`;
    return new Response(read('app.html').replace('</head>', boot + '</head>'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response(read('gate.html'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function route(u) {
  const p = u.pathname;
  if (p === '/' || p === '/index.html') return [page, u];
  if (p === '/api/auth') return ['auth', u];
  if (p === '/api/sync') return ['sync', u];
  if (p === '/api/admin') return ['admin', u];
  if (p === '/api/people') return ['people', u];
  if (p === '/api/tg') return ['tg', u];
  if (p === '/tempo-ping') return ['ping', u];
  let m;
  if ((m = p.match(/^\/ai-proxy\/(.*)$/))) { const n = new URL('http://local/api/proxy'); n.searchParams.set('path', m[1]); u.searchParams.forEach((v, k) => n.searchParams.append(k, v)); return ['proxy', n]; }
  if ((m = p.match(/^\/music\/([^/]+)\/(.*)$/))) { const n = new URL('http://local/api/music'); n.searchParams.set('src', m[1]); n.searchParams.set('path', m[2]); u.searchParams.forEach((v, k) => n.searchParams.append(k, v)); return ['music', n]; }
  if ((m = p.match(/^\/crypto-api\/([^/]+)$/))) { const n = new URL('http://local/api/crypto'); n.searchParams.set('what', m[1]); u.searchParams.forEach((v, k) => n.searchParams.append(k, v)); return ['crypto', n]; }
  return null;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  const r = route(u);
  if (!r) { // статика: картинки и config.js
    const f = path.normalize(decodeURIComponent(u.pathname));
    const fp = path.join(ROOT, f);
    if (!/^[\\/](img[\\/][\w.-]+|config\.js)$/.test(f) || !fp.startsWith(ROOT)) { res.writeHead(404); return res.end('Not found'); }
    return fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(d); });
  }
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') h.set(k, v);
    h.set('x-forwarded-proto', 'http'); if (!h.has('x-forwarded-for')) h.set('x-forwarded-for', req.socket.remoteAddress || 'local');
    const wreq = new Request(r[1].href.startsWith('http://local') ? r[1].href : 'http://local' + r[1].pathname + r[1].search, { method: req.method, headers: h, body: chunks.length && !/^(GET|HEAD)$/.test(req.method) ? Buffer.concat(chunks) : undefined });
    const fn = typeof r[0] === 'function' ? r[0] : await H[r[0]]();
    const resp = await fn(wreq);
    const out = {}; resp.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : []; if (sc.length) out['set-cookie'] = sc;
    res.writeHead(resp.status, out);
    if (resp.body) for await (const c of resp.body) res.write(c);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Mundora: ${url}\n  База: ${store.kvConfig() ? 'Upstash' : 'файл data/db.json'} · Почта: ${env.MAIL_DEV ? 'коды печатаются здесь' : 'настроена'} · ИИ: ${env.AI_API_KEY ? 'ключ задан' : 'нет ключа'}\n  Код доступа: ${env.ACCESS_CODE ? 'задан' : 'НЕ задан — запусти с ACCESS_CODE=2134'}\n  Остановить: Ctrl+C\n`);
  if (!env.NO_OPEN) exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url, () => {});
});
