// Vercel: Deezer/iTunes/Apple Music plus audio-only full-track search via Invidious REST API.
// Optional: INVIDIOUS_API_BASE selects the primary Invidious instance; YT_API_KEY is legacy and not used.
export const config = { runtime: 'edge' };

const SRC = {
  deezer: 'https://api.deezer.com/',
  itunes: 'https://itunes.apple.com/',
  applerss: 'https://rss.applemarketingtools.com/api/v2/'
};
const H = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
const out = (obj, status = 200, cache = 'no-store') => new Response(JSON.stringify(obj), { status, headers: { ...H, 'cache-control': cache } });

// Invidious provides search metadata and locally proxied audio-only URLs; override the primary host via INVIDIOUS_API_BASE.
const INVIDIOUS_FALLBACKS = ['https://yt.chocolatemoo53.com', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://invidious.tiekoetter.com'];
function invidiousBases(env) {
  const configured = String(env.INVIDIOUS_API_BASE || '').trim().replace(/\/+$/, '');
  return [...new Set([configured, ...INVIDIOUS_FALLBACKS].filter(Boolean))].filter(base => {
    try { return new URL(base).protocol === 'https:'; } catch { return false; }
  });
}
async function invidiousFetch(env, endpoint, params = {}) {
  let status = 502;
  for (const base of invidiousBases(env)) {
    try {
      const url = new URL('api/v1/' + endpoint.replace(/^\/+/, ''), base + '/');
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mundora/1.0' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) { status = r.status; continue; }
      return await r.json();
    } catch (e) { status = 502; }
  }
  const err = new Error('Invidious API временно недоступен');
  err.status = status;
  throw err;
}
function chooseInvidiousAudio(streams) {
  const audio = (Array.isArray(streams) ? streams : []).filter(x => x && x.url && String(x.type || '').startsWith('audio/'));
  audio.sort((a, b) => {
    const score = x => (String(x.type).includes('audio/mp4') ? 1000000 : String(x.type).includes('audio/mpeg') ? 900000 : 0) + (+x.bitrate || 0);
    return score(b) - score(a);
  });
  const best = audio.find(x => { try { return new URL(x.url).protocol === 'https:'; } catch { return false; } });
  return best ? { url: best.url, mimeType: best.type || '', quality: best.quality || '' } : null;
}

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
      // Legacy Google YouTube Data API remains in this file but is deliberately not used.
      return out({ error: 'YouTube Data API отключён; используется Invidious REST API', disabled: true }, 503);
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
    if (src === 'invidious') {
      if (path === 'search') {
        const q = String(u.searchParams.get('q') || '').trim().slice(0, 200);
        if (!q) return out({ error: 'query required' }, 400);
        const data = await invidiousFetch(env, 'search', { q, type: 'video' });
        const items = (Array.isArray(data) ? data : (data.items || []))
          .filter(x => !x.type || x.type === 'video')
          .map(x => ({ id: String(x.videoId || ''), title: String(x.title || ''), channel: String(x.author || '') }))
          .filter(x => x.id && x.title).slice(0, 30);
        return out({ items }, 200, 'public, s-maxage=600, max-age=300');
      }
      const streamMatch = path.match(/^streams\/([A-Za-z0-9_-]{6,20})$/);
      if (streamMatch) {
        const data = await invidiousFetch(env, 'videos/' + streamMatch[1], { local: 'true' });
        const audio = chooseInvidiousAudio(data.adaptiveFormats);
        if (!audio) return out({ error: 'Invidious не вернул доступный аудиопоток' }, 404);
        return out(audio, 200, 'no-store');
      }
      return out({ error: 'unknown Invidious endpoint' }, 400);
    }
    const base = SRC[src];
    if (!base) return out({ error: 'unknown source' }, 400);
    const qs = u.searchParams.toString();
    const r = await fetch(base + path + (qs ? '?' + qs : ''), { headers: { accept: 'application/json' } });
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { ...H, 'cache-control': r.ok ? 'public, s-maxage=300, max-age=60' : 'no-store' } });
  } catch (e) {
    return out({ error: String(e.message || e) }, e.status || 502);
  }
}
