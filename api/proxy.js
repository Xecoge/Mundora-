// Vercel: пересылает запросы сайта к провайдеру ИИ (обходит CORS, поддерживает стриминг).
// Необязательные переменные окружения в Vercel → Settings → Environment Variables:
//   AI_BASE_URL — адрес провайдера (по умолчанию ниже)
//   AI_API_KEY  — ключ; если задан, его можно удалить из config.js и index.html, и он не будет виден на сайте
export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://api.drakezakuru.com/v1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const env = (typeof process !== 'undefined' && process.env) || {};
  const base = (env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const url = new URL(req.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!/^[\w\-./]*$/.test(path) || path.includes('..')) return new Response('bad path', { status: 400, headers: CORS });
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  const headers = { 'content-type': req.headers.get('content-type') || 'application/json' };
  const auth = env.AI_API_KEY ? 'Bearer ' + env.AI_API_KEY : req.headers.get('authorization');
  if (auth) headers.authorization = auth;
  const accept = req.headers.get('accept'); if (accept) headers.accept = accept;

  try {
    const r = await fetch(`${base}/${path}${qs ? '?' + qs : ''}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
    });
    const h = new Headers(r.headers);
    Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
    h.delete('content-encoding'); h.delete('content-length');
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Прокси не достучался до провайдера ИИ: ' + e.message } }),
      { status: 502, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
  }
}
