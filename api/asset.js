// Скрипт и стили сайта — только для вошедших; браузер кэширует их по версии (?v=), поэтому сайт открывается быстро.
import A from './_asset.mjs';
import { sessionFromCookie } from './_auth.mjs';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const url = new URL(req.url), f = url.searchParams.get('f');
  if (!(await sessionFromCookie(req).catch(() => null))) return new Response('Нужно войти', { status: 401 });
  const body = f === 'css' ? A.css : f === 'js' ? A.js : null; if (body == null) return new Response('Not found', { status: 404 });
  const fresh = url.searchParams.get('v') === A.hash;
  return new Response(body, { headers: { 'content-type': f === 'css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8', 'cache-control': fresh ? 'private, max-age=31536000, immutable' : 'private, no-cache' } });
}
