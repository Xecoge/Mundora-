// Vercel: сайт проверяет, что рядом есть сервер TEMPO и настроен ли на нём ИИ.
export const config = { runtime: 'edge' };
export default function handler() {
  const env = (typeof process !== 'undefined' && process.env) || {};
  return new Response('tempo' + (env.AI_API_KEY ? ' key' : '') + (env.YT_API_KEY ? ' yt' : ''), { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
