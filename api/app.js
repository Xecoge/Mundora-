// Mundora — главная страница. Сам сайт отдаётся только вошедшим в аккаунт;
// остальные видят экран входа (код доступа → почта → код из письма). В HTML-коде экрана входа нет ни кодов, ни сайта.
import PAGE from './_page.mjs';
import GATE from './_gate.mjs';
import { dbReady } from './_store.mjs';
import { currentUser, touch, SUPPORT, displayName, accessExpired, avatarOf } from './_auth.mjs';
export const config = { runtime: 'edge' };

const H = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin' };
const safe = o => JSON.stringify(o).replace(/</g, '\\u003c');

export default async function handler(req) {
  let u = null;
  if (dbReady()) { try { u = await currentUser(req); } catch (e) {} }
  if (u && (u.status === 'active' || u.status === 'frozen') && !accessExpired(u)) {
    touch(u).catch(() => {});
    const boot = `<script>window.TEMPO_USER=${safe({ email: u.email, id: u.id, name: displayName(u), avatar: avatarOf(u), bio: u.bio || '', hasName: !!(u.name && u.name.trim()), until: u.accessUntil || 0, open: u.open !== false, verified: !!(u.verified || u.admin || u.shadow), admin: !!(u.admin || u.shadow), owner: u.owner, status: u.status, support: SUPPORT() })}</script>`;
    return new Response(PAGE.replace('</head>', boot + '</head>'), { headers: H });
  }
  return new Response(GATE, { headers: H });
}
