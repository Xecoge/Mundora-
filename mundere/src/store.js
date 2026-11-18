// Общее состояние мессенджера + опрос сервера. Компоненты подписываются через useStore().
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ms, msInit, M } from './api';
import { notify } from './notify';
import * as SecureStore from 'expo-secure-store';

export const S = {
  ready: false, chats: [], peers: {}, msgs: {}, read: {}, typing: {}, G: {}, rx: {}, ed: {}, pin: {},
  v: '0', open: null, net: true, me: null,
};
let ver = 0;
const L = new Set();
export function emit() { ver++; L.forEach(f => f()); }
export function useStore() { return useSyncExternalStore(f => { L.add(f); return () => L.delete(f); }, () => ver); }

export const isG = c => /^g\d+$/.test(String(c || ''));
export const cidOf = p => (isG(p) ? String(p) : [String(M.me), String(p)].sort((a, b) => +a - +b).join('_'));

export async function loadPeers(ids, force) {
  const need = [...new Set(ids.map(String))].filter(id => id && id !== 'null' && !isG(id) && (force || !S.peers[id]));
  for (let i = 0; i < need.length; i += 60) {
    try {
      const j = await ms('peers', null, '&ids=' + need.slice(i, i + 60).join(','));
      for (const p of j.peers) S.peers[p.id] = p;
    } catch (e) {}
  }
  if (need.length) emit();
}

let appActive = true;
function applyChats(chats) {
  // новое входящее сообщение не в открытом чате (или приложение свёрнуто) — уведомление
  if (S.chats.length) {
    const old = new Map(S.chats.map(c => [c.c, c.n || 0]));
    for (const c of chats) {
      const was = old.get(c.c);
      if (was == null ? c.n > 0 && c.u > 0 : c.n > was) {
        if (String(c.f) === String(M.me) || !c.u) continue;
        if (appActive && S.open === c.c) continue;
        if (S.muted && S.muted[c.c]) continue;
        const who = (S.peers[c.f] || {}).name || 'Новое сообщение';
        const title = c.g ? c.g.title : who;
        const body = (c.g && c.g.type !== 'channel' ? who + ': ' : '') + String(c.pv || '');
        notify(title, body, c.g ? { c: c.c } : { c: c.c, peer: String(c.p) });
      }
    }
  }
  S.chats = chats;
  for (const c of chats) if (c.g) S.G[c.c] = c.g;
  loadPeers(chats.flatMap(c => (c.g ? [c.f] : [c.p])).filter(x => x != null));
}

export async function loadMuted() { try { S.muted = JSON.parse((await SecureStore.getItemAsync('muted')) || '{}') || {}; } catch (e) { S.muted = {}; } }
export function toggleMute(c) { S.muted = S.muted || {}; if (S.muted[c]) delete S.muted[c]; else S.muted[c] = 1; SecureStore.setItemAsync('muted', JSON.stringify(S.muted)).catch(() => {}); emit(); return !!S.muted[c]; }
export async function start() {
  await loadMuted();
  const j = await msInit();
  S.me = j.me; S.v = j.v; applyChats(j.chats || []); S.ready = true; emit();
  loop();
}

let timer = null, busy = false, active = true;
AppState.addEventListener('change', s => { active = s === 'active'; appActive = active; if (active) poke(); });
export function poke() { clearTimeout(timer); timer = setTimeout(tick, 30); }
function loop() { clearTimeout(timer); timer = setTimeout(tick, active ? 1100 : 8000); }

const lastI = c => { const L = S.msgs[c]; return L && L.length ? L[L.length - 1].i : -1; };

async function tick() {
  if (busy || !M.tk) return loop();
  busy = true;
  try {
    const c = S.open;
    const qs = '&v=' + encodeURIComponent(S.v) + (c && S.msgs[c] ? '&c=' + c + '&s=' + lastI(c) : '') + (active ? '&hb=1' : '');
    const j = await ms('poll', null, qs);
    S.net = true;
    if (!j.same) {
      S.v = j.v;
      if (j.chats) applyChats(j.chats);
      if (c && j.msgs && S.open === c && S.msgs[c]) {
        const have = new Set(S.msgs[c].map(m => m.i));
        const add = j.msgs.filter(m => !have.has(m.i));
        if (add.length) {
          S.msgs[c] = [...S.msgs[c].filter(m => !(m.tmp && add.some(a => a.f === m.f && a.x === m.x && Math.abs(a.t - m.t) < 60000))), ...add];
          if (isG(c)) loadPeers(add.map(m => m.f).concat(add.flatMap(m => m.u || [])));
          ms('read', { c, s: lastI(c) }).catch(() => {});
        }
        applyExtras(c, j);
      }
      emit();
    }
  } catch (e) {
    if (e.net) { if (S.net) { S.net = false; emit(); } }
  }
  busy = false;
  loop();
}

function applyExtras(c, j) {
  if (j.read != null) S.read[c] = j.read;
  if (j.typing != null) S.typing[c] = j.typing;
  if (j.del) { const D = new Set(j.del); if (S.msgs[c]) S.msgs[c] = S.msgs[c].map(m => (D.has(m.i) ? { ...m, d: 1 } : m)); }
  if (j.hid) { const H = new Set(j.hid); if (S.msgs[c]) S.msgs[c] = S.msgs[c].map(m => (H.has(m.i) ? { ...m, d: 1 } : m)); }
  if (j.rx) S.rx[c] = j.rx;
  if (j.ed) S.ed[c] = j.ed;
  if (j.pin !== undefined) S.pin[c] = j.pin;
  if (j.g) S.G[c] = j.g;
}

export async function openChat(c) {
  S.open = c;
  if (!S.msgs[c]) {
    try {
      const j = await ms('hist', null, '&c=' + c);
      S.msgs[c] = j.msgs; applyExtras(c, j);
      if (isG(c)) loadPeers(j.msgs.map(m => m.f).concat(j.msgs.flatMap(m => m.u || [])));
      else loadPeers(j.msgs.filter(m => m.fw != null).map(m => m.fw));
    } catch (e) { S.msgs[c] = []; }
  }
  const ch = S.chats.find(x => x.c === c); if (ch) ch.u = 0;
  emit();
  if (S.msgs[c].length) ms('read', { c, s: lastI(c) }).catch(() => {});
  poke();
}
export function closeChat(c) { if (S.open === c) S.open = null; }

export async function older(c) {
  const L = S.msgs[c]; if (!L || !L.length || L[0].i <= 0 || S['ld' + c]) return;
  S['ld' + c] = 1;
  try { const j = await ms('hist', null, '&c=' + c + '&before=' + L[0].i); S.msgs[c] = [...j.msgs, ...S.msgs[c]]; emit(); } catch (e) {}
  S['ld' + c] = 0;
}

let tmpN = 0;
export async function sendText(to, c, x, r) {
  const tmp = 't' + Date.now() + (tmpN++);
  const m = { i: 1e12 + tmpN, f: S.me, t: Date.now(), x, tmp, ...(r != null ? { r } : {}) };
  S.msgs[c] = [...(S.msgs[c] || []), m]; emit();
  try {
    const j = await ms('send', { to, x, tmp, ...(r != null ? { r } : {}) });
    const L = S.msgs[c] || [];
    S.msgs[c] = L.some(z => z.i === j.m.i) ? L.filter(z => z.tmp !== tmp) : L.map(z => (z.tmp === tmp ? j.m : z));
    emit(); poke();
  } catch (e) {
    S.msgs[c] = (S.msgs[c] || []).map(z => (z.tmp === tmp ? { ...z, err: 1 } : z)); emit();
    throw e;
  }
}

export const unread = () => S.chats.reduce((n, c) => n + (c.u || 0), 0);
