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
      const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', videoEmbeddable: 'true', videoCategoryId: '10', q, key }));
      const j = await r.json();
      if (!r.ok) return out({ error: (j.error && j.error.message) || 'YouTube ' + r.status }, r.status);
      const items = (j.items || []).map(x => ({ id: x.id && x.id.videoId, title: x.snippet && x.snippet.title, channel: x.snippet && x.snippet.channelTitle })).filter(x => x.id);
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
