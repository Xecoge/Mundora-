// TEMPO — синхронизация данных аккаунта между устройствами (телефон, ПК…).
// GET  /api/sync?since=N  → изменения после версии N
// POST /api/sync {set:{ключ:значение}} → сохранить изменения
import { kv, kvMulti, pairs } from './_store.mjs';
import { guard, json, touch } from './_auth.mjs';
export const config = { runtime: 'edge' };

const KEY_RX = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/, MAX_ONE = 950000, MAX_ALL = 3500000;

export default async function handler(req) {
  const g = await guard(req, true); if (g.res) return g.res;
  const u = g.user, e = u.email;
  try {
    if (req.method === 'GET') {
      const since = +new URL(req.url).searchParams.get('since') || 0;
      const [v, dt] = await kvMulti([['GET', 'dv:' + e], ['HGETALL', 'dt:' + e]]);
      const ver = +v || 0;
      touch(u).catch(() => {});
      if (ver === since) return json({ ver, status: u.status });
      const m = pairs(dt); const keys = Object.keys(m).filter(k => +m[k] > since || ver < since);
      const vals = keys.length ? await kv('HMGET', 'd:' + e, ...keys) : [];
      const data = {}; keys.forEach((k, i) => { if (vals[i] != null) { try { data[k] = JSON.parse(vals[i]); } catch (x) {} } });
      return json({ ver, data, status: u.status });
    }
    if (req.method === 'POST') {
      if (u.status === 'frozen') return json({ error: 'Аккаунт заморожен администратором — изменения не сохраняются', frozen: true }, 423);
      const body = await req.json().catch(() => null);
      const set = body && body.set; if (!set || typeof set !== 'object') return json({ error: 'нет данных' }, 400);
      const ents = Object.entries(set).filter(([k]) => KEY_RX.test(k)).map(([k, v]) => [k, JSON.stringify(v)]);
      const big = ents.filter(([, s]) => s.length > MAX_ONE).map(([k]) => k);
      const ok = ents.filter(([, s]) => s.length <= MAX_ONE);
      if (ok.reduce((n, [, s]) => n + s.length, 0) > MAX_ALL) return json({ error: 'Слишком много данных за раз' }, 413);
      if (!ok.length) return json({ ver: +(await kv('GET', 'dv:' + e)) || 0, skipped: big });
      const ver = await kv('INCR', 'dv:' + e);
      await kvMulti([['HSET', 'd:' + e, ...ok.flat()], ['HSET', 'dt:' + e, ...ok.flatMap(([k]) => [k, ver])]]);
      return json({ ver, skipped: big });
    }
    return json({ error: 'method' }, 405);
  } catch (x) { return json({ error: x.message }, 500); }
}
