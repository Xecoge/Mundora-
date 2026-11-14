// Vercel: доступ сайта к музыкальным каталогам (Deezer, iTunes, чарт Apple Music) и поиску видео на YouTube.
// Необязательная переменная окружения: YT_API_KEY — ключ YouTube Data API v3 (для полных версий треков).
export const config = { runtime: 'edge' };

const SRC = {
  deezer: 'https://api.deezer.com/',
  itunes: 'https://itunes.apple.com/',
  applerss: 'https://rss.applemarketingtools.com/api/v2/'
};
const H = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
const out = (obj, status = 200, cache = 'no-store') => new Response(JSON.stringify(obj), { status, headers: { ...H, 'cache-control': cache } });

import { guard } from './_auth.mjs';
import { kv, kvMulti, dbReady } from './_store.mjs';

// Лимит YouTube API сбрасывается в полночь по тихоокеанскому времени
function secToPacificMidnight() {
  const now = new Date(), p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(now).map(x => [x.type, x.value]));
  const passed = (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
  return Math.max(300, 86400 - passed + 120);
}
const ytNorm = q => String(q).toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
export default async function handler(req) {
  { const g = await guard(req); if (g.res) return g.res; }
  const env = (typeof process !== 'undefined' && process.env) || {};
  const u = new URL(req.url);
  const src = u.searchParams.get('src') || '';
  const path = (u.searchParams.get('path') || '').replace(/^\/+/, '');
  u.searchParams.delete('src'); u.searchParams.delete('path');
  if (!/^[\w\-./]*$/.test(path) || path.includes('..')) return out({ error: 'bad path' }, 400);
  try {
    if (src === 'yt') {
      const key = env.YT_API_KEY;
      if (!key) return out({ error: 'YT_API_KEY не задан' }, 501);
      const q = u.searchParams.get('q') || '';
      const ck = 'yt:q:' + ytNorm(q);
      // 1) общий кэш: один и тот же трек ищется в YouTube один раз на всех
      if (dbReady()) {
        try {
          const [hit, quota] = await kvMulti([['GET', ck], ['TTL', 'yt:quota']]);
          if (hit) return out({ items: JSON.parse(hit), cached: true }, 200, 'public, s-maxage=86400, max-age=3600');
          if (quota > 0) return out({ error: 'Дневной лимит YouTube API исчерпан', quota: true, retryIn: quota }, 429);
        } catch (e) {}
      }
      const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', videoEmbeddable: 'true', videoCategoryId: '10', q, key }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || '', msg = (j.error && j.error.message) || 'YouTube ' + r.status;
        const quota = /quota|dailyLimit|rateLimitExceeded/i.test(reason + ' ' + msg);
        if (dbReady()) { try { await kvMulti([['SET', 'yt:lasterr', JSON.stringify({ t: Date.now(), status: r.status, reason, msg: msg.replace(/<[^>]+>/g, '').slice(0, 300) })], ...(quota ? [['SET', 'yt:quota', '1', 'EX', secToPacificMidnight()]] : [])]); } catch (e) {} }
        return out({ error: quota ? 'Дневной лимит YouTube API исчерпан' : msg.replace(/<[^>]+>/g, ''), quota, reason }, quota ? 429 : r.status);
      }
      const items = (j.items || []).map(x => ({ id: x.id && x.id.videoId, title: x.snippet && x.snippet.title, channel: x.snippet && x.snippet.channelTitle })).filter(x => x.id);
      if (dbReady()) { try { await kvMulti([['SET', ck, JSON.stringify(items), 'EX', 30 * 86400], ['SET', 'yt:ok', String(Date.now())], ['INCR', 'yt:calls:' + new Date().toISOString().slice(0, 10)]]); } catch (e) {} }
      return out({ items }, 200, 'public, s-maxage=86400, max-age=3600');
    }
    const base = SRC[src];
    if (!base) return out({ error: 'unknown source' }, 400);
    const qs = u.searchParams.toString();
    const r = await fetch(base + path + (qs ? '?' + qs : ''), { headers: { accept: 'application/json' } });
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { ...H, 'cache-control': r.ok ? 'public, s-maxage=300, max-age=60' : 'no-store' } });
  } catch (e) {
    return out({ error: String(e.message || e) }, 502);
  }
}
