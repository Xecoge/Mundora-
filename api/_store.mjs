// Mundora — база данных.
// На Vercel: Upstash Redis (Vercel → Storage → Create → Upstash for Redis → Connect to project).
// Подключение само добавляет переменные KV_REST_API_URL и KV_REST_API_TOKEN (или UPSTASH_REDIS_REST_URL/TOKEN).
// Локально (node server.js) без этих переменных данные хранятся в файле data/db.json.

const ENV = () => (typeof process !== 'undefined' && process.env) || {};

export function kvConfig(env = ENV()) {
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // переменные с префиксом, например STORAGE_KV_REST_API_URL
    for (const k of Object.keys(env)) {
      if (!url && /(REST_API_URL|REDIS_REST_URL)$/.test(k) && /^https:/.test(env[k] || '')) url = env[k];
      if (!token && /(REST_API_TOKEN|REDIS_REST_TOKEN)$/.test(k) && !/READ_ONLY/.test(k)) token = env[k];
    }
  }
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

let LOCAL = null; // локальное хранилище (только Node)
export function useLocalStore(store) { LOCAL = store; }
export const dbReady = (env = ENV()) => !!(kvConfig(env) || LOCAL);

async function rest(path, body) {
  const c = kvConfig();
  const r = await fetch(c.url + path, { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'bad db response ' + r.status }));
  if (!r.ok && !Array.isArray(j)) throw new Error('База: ' + (j.error || r.status));
  return j;
}

// Одна команда Redis: kv('SET','k','v','EX',60)
export async function kv(...cmd) {
  cmd = cmd.map(x => typeof x === 'number' ? String(x) : x);
  if (!kvConfig() && LOCAL) return LOCAL.exec(cmd);
  if (!kvConfig()) throw new Error('База данных не подключена');
  const j = await rest('', cmd);
  if (j.error) throw new Error('База: ' + j.error);
  return j.result;
}
// Несколько команд за один запрос
export async function kvMulti(cmds) {
  if (!cmds.length) return [];
  cmds = cmds.map(c => c.map(x => typeof x === 'number' ? String(x) : x));
  if (!kvConfig() && LOCAL) return cmds.map(c => LOCAL.exec(c));
  if (!kvConfig()) throw new Error('База данных не подключена');
  const j = await rest('/pipeline', cmds);
  return j.map(x => { if (x.error) throw new Error('База: ' + x.error); return x.result; });
}

export const jget = async k => { const v = await kv('GET', k); try { return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
export const jset = (k, v, ex) => ex ? kv('SET', k, JSON.stringify(v), 'EX', ex) : kv('SET', k, JSON.stringify(v));
export const pairs = arr => { const o = {}; for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

// Ограничение частоты: true — можно, false — слишком часто
export async function limit(key, max, sec) {
  const [n] = await kvMulti([['INCR', 'rl:' + key], ['EXPIRE', 'rl:' + key, sec, 'NX']]);
  return n <= max;
}

// ---------- локальная реализация нужных команд Redis (для node server.js и тестов) ----------
export function memoryStore(load, persist) {
  const D = new Map(load ? Object.entries(load.d || {}) : []); const X = new Map(load ? Object.entries(load.x || {}) : []);
  const now = () => Date.now();
  const live = k => { const e = X.get(k); if (e && e <= now()) { D.delete(k); X.delete(k); } return D.has(k); };
  const h = k => { if (!live(k)) D.set(k, { h: {} }); const v = D.get(k); if (!v.h) throw new Error('WRONGTYPE'); return v.h; };
  const s = k => { if (!live(k)) D.set(k, { s: [] }); const v = D.get(k); if (!v.s) throw new Error('WRONGTYPE'); return v.s; };
  let t; const save = () => { if (!persist) return; clearTimeout(t); t = setTimeout(() => persist({ d: Object.fromEntries(D), x: Object.fromEntries(X) }), 50); };
  function exec([c, ...a]) {
    c = String(c).toUpperCase(); let r;
    switch (c) {
      case 'GET': r = live(a[0]) && 'v' in D.get(a[0]) ? D.get(a[0]).v : null; break;
      case 'SET': {
        const opt = a.slice(2).map(String); const nx = opt.some(o => o.toUpperCase() === 'NX');
        if (nx && live(a[0])) { r = null; break; }
        D.set(a[0], { v: String(a[1]) }); X.delete(a[0]);
        const i = opt.findIndex(o => o.toUpperCase() === 'EX'); if (i >= 0) X.set(a[0], now() + +opt[i + 1] * 1000);
        r = 'OK'; break;
      }
      case 'DEL': r = a.filter(k => live(k) && (D.delete(k), X.delete(k), true)).length; break;
      case 'EXISTS': r = a.filter(k => live(k)).length; break;
      case 'INCR': case 'INCRBY': { const v = (live(a[0]) ? +D.get(a[0]).v : 0) + (c === 'INCR' ? 1 : +a[1]); D.set(a[0], { v: String(v) }); r = v; break; }
      case 'EXPIRE': { if (!live(a[0])) { r = 0; break; } if (String(a[2] || '').toUpperCase() === 'NX' && X.has(a[0])) { r = 0; break; } X.set(a[0], now() + +a[1] * 1000); r = 1; break; }
      case 'TTL': r = !live(a[0]) ? -2 : X.has(a[0]) ? Math.ceil((X.get(a[0]) - now()) / 1000) : -1; break;
      case 'HSET': { const o = h(a[0]); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!(a[i] in o)) n++; o[a[i]] = String(a[i + 1]); } r = n; break; }
      case 'HGET': r = live(a[0]) && D.get(a[0]).h ? (D.get(a[0]).h[a[1]] ?? null) : null; break;
      case 'HMGET': r = a.slice(1).map(f => live(a[0]) && D.get(a[0]).h ? (D.get(a[0]).h[f] ?? null) : null); break;
      case 'HGETALL': r = live(a[0]) && D.get(a[0]).h ? Object.entries(D.get(a[0]).h).flat() : []; break;
      case 'HDEL': { if (!live(a[0])) { r = 0; break; } const o = h(a[0]); r = a.slice(1).filter(f => f in o && delete o[f]).length; break; }
      case 'HLEN': r = live(a[0]) && D.get(a[0]).h ? Object.keys(D.get(a[0]).h).length : 0; break;
      case 'SADD': { const o = s(a[0]); r = a.slice(1).filter(m => !o.includes(m) && o.push(m)).length; break; }
      case 'SREM': { if (!live(a[0])) { r = 0; break; } const o = s(a[0]); r = 0; a.slice(1).forEach(m => { const i = o.indexOf(m); if (i >= 0) { o.splice(i, 1); r++; } }); break; }
      case 'SMEMBERS': r = live(a[0]) && D.get(a[0]).s ? [...D.get(a[0]).s] : []; break;
      case 'SISMEMBER': r = live(a[0]) && D.get(a[0]).s && D.get(a[0]).s.includes(a[1]) ? 1 : 0; break;
      case 'SCARD': r = live(a[0]) && D.get(a[0]).s ? D.get(a[0]).s.length : 0; break;
      default: throw new Error('unsupported ' + c);
    }
    if (!/^(GET|EXISTS|TTL|HGET|HMGET|HGETALL|HLEN|SMEMBERS|SCARD|SISMEMBER)$/.test(c)) save();
    return r;
  }
  return { exec };
}
