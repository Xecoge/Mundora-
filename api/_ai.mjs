// Mundora — общий модуль ИИ-прокси (Vercel api/proxy.js и локальный server.js).
// Пересылает запросы к провайдеру, держит поток живым и САМ переключает модель, если она не отвечает:
//  • ошибка провайдера (5xx, 429, «нет такой модели»), молчание дольше 45 с или пустой ответ → модель помечается сломанной на 5 мин;
//  • сервер берёт список моделей у провайдера (по ключу), шлёт короткие тестовые запросы лучшим кандидатам
//    и выбирает самую сильную из ответивших; запрос пользователя сразу уходит на неё;
//  • через 5 мин основная модель снова пробуется первой.
// Переменные окружения: AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_FALLBACK_MODELS (необязательно: свой порядок запасных через запятую).

import { kv, kvMulti, dbReady } from './_store.mjs';
const DEFAULT_BASE = 'https://api.drakezakuru.com/v1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'content-encoding', 'content-length'];
const NON_CHAT = /(embed|tts|whisper|audio|image|dall-?e|moderation|realtime|transcri|search|rerank|ocr|speech|similarity|davinci|babbage|-instruct\b)/i;
const FIRST_MS = 25000, TEST_MS = 10000, BAD_MS = 5 * 60e3, ACTIVE_MS = 10 * 60e3;
// если основная модель молчит дольше HEDGE_MS — параллельно спрашиваем запасную и берём того, кто ответит первым
const HEDGE_MS = 7000;

let MODELS = { t: 0, list: [] };
const ST = { bad: {}, active: '', activeT: 0 };
const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const family = m => { const n = String(m).toLowerCase().replace(/^[^/]*\//, ''); const f = n.match(/(gpt|o\d|claude|gemini|grok|deepseek|qwen|kimi|glm|llama|mistral|minimax|doubao|ernie|yi|command)/); return f ? f[1] : n.split(/[-_.:]/)[0]; };
const isBad = m => !!m && ST.bad[m] && now() - ST.bad[m] < BAD_MS;
// Состояние общее для всех серверов Vercel (через базу): сломанные модели и рабочая запасная.
// Иначе каждый «холодный» сервер заново ждёт ответа от неработающей модели.
const sharedOn = () => { try { return dbReady(); } catch (e) { return false; } };
async function loadShared() {
  if (!sharedOn()) return;
  try {
    const [b, a] = await kvMulti([['GET', 'ai:bad'], ['GET', 'ai:active']]);
    const bad = b ? JSON.parse(b) : {}; for (const [m, t] of Object.entries(bad)) if (now() - t < BAD_MS && !(ST.bad[m] > t)) ST.bad[m] = t;
    if (a) { const x = JSON.parse(a); if (x && x.m && now() - x.t < ACTIVE_MS && !isBad(x.m) && !(ST.activeT > x.t)) { ST.active = x.m; ST.activeT = x.t; } }
  } catch (e) {}
}
function saveShared() {
  if (!sharedOn()) return;
  const bad = {}; for (const [m, t] of Object.entries(ST.bad)) if (now() - t < BAD_MS) bad[m] = t;
  kvMulti([['SET', 'ai:bad', JSON.stringify(bad), 'EX', 600], ...(ST.active ? [['SET', 'ai:active', JSON.stringify({ m: ST.active, t: ST.activeT }), 'EX', 900]] : [['DEL', 'ai:active']])]).catch(() => {});
}
const markBad = m => { if (!m) return; ST.bad[m] = now(); if (ST.active === m) ST.active = ''; saveShared(); };
const markGood = m => { if (!m) return; delete ST.bad[m]; ST.active = m; ST.activeT = now(); saveShared(); };
const norm = m => String(m).toLowerCase().replace(/[^a-z0-9.]/g, '');

// «Ум» модели по названию: версия, класс (pro/opus/…), штраф за mini/flash/…
function brain(m) {
  const n = String(m).toLowerCase();
  if (NON_CHAT.test(n)) return -999;
  let s = 0;
  const v = n.replace(/^[^/]*\//, '').match(/(\d+(?:\.\d+)?)/);
  if (v) s += Math.min(parseFloat(v[1]), 20) * 3;
  if (/(opus|ultra|[-_ ]pro\b|max|large|[-_]sol\b|astra|\bo[13]\b|reason|think|sonnet)/.test(n)) s += 8;
  if (/(mini|nano|lite|small|tiny|flash|haiku|instant|fast|turbo|\b\d{1,2}b\b)/.test(n)) s -= 8;
  if (/(gpt|claude|gemini|grok)/.test(n)) s += 5; else if (/(deepseek|qwen|kimi|glm|llama|mistral)/.test(n)) s += 3;
  return s;
}
function rankList(list, env) {
  const pref = String(env.AI_FALLBACK_MODELS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const hint = norm(env.AI_MODEL || env.AI_MODEL_HINT || 'gpt-6-astra');
  const sc = m => { let s = brain(m); if (s <= -999) return s; if (hint && norm(m).includes(hint)) s += 40; const i = pref.findIndex(p => m.toLowerCase().includes(p)); if (i >= 0) s += 30 - i; return s; };
  return list.filter(m => sc(m) > -999).sort((a, b) => sc(b) - sc(a));
}
async function listModels(base, auth) {
  if (MODELS.list.length && now() - MODELS.t < 5 * 60e3) return MODELS.list;
  if (sharedOn()) { try { const c = await kv('GET', 'ai:models'); if (c) { const x = JSON.parse(c); if (x.list && x.list.length) { MODELS = { t: now(), list: x.list }; return MODELS.list; } } } catch (e) {} }
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(base + '/models', { headers: auth ? { authorization: auth } : {} });
      const j = await r.json();
      const list = (j.data || j.models || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
      if (list.length) { MODELS = { t: now(), list }; if (sharedOn()) kv('SET', 'ai:models', JSON.stringify({ list }), 'EX', 900).catch(() => {}); break; }
    } catch (e) {}
    await sleep(600);
  }
  return MODELS.list;
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
  const r = rankList(list, env);
  return r[0] || env.AI_MODEL_HINT || 'gpt-6-astra';
}
function deltaText(o) {
  const c = o && o.choices && o.choices[0]; if (!c) return '';
  const d = c.delta || c.message || {};
  const content = typeof d.content === 'string' ? d.content : Array.isArray(d.content) ? d.content.map(x => (x && x.text) || '').join('') : '';
  const rs = d.reasoning_content || (typeof d.reasoning === 'string' ? d.reasoning : '') || (Array.isArray(d.reasoning_details) ? d.reasoning_details.map(x => (x && (x.text || x.summary)) || '').join('') : '');
  return content + rs;
}
// Текст из ответа в любом виде: обычный JSON или поток SSE (некоторые провайдеры шлют поток всегда)
function anyText(t) {
  try { return deltaText(JSON.parse(t)); } catch (e) {}
  let out = '';
  for (const line of String(t).split('\n')) { const l = line.trim(); if (!l.startsWith('data:')) continue; try { out += deltaText(JSON.parse(l.slice(5).trim())); } catch (e) {} }
  return out;
}
const httpErr = (status, body) => Object.assign(new Error(`HTTP ${status} — ${String(body || '').slice(0, 300)}`), { status, body: String(body || '') });
// Повторять на другой модели? Ключ/доступ и «слишком большой запрос» — нет; всё про модель/перегрузку/таймаут — да.
function retriable(e) {
  const s = e.status || 0, b = String(e.body || e.message || '');
  if (!s) return true;
  if (s === 401 || s === 403) return false;
  if (s === 400 || s === 413 || s === 422) return /model|not found|unsupported|unavailable|does not exist|no such|overload|capacity|disabled|deprecated|not available/i.test(b) && !/reasoning|effort|temperature|parameter|context|too long|tokens/i.test(b);
  return true;
}
const paramErr = e => (e.status === 400 || e.status === 422) && /reasoning|effort|temperature|parameter/i.test(String(e.body || ''));

async function testModel(target, headers, m) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), TEST_MS);
  try {
    const r = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'Ответь одним словом: ок' }] }), signal: ctl.signal });
    if (!r.ok) return false;
    return !!anyText(await r.text()).trim();
  } catch (e) { return false; } finally { clearTimeout(tm); }
}
async function findAlternative(env, base, auth, target, headers, exclude) {
  const ranked = rankList(await listModels(base, auth), env).filter(m => !exclude.has(m) && !isBad(m));
  if (!ranked.length) return '';
  // сначала лучшая модель каждого семейства (gpt, claude, gemini, deepseek…): у них обычно разные каналы провайдера
  const seen = new Set(), order = [];
  for (const m of ranked) { const f = family(m); if (!seen.has(f)) { seen.add(f); order.push(m); } }
  for (const m of ranked) if (!order.includes(m)) order.push(m);
  for (let i = 0; i < Math.min(order.length, 18); i += 6) {
    const batch = order.slice(i, i + 6);
    const ok = await Promise.all(batch.map(m => testModel(target, headers, m).then(v => { if (!v) markBad(m); return v; })));
    // из ответивших — самая сильная
    const good = batch.filter((m, k) => ok[k]);
    if (good.length) { const best = rankList(good, env)[0] || good[0]; markGood(best); return best; }
  }
  return '';
}
const transient = e => { const st = e.status || 0, b = String(e.body || e.message || ''); return [429, 500, 502, 503, 504, 520, 522, 524, 529].includes(st) || /temporar|unavailable|overload|try again|busy|capacity/i.test(b); };
// Открыть поток и дождаться первого настоящего токена (ответа или рассуждения)
async function openStream(target, headers, body, outer) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), FIRST_MS);
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
  try {
    const r = await fetch(target, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body, signal: ctl.signal });
    if (!r.ok) throw httpErr(r.status, await r.text().catch(() => ''));
    const ct = r.headers.get('content-type') || '';
    if (!/event-stream/.test(ct)) {
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { throw httpErr(502, 'bad response'); }
      if (j.error) throw httpErr(j.error.status || 500, JSON.stringify(j.error));
      if (!deltaText(j).trim()) throw httpErr(0, 'empty');
      clearTimeout(tm);
      return { whole: 'data: ' + JSON.stringify(j) + '\n\ndata: [DONE]\n\n' };
    }
    const rd = r.body.getReader(), dec = new TextDecoder(), chunks = []; let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) throw httpErr(0, 'empty stream');
      chunks.push(value); buf += dec.decode(value, { stream: true });
      let i, got = false;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') { if (got) break; throw httpErr(0, 'empty stream'); }
        let j; try { j = JSON.parse(d); } catch (e) { continue; }
        if (j.error) throw httpErr(j.error.status || j.error.code || 500, JSON.stringify(j.error));
        if (deltaText(j)) got = true;
      }
      if (got) { clearTimeout(tm); return { rd, chunks }; }
    }
  } catch (e) {
    clearTimeout(tm);
    try { ctl.abort(); } catch (x) {}
    if (e.name === 'AbortError') throw httpErr(0, 'timeout');
    throw e;
  }
}
// Гонка: основная модель + (через HEDGE_MS тишины) запасная; побеждает первая, кто начал отвечать
function raceFirst(target, headers, j, m1, pickAlt) {
  return new Promise((resolve, reject) => {
    let done = false, pending = 0, hedged = false, lastE = null; const ctls = [], failed = [];
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); fn(v); };
    const start = m => {
      const c = new AbortController(); ctls.push(c); pending++;
      openStream(target, headers, JSON.stringify({ ...j, model: m }), c.signal).then(s => {
        if (done) { try { c.abort(); } catch (e) {} return; }
        ctls.forEach(x => { if (x !== c) try { x.abort(); } catch (e) {} });
        finish(resolve, { s, m });
      }, e => { if (done) return; lastE = e; failed.push(m); e.failed = failed; if (--pending === 0 && (hedged || true)) { if (!hedged) { clearTimeout(t); } finish(reject, lastE); } });
    };
    const t = setTimeout(async () => {
      if (done) return; hedged = true;
      const m2 = await pickAlt().catch(() => '');
      if (done) return;
      if (m2 && m2 !== m1) start(m2);
    }, HEDGE_MS);
    start(m1);
  });
}
async function fetchJSON(target, headers, body) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), FIRST_MS);
  try {
    const r = await fetch(target, { method: 'POST', headers, body, signal: ctl.signal });
    const t = await r.text();
    if (!r.ok) throw httpErr(r.status, t);
    let j; try { j = JSON.parse(t); } catch (e) { const txt = anyText(t); if (!txt.trim()) throw httpErr(/data:/.test(t) ? 0 : 502, /data:/.test(t) ? 'empty' : 'bad response'); j = { choices: [{ index: 0, message: { role: 'assistant', content: txt }, finish_reason: 'stop' }] }; }
    if (j.error) throw httpErr(j.error.status || 500, JSON.stringify(j.error));
    if (!deltaText(j).trim()) throw httpErr(0, 'empty');
    return j;
  } catch (e) { if (e.name === 'AbortError') throw httpErr(0, 'timeout'); throw e; }
  finally { clearTimeout(tm); }
}

export async function handleAI(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const base = (env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const url = new URL(req.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!/^[\w\-./]*$/.test(path) || path.includes('..')) return new Response('bad path', { status: 400, headers: CORS });
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();
  const target = `${base}/${path}${qs ? '?' + qs : ''}`;
  const auth = env.AI_API_KEY ? 'Bearer ' + env.AI_API_KEY : req.headers.get('authorization');
  const headers = { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) };

  // Не чат (список моделей и т.п.) — просто пересылаем
  let raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  let j = null;
  if (raw && /completions$/.test(path)) { try { j = JSON.parse(new TextDecoder().decode(raw)); } catch (e) {} }
  if (!j) {
    try {
      const r = await fetch(target, { method: req.method, headers: { ...headers, 'content-type': req.headers.get('content-type') || 'application/json' }, body: raw });
      const h = new Headers(r.headers); HOP.forEach(k => h.delete(k)); Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: 'Прокси не достучался до провайдера ИИ: ' + e.message } }), { status: 502, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
    }
  }

  await loadShared();
  const primary = await resolveModel(env, base, auth, j.model);
  const stream = !!j.stream;
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const send = s => w.write(typeof s === 'string' ? enc.encode(s) : s).catch(() => {});
  if (stream) send(': connected\n\n');
  const ping = setInterval(() => send(stream ? ': ping\n\n' : ' '), 8000);

  (async () => {
    const tried = new Set(); let lastErr = null;
    const next = () => {
      if (!tried.has(primary) && !isBad(primary)) return primary;
      if (ST.active && !tried.has(ST.active) && !isBad(ST.active) && now() - ST.activeT < ACTIVE_MS) return ST.active;
      return '';
    };
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        let m = next();
        if (!m) { m = await findAlternative(env, base, auth, target, headers, tried); if (!m) break; }
        tried.add(m);
        const body = { ...j, model: m };
        let ok = false, rr = 0;
        for (let p = 0; p < 2 && !ok; p++) {
          try {
            if (stream) {
              let s;
              if (p === 0 && rr === 0) {
                // основная модель + запасная «на подхвате»
                const pickAlt = async () => { if (ST.active && ST.active !== m && !isBad(ST.active)) return ST.active; const r = rankList(await listModels(base, auth), env).filter(x => x !== m && !tried.has(x) && !isBad(x)); return r[0] || ''; };
                try { const w = await raceFirst(target, headers, body, m, pickAlt); s = w.s; if (w.m !== m) { tried.add(w.m); ST.bad[m] = now(); m = w.m; markGood(m); } } // основная тормозит — 5 минут сразу отвечает запасная
                catch (e) { (e.failed || []).filter(x => x !== m).forEach(x => { tried.add(x); markBad(x); }); throw e; }
              } else s = await openStream(target, headers, JSON.stringify(body));
              if (m !== primary) await send('data: ' + JSON.stringify({ tempo: { fallback: true, model: m } }) + '\n\n');
              if (s.whole) await send(s.whole);
              else {
                for (const c of s.chunks) await send(c);
                for (;;) { const { value, done } = await s.rd.read(); if (done) break; await send(value); }
              }
            } else {
              const res = await fetchJSON(target, headers, JSON.stringify(body));
              if (m !== primary) res.tempo = { fallback: true, model: m };
              await send(JSON.stringify(res));
            }
            ok = true;
          } catch (e) {
            lastErr = e;
            if (p === 0 && paramErr(e)) { delete body.reasoning_effort; delete body.temperature; continue; }
            // временный сбой канала («temporarily unavailable», 503, 429…) — подождать и повторить ту же модель
            if (transient(e) && ++rr <= 2) { await sleep(rr * 1200); p--; continue; }
            break;
          }
        }
        if (ok) { if (m === primary) { if (ST.bad[primary]) { delete ST.bad[primary]; saveShared(); } } else if (ST.active !== m) markGood(m); return; }
        if (!retriable(lastErr)) break;   // ключ/доступ/размер — менять модель бесполезно
        markBad(m);
      }
      const st = (lastErr && lastErr.status) || 503;
      const reason = !lastErr ? 'провайдер не дал ни одной рабочей модели'
        : /timeout/.test(lastErr.message) ? 'модели не ответили вовремя'
        : /empty/.test(lastErr.message) ? 'модели вернули пустой ответ'
        : lastErr.message;
      const err = { status: st, message: (st === 401 || st === 403) ? 'Провайдер ИИ отклонил ключ (AI_API_KEY в Vercel): ' + reason : 'ИИ сейчас недоступен — ' + reason + '. Попробуй через минуту.' };
      if (stream) await send('data: ' + JSON.stringify({ error: err }) + '\n\ndata: [DONE]\n\n');
      else await send(JSON.stringify({ error: err }));
    } catch (e) {
      const err = { status: 500, message: 'Ошибка прокси ИИ: ' + e.message };
      await send(stream ? 'data: ' + JSON.stringify({ error: err }) + '\n\ndata: [DONE]\n\n' : JSON.stringify({ error: err }));
    } finally {
      clearInterval(ping);
      w.close().catch(() => {});
    }
  })();

  return new Response(readable, { status: 200, headers: { ...CORS, 'content-type': stream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
}

// Для отладки/тестов
export const _state = { ST, reset() { ST.bad = {}; ST.active = ''; ST.activeT = 0; MODELS = { t: 0, list: [] }; } };
