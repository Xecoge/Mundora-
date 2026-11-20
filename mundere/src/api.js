// Mundere ↔ сервер Mundora: та же база, те же аккаунты. Куки сессии храним в защищённом хранилище телефона.
import * as SecureStore from 'expo-secure-store';

export const BASE = 'https://mundorai.vercel.app';
let CK = {};

export async function loadSession() {
  try { CK = JSON.parse((await SecureStore.getItemAsync('ck')) || '{}') || {}; } catch (e) { CK = {}; }
  return !!CK.tempo_s;
}
async function saveCk() { try { await SecureStore.setItemAsync('ck', JSON.stringify(CK)); } catch (e) {} }
export async function dropSession() { delete CK.tempo_s; await saveCk(); }
export const ckHeader = () => Object.entries(CK).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('; ');
export const hasSession = () => !!CK.tempo_s;

export async function req(path, body, opt = {}) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), opt.timeout || 20000);
  let r;
  try {
    r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-app': 'mundere', 'x-cookie': ckHeader(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(tm);
    const er = new Error('Нет соединения'); er.net = true; throw er;
  }
  clearTimeout(tm);
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (j && j._ck) {
    for (const [k, v] of Object.entries(j._ck)) { if (v) CK[k] = v; else delete CK[k]; }
    await saveCk();
  }
  if (!r.ok) { const e = new Error((j && j.error) || 'Ошибка ' + r.status); e.status = r.status; e.data = j; throw e; }
  return j;
}

export const auth = (a, b) => req('/api/auth?a=' + a, b || {});
export const people = qs => req('/api/people?' + qs);

// мессенджер
export const M = { tk: '', me: null };
export async function msInit() { const j = await req('/api/msg?a=init'); M.tk = j.tk; M.me = j.me; return j; }
export const ms = (a, body, qs = '') =>
  req('/api/msg?a=' + a + qs + (body ? '' : '&tk=' + encodeURIComponent(M.tk)), body ? { tk: M.tk, ...body } : null);

export const fileUri = id => BASE + '/api/msg?a=file&id=' + encodeURIComponent(id) + '&tk=' + encodeURIComponent(M.tk);
export const authed = uri => ({ uri, headers: { 'x-cookie': ckHeader(), 'x-app': 'mundere' } });
export const avaUri = k => (typeof k === 'string' && k.startsWith('/') ? BASE + k : BASE + '/img/' + (k || 'planet') + '.webp');
export const gAvaUri = g => (g && g.av ? BASE + '/api/msg?a=gava&c=' + g.id + '&v=' + g.av : null);

// загрузка файла кусками (как на сайте): base64 до ~560 КБ на кусок
export async function upload(to, b64, meta) {
  const CH = 560000, n = Math.max(1, Math.ceil(b64.length / CH));
  let id = '';
  for (let i = 0; i < n; i++) {
    const j = await ms('up', { to, id: id || undefined, i, n, name: meta.name, type: meta.type, size: meta.size, data: b64.slice(i * CH, (i + 1) * CH) });
    id = j.id;
  }
  return id;
}
