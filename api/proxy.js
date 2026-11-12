// Vercel: пересылает запросы сайта к провайдеру ИИ (обходит CORS, держит поток живым).
// Все настройки ИИ — только здесь, через переменные окружения
// (Vercel → Settings → Environment Variables), после изменения — Redeploy:
//   AI_API_KEY  — ключ провайдера (обязательно)
//   AI_BASE_URL — адрес провайдера, например https://api.drakezakuru.com/v1
//   AI_MODEL    — модель, например gpt-6.1-sol (можно без приставки: сервер найдёт
//                 «quince10/gpt-6.1-sol» сам). Не задана — выберется по AI_MODEL_HINT (gpt-6.1).
export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://api.drakezakuru.com/v1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
let MODELS = { t: 0, list: [] };
async function listModels(base, auth) {
  if (MODELS.list.length && Date.now() - MODELS.t < 5 * 60e3) return MODELS.list;
  try {
    const r = await fetch(base + '/models', { headers: auth ? { authorization: auth } : {} });
    const j = await r.json();
    const list = (j.data || j.models || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
    if (list.length) MODELS = { t: Date.now(), list };
  } catch (e) {}
  return MODELS.list;
}
const norm = m => String(m).toLowerCase().replace(/[^a-z0-9.]/g, '');
function rank(m, hint) {
  const n = norm(m); let r = 0;
  if (hint && n.includes(norm(hint))) r += 10;
  if (/gpt/i.test(m)) r += 2;
  if (/mini|nano|audio|realtime|image|tts|whisper|embed|search|transcribe/i.test(m)) r -= 4;
  return r;
}
async function resolveModel(env, base, auth, requested) {
  const want = String(env.AI_MODEL || '').trim();
  const list = await listModels(base, auth);
  if (want) {
    if (!list.length || list.includes(want)) return want;
    const w = want.toLowerCase();
    return list.find(m => m.toLowerCase().endsWith('/' + w)) || list.find(m => m.toLowerCase().endsWith(w)) || list.find(m => m.toLowerCase().includes(w)) || want;
  }
  if (requested && requested !== 'auto' && (!list.length || list.includes(requested))) return requested;
  const hint = env.AI_MODEL_HINT || 'gpt-6.1';
  if (!list.length) return hint;
  return [...list].sort((a, b) => rank(b, hint) - rank(a, hint))[0];
}

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

  let body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  let wantsStream = false;
  if (body) {
    try {
      const j = JSON.parse(new TextDecoder().decode(body));
      wantsStream = !!j.stream;
      if (/completions$/.test(path)) { j.model = await resolveModel(env, base, auth, j.model); body = JSON.stringify(j); }
    } catch (e) {}
  }

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
          MODELS.t = 0;
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
