// TEMPO — проверка имён (ников): формат, мат и оскорбления на русском и английском, уникальность.
// Сначала быстрый фильтр по словарю (ловит и замены букв: «x*й», «xyй», «п1зд», «f.u.c.k»),
// потом нейросеть провайдера ИИ (через тот же прокси с автозаменой модели). Если ИИ не ответил за 9 с — хватает фильтра.
import { handleAI } from './_ai.mjs';
import { kv } from './_store.mjs';

const ENV = () => (typeof process !== 'undefined' && process.env) || {};
const LAT2CYR = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '1': 'и', '@': 'а', $: 'с' };
const PHON = [['shch', 'щ'], ['zh', 'ж'], ['ch', 'ч'], ['sh', 'ш'], ['kh', 'х'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'ё'], ['ts', 'ц']];
const PH1 = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц', y: 'ы', x: 'х', w: 'в', q: 'к' };
const translit = x => { PHON.forEach(([a, b]) => { x = x.split(a).join(b); }); return x.replace(/[a-z]/g, ch => PH1[ch] || ch); };
const CYR2LAT = { а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y', и: 'i', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
const RU_FLAT = /(ху[йеёияю]|пизд|п[иеё]зд|бляд|муд[аои]к|мудил|пид[оа]р|педик|гандон|шлюх|залуп|дроч|минет|шалав|долбо[её]б|[ую][её]б[аоуи]|за[её]б|выеб|съеб|хуесос|говн|жоп[аеуы]|нацист|гитлер)/;
const RU_WORD = /(^|[^а-яa-z0-9])([её]б[аиулн]|бля|сук[аи]|чмо|херн)/;
const EN_BAD = /(fuck|fck|shit|bitch|cunt|dickhead|pussy|nigg|faggot|whore|slut|asshole|porn|retard|penis|vagina|hitler)/;
const OFFICIAL = /(админ|admin|модер|moder|поддержк|support|tempo\s*team|официальн|official|верифиц|verif)/i;

export function nameFormat(n) {
  n = String(n || '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 24) return { ok: false, reason: 'Имя — от 2 до 24 символов' };
  if (!/^[A-Za-zА-Яа-яЁё0-9 _.\-]+$/.test(n)) return { ok: false, reason: 'Только русские и английские буквы, цифры, пробел, _ . -' };
  if ((n.match(/[A-Za-zА-Яа-яЁё]/g) || []).length < 2) return { ok: false, reason: 'В имени нужны хотя бы 2 буквы' };
  return { ok: true, name: n };
}
export function nameDict(n) {
  const low = n.toLowerCase().replace(/ё/g, 'е');
  const toCyr = x => x.replace(/[a-z0-9@$]/g, ch => LAT2CYR[ch] || ch);
  const flat = low.replace(/[\s_.\-]+/g, '');
  const words = toCyr(low.replace(/[_.\-]+/g, ' '));
  const cyr = toCyr(flat), cyrB = toCyr(flat.replace(/b/g, '6')), lat = flat.replace(/[а-я0-9@$]/g, ch => CYR2LAT[ch] || ch);
  if (RU_FLAT.test(cyr) || RU_FLAT.test(cyrB) || RU_FLAT.test(translit(flat)) || RU_WORD.test(translit(low)) || RU_WORD.test(words) || RU_WORD.test(toCyr(low.replace(/[_.\-]+/g, ' ').replace(/b/g, '6'))) || EN_BAD.test(lat) || EN_BAD.test(flat)) return { ok: false, reason: 'В имени есть мат или оскорбление' };
  return { ok: true };
}

async function nameAI(n) {
  const env = ENV(); if (!env.AI_API_KEY) return null;
  const body = {
    model: 'auto', temperature: 0, stream: false,
    messages: [
      { role: 'system', content: 'Ты модератор имён пользователей сайта. Отвечай ТОЛЬКО JSON без пояснений: {"ok":true} или {"ok":false,"reason":"коротко по-русски"}. Запрещай: мат, оскорбления, грубые и сексуальные слова на русском и английском — в том числе завуалированные (замены букв, транслит, пропуски, слитно с другими словами), разжигание ненависти, наркотики, экстремизм, имена реальных диктаторов и террористов, выдачу себя за администрацию или поддержку. Всё остальное разрешай: обычные имена, ники, слова, шутливые безобидные ники.' },
      { role: 'user', content: 'Имя: «' + n + '»' }
    ]
  };
  const req = new Request('http://local/api/proxy?path=chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const run = (async () => {
    const r = await handleAI(req, env); const t = (await r.text()).trim();
    const j = JSON.parse(t); const c = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const m = String(c).replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*?\}/); if (!m) return null;
    const v = JSON.parse(m[0]); return typeof v.ok === 'boolean' ? { ok: v.ok, reason: v.reason ? String(v.reason).slice(0, 120) : '' } : null;
  })().catch(() => null);
  return Promise.race([run, new Promise(r => setTimeout(() => r(null), 9000))]);
}

// Полная проверка. email — чей это ник (свой ник можно оставить)
export async function checkName(raw, email, { admin = false } = {}) {
  const f = nameFormat(raw); if (!f.ok) return f;
  const n = f.name;
  const d = nameDict(n); if (!d.ok) return d;
  if (!admin && OFFICIAL.test(n)) return { ok: false, reason: 'Такие имена только для официальных аккаунтов' };
  const owner = await kv('GET', 'nm:' + n.toLowerCase());
  if (owner && owner !== email) return { ok: false, reason: 'Это имя уже занято' };
  const ai = await nameAI(n);
  if (ai && !ai.ok) return { ok: false, reason: ai.reason ? 'Нейросеть не пропустила имя: ' + ai.reason : 'Нейросеть не пропустила это имя' };
  return { ok: true, name: n, ai: !!ai };
}
// Закрепить имя за аккаунтом (старое — освободить)
export async function claimName(name, email, oldName) {
  const key = 'nm:' + name.toLowerCase();
  const ok = (await kv('SET', key, email, 'NX')) === 'OK' || (await kv('GET', key)) === email;
  if (!ok) return false;
  if (oldName && oldName.toLowerCase() !== name.toLowerCase()) { const o = await kv('GET', 'nm:' + oldName.toLowerCase()); if (o === email) await kv('DEL', 'nm:' + oldName.toLowerCase()); }
  return true;
}
