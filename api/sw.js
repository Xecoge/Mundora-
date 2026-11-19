// Service worker Mundora: уведомления о звонках и сообщениях, даже когда сайт закрыт.
// Пуш приходит без данных — воркер сам спрашивает у сервера, что случилось (звонок или новое сообщение).
export const config = { runtime: 'edge' };
const SW = `
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
async function pend() { try { const r = await fetch('/api/msg?a=pend', { credentials: 'include', cache: 'no-store' }); return await r.json(); } catch (e) { return {}; } }
self.addEventListener('push', e => e.waitUntil((async () => {
  const j = await pend();
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const seen = wins.some(w => w.visibilityState === 'visible');
  if (j.call) {
    if (seen) return; // сайт открыт и на экране — звонок покажет сама страница
    return self.registration.showNotification((j.call.kind === 'video' ? '📹 Видеозвонок' : '📞 Звонок') + ' — ' + j.call.name, {
      body: 'Mundora · нажми, чтобы ответить', tag: 'call', renotify: true, requireInteraction: true,
      vibrate: [600, 300, 600, 300, 600, 300, 600], icon: j.call.ava || '/img/logo-mark.webp', badge: '/img/logo-mark.webp',
      data: { call: j.call }, actions: [{ action: 'ok', title: 'Ответить' }, { action: 'no', title: 'Отклонить' }] });
  }
  if (j.end) { const L = await self.registration.getNotifications({ tag: 'call' }); L.forEach(n => n.close()); if (j.miss) return self.registration.showNotification('Пропущенный звонок — ' + j.miss.name, { body: 'Mundora', tag: 'miss' + j.miss.id, icon: j.miss.ava || '/img/logo-mark.webp', data: { url: '/#msg-' + j.miss.from } }); return; }
  if (j.msg) { if (seen) return; return self.registration.showNotification(j.msg.name, { body: j.msg.pv, tag: 'm' + j.msg.c, renotify: true, icon: j.msg.ava || '/img/logo-mark.webp', badge: '/img/logo-mark.webp', data: { url: j.msg.url } }); }
  if (!seen) return self.registration.showNotification('Mundora', { body: 'Новые сообщения', tag: 'mundora', icon: '/img/logo-mark.webp' });
})()));
self.addEventListener('notificationclick', e => { const n = e.notification, d = n.data || {}; n.close();
  e.waitUntil((async () => {
    if (d.call && e.action === 'no') { try { const i = await (await fetch('/api/msg?a=init', { credentials: 'include' })).json(); await fetch('/api/msg?a=cend', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tk: i.tk, id: d.call.id, why: 'decline' }) }); } catch (x) {} return; }
    const url = d.call ? '/?call=' + d.call.id + (e.action === 'ok' ? '&ans=1' : '') + '#msg-' + d.call.from : d.url || '/#msg';
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { try { await w.focus(); w.postMessage({ mundora: 'open', url, call: d.call || null, ans: e.action === 'ok' }); return; } catch (x) {} }
    return self.clients.openWindow(url);
  })()); });
`;
export default async function handler() {
  return new Response(SW, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' } });
}
