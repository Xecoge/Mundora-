// Vercel: пересылает запросы сайта к провайдеру ИИ (обходит CORS, держит поток живым).
// Переменные окружения (Vercel → Settings → Environment Variables):
//   AI_API_KEY  — ключ провайдера (обязательно, если ключа нет в config.js)
//   AI_BASE_URL — адрес провайдера (необязательно, по умолчанию ниже)
export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://api.drakezakuru.com/v1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'content-encoding', 'content-length'];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const env = (typeof process !== 'undefined' && process.env) || {};
  const base = (env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const url = new URL(req.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!/^[\w\-./]*$/.test(path) || path.includes('..')) return new Response('bad path', { status: 400, headers: CORS });
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();
  const target = `${base}/${path}${qs ? '?' + qs : ''}`;

  const headers = { 'content-type': req.headers.get('content-type') || 'application/json' };
  const auth = env.AI_API_KEY ? 'Bearer ' + env.AI_API_KEY : req.headers.get('authorization');
  if (auth) headers.authorization = auth;

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  let wantsStream = false;
  if (body) { try { wantsStream = !!JSON.parse(new TextDecoder().decode(body)).stream; } catch (e) {} }

  // Потоковый ответ: сразу отвечаем браузеру и шлём «пинги», пока модель думает
  if (wantsStream) {
    const enc = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const send = s => w.write(enc.encode(s)).catch(() => {});
    send(': connected\n\n');
    const ping = setInterval(() => send(': ping\n\n'), 8000);
    (async () => {
      try {
        const r = await fetch(target, { method: req.method, headers: { ...headers, accept: 'text/event-stream' }, body });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok) {
          const t = await r.text();
          await send('data: ' + JSON.stringify({ error: { status: r.status, message: t.slice(0, 600) } }) + '\n\n');
        } else if (!/event-stream/.test(ct)) {
          const t = await r.text();
          let j; try { j = JSON.stringify(JSON.parse(t)); } catch (e) { j = JSON.stringify({ choices: [{ delta: { content: t } }] }); }
          await send('data: ' + j + '\n\n');
        } else {
          const rd = r.body.getReader();
          for (;;) { const { value, done } = await rd.read(); if (done) break; await w.write(value); }
        }
      } catch (e) {
        await send('data: ' + JSON.stringify({ error: { message: 'Прокси не достучался до провайдера ИИ: ' + e.message } }) + '\n\n');
      } finally {
        clearInterval(ping);
        await send('data: [DONE]\n\n');
        w.close().catch(() => {});
      }
    })();
    return new Response(readable, { status: 200, headers: { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
  }

  try {
    const r = await fetch(target, { method: req.method, headers, body });
    const h = new Headers(r.headers);
    HOP.forEach(k => h.delete(k));
    Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Прокси не достучался до провайдера ИИ: ' + e.message } }),
      { status: 502, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
  }
}
