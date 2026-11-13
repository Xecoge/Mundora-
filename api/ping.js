// Vercel: сайт проверяет, что рядом есть сервер TEMPO и настроен ли на нём ИИ.
export const config = { runtime: 'edge' };
import { guard } from './_auth.mjs';
export default async function handler(req) {
  { const g = await guard(req); if (g.res) return g.res; }
  const env = (typeof process !== 'undefined' && process.env) || {};
  return new Response('tempo' + (env.AI_API_KEY ? ' key' : '') + (env.YT_API_KEY ? ' yt' : ''), { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
