// Mundora Bot — общие части: Telegram API, знания о проекте, ИИ (тот же прокси с автозаменой модели), тексты тем.
import { handleAI } from './_ai.mjs';
import { kv, kvMulti, jget, jset } from './_store.mjs';

export const ENV = () => (typeof process !== 'undefined' && process.env) || {};
export const TOKEN = () => String(ENV().TELEGRAM_BOT_TOKEN || ENV().TG_BOT_TOKEN || '').trim();
export const SITE = () => String(ENV().SITE_URL || 'https://mundorai.vercel.app').replace(/\/+$/, '');

export async function tg(method, params = {}) {
  const base = ENV().TG_API_BASE || 'https://api.telegram.org';
  const r = await fetch(`${base}/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
  if (!j.ok) throw Object.assign(new Error(`Telegram ${method}: ${j.description || r.status}`), { tg: j });
  return j.result;
}
export async function secretToken() {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mundora-webhook:' + TOKEN()));
  return Array.from(new Uint8Array(h).slice(0, 20), b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- настройки бота (меняются в админ-панели сайта) ----------
export const DEF_CFG = { price: 50, days: 30, details: '', stars: 0 };
export const cfg = async () => ({ ...DEF_CFG, ...((await jget('tg:cfg')) || {}) });

// ---------- кто такой бот ----------
export async function knowledge() {
  const c = await cfg();
  return `Mundora — сервис «всё в одном»: музыка, финансы, крипта, заметки и ИИ в одном месте. Сайт: ${SITE()}.
• Музыка: поиск треков и артистов; «Волна» — бесконечные рекомендации под твой вкус, как в Яндекс Музыке (учится на лайках, пропусках и плейлистах); волна по настроению (бодрое, весёлое, спокойное, грустное); плейлисты; перенос плейлистов из Яндекс Музыки и Spotify; полные версии хитов через YouTube.
• Финансы: калькулятор, доходы и расходы по категориям, таблицы и выгрузка в CSV, проценты (вклады, кредиты, сложный процент), спред, история расчётов.
• Крипта: курсы в реальном времени как на CoinMarketCap, графики, избранное, цены в долларах и рублях.
• Заметки со списками дел; ИИ дописывает, сокращает и структурирует заметки.
• ИИ-помощник: отвечает на вопросы, читает файлы и фото и сам управляет сайтом — записывает расходы, создаёт заметки, включает музыку, собирает плейлисты.
• Аккаунт: вход по почте с кодом из письма, всё синхронизируется между телефоном и компьютером. Публичный профиль: имя, ID, «капитализация» (очки активности и уровень), галочка «Верифицированный аккаунт» у проверенных.
• Доступ только по коду. Цена — ${c.price} ₽ за ${c.days} дней. Купить — в этом боте (кнопка «Купить доступ» или команда /buy). После оплаты бот присылает код: на сайте ввести код → создать аккаунт (почта, пароль, имя). Когда срок закончится, сайт попросит новый код — все данные сохраняются.
• Поддержка: почта mundoraaiapp@gmail.com, темы «Жалобы» и «Вопросы, баги, предложения» в группе Mundora.
• Правила группы: без мата и оскорблений, без спама и рекламы, жалобы — в «Жалобы», баги и идеи — в «Вопросы, баги, предложения».`;
}
export async function persona() {
  return `Ты — Mundora Bot, официальный бот проекта Mundora в Telegram. Ты дружелюбный, живой, отвечаешь коротко и по делу, по-русски (или на языке собеседника), можно немного эмодзи.
Твои задачи: рассказывать, что такое Mundora и что умеет сайт; помогать купить доступ; отвечать на вопросы; принимать жалобы, баги и предложения; вести темы группы.
Не выдумывай цены, функции и сроки — опирайся только на факты ниже. Если не знаешь — скажи, что передашь вопрос администрации, или дай почту поддержки. Никогда не проси пароли и коды из писем.
Форматирование — только Telegram HTML: <b>, <i>, <u>, <code>, <a href="...">, <blockquote>. Без Markdown, без заголовков #.

Факты о Mundora:
${await knowledge()}`;
}

// ---------- ИИ ----------
// ИИ для бота — как на сайте: потоковый ответ (сервер сам подхватывает запасную модель, если основная молчит),
// минимум «размышлений», чтобы отвечал быстро. Какой уровень рассуждений принимает модель — запоминаем.
async function aiOnce(env, messages, eff) {
  const body = { model: 'auto', stream: true, messages, ...(eff ? { reasoning_effort: eff } : { temperature: 0.7 }) };
  const r = await handleAI(new Request('http://local/api/proxy?path=chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  const raw = await r.text();
  if (!r.ok) { const e = new Error(raw.slice(0, 300)); e.status = r.status; throw e; }
  let out = '', err = '';
  for (const line of raw.split('\n')) {
    const l = line.trim(); if (!l.startsWith('data:')) continue;
    const d = l.slice(5).trim(); if (!d || d === '[DONE]') continue;
    try { const j = JSON.parse(d); if (j.error) { err = j.error.message || String(j.error); continue; } const c = j.choices && j.choices[0]; const t = c && ((c.delta && c.delta.content) || (c.message && c.message.content)); if (t) out += Array.isArray(t) ? t.map(x => x.text || '').join('') : t; } catch (e) {}
  }
  if (!out && raw.trim().startsWith('{')) { try { const j = JSON.parse(raw); const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (c) out = String(c); } catch (e) {} }
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!out) { const e = new Error(err || 'пустой ответ'); e.status = 502; throw e; }
  return out;
}
export async function ai(messages, ms = 30000) {
  const env = ENV(); if (!env.AI_API_KEY) return '';
  const t0 = Date.now();
  const run = (async () => {
    let known = ''; try { known = (await kv('GET', 'ai:botEffort')) || ''; } catch (e) {}
    const ladder = known === 'off' ? [null] : known ? [known] : ['none', 'minimal', 'low', null];
    for (const eff of ladder) {
      try { const t = await aiOnce(env, messages, eff); if (known !== (eff || 'off')) kv('SET', 'ai:botEffort', eff || 'off', 'EX', 86400).catch(() => {}); return t; }
      catch (e) { const badParam = e.status === 400 && /reason|effort|unsupported|unknown|param|invalid/i.test(e.message); if (eff && badParam) continue; if (known) { kv('DEL', 'ai:botEffort').catch(() => {}); } break; }
    }
    // не получилось — ещё одна попытка без параметров (сервер к этому времени уже знает, какая модель тормозит)
    if (Date.now() - t0 < ms - 9000) { try { return await aiOnce(env, messages, null); } catch (e) {} }
    return '';
  })().catch(() => '');
  return Promise.race([run, new Promise(r => setTimeout(() => r(''), ms))]);
}

// Безопасный Telegram-HTML: только разрешённые теги
export function tgHtml(s) {
  s = String(s || '').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>').replace(/<br\s*\/?>/gi, '\n');
  const esc = x => x.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = esc(s);
  out = out.replace(/&lt;(\/?)(b|i|u|s|code|pre|blockquote|tg-spoiler)&gt;/g, '<$1$2>');
  out = out.replace(/&lt;a href=(?:"|&quot;)(https?:\/\/[^"&\s]+|tg:\/\/[^"&\s]+)(?:"|&quot;)&gt;/g, '<a href="$1">').replace(/&lt;\/a&gt;/g, '</a>');
  // закрыть незакрытые теги
  for (const t of ['b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'a']) {
    const o = (out.match(new RegExp('<' + t + '[ >]', 'g')) || []).length, c = (out.match(new RegExp('</' + t + '>', 'g')) || []).length;
    if (o > c) out += `</${t}>`.repeat(o - c);
  }
  return out.slice(0, 4000);
}
export const plain = s => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export async function say(chat_id, text, extra = {}) {
  try { return await tg('sendMessage', { chat_id, text: tgHtml(text), parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  catch (e) { if (/parse|entit/i.test(e.message)) return tg('sendMessage', { chat_id, text: plain(text).slice(0, 4000), disable_web_page_preview: true, ...extra }); throw e; }
}

// ---------- коды доступа (та же база, что у сайта) ----------
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export async function createCode({ days = 30, max = 1, note = '', tg = null }) {
  for (let i = 0; i < 20; i++) {
    const c = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALPH[b % ALPH.length]).join('');
    const rec = { max, used: 0, days, note: String(note).slice(0, 80), created: Date.now(), via: 'telegram', ...(tg && tg.id ? { tg: { id: tg.id, username: tg.username || '', first_name: tg.first_name || '' } } : {}) };
    if ((await kv('SET', 'code:' + c, JSON.stringify(rec), 'NX')) === 'OK') { await kv('SADD', 'codes', c); return c; }
  }
  throw new Error('не удалось создать код');
}

// ---------- темы группы ----------
export const TOPIC_KINDS = [
  ['news', /новост|news/i], ['complaints', /жалоб|complain|report/i], ['trusted', /довер|trust|гарант/i],
  ['questions', /вопрос|баг|предлож|идеи|bug|question/i], ['access', /доступ|покупк|купить|оплат|access/i], ['chat', /общ|чат|флуд|chat|оффтоп/i]
];
export const kindOf = name => (TOPIC_KINDS.find(([, re]) => re.test(name || '')) || ['general'])[0];
const TASK = {
  general: 'Это закреплённое приветствие в главной теме группы Mundora. Расскажи, что такое Mundora, коротко перечисли темы группы и зачем каждая (Новости, Жалобы, Доверенные пользователи, Вопросы/баги/предложения, Доступ к сайту, Общий чат), дай короткие правила и скажи, как купить доступ через бота.',
  news: 'Это первый пост в теме «Новости»: торжественно и живо объяви запуск Mundora, перечисли главные возможности сайта, цену доступа и как его купить. Скажи, что здесь будут обновления.',
  complaints: 'Это закреплённое правило темы «Жалобы»: как правильно подать жалобу (на пользователя, на ошибку оплаты, на контент) — что указать (ID или имя пользователя, что случилось, скрин), что жалоба уйдёт администрации, что флуд и ложные жалобы запрещены. Отдельно: если аккаунт заблокирован — писать на mundoraaiapp@gmail.com.',
  trusted: 'Это закреплённый пост темы «Доверенные пользователи»: объясни, кто это (аккаунты с галочкой «Верифицированный аккаунт» на сайте — их проверила администрация), как получить галочку (быть активным, не нарушать правила, написать администрации), как проверить человека (найти по ID или имени в «Поиск → Люди» на сайте). Список ниже бот добавит сам — не придумывай имена.',
  questions: 'Это закреплённый пост темы «Вопросы, баги, предложения»: как задать вопрос, как сообщить о баге (что делал, что ожидал, что получилось, телефон/ПК, скрин), как предложить идею. Скажи, что бот отвечает сразу, если упомянуть его или ответить на его сообщение, а сложное передаёт администрации.',
  access: 'Это закреплённый пост темы «Доступ к сайту»: что даёт доступ, цена, как купить через бота по шагам (купить → получить код → ввести на сайте → создать аккаунт), что будет, когда срок закончится (сайт попросит новый код, данные сохраняются). Кнопку «Купить доступ» бот добавит сам.',
  chat: 'Это закреплённый пост темы «Общий чат»: тёплое приглашение общаться — музыка, финансы, крипта, делиться плейлистами и находками; короткие правила общения; что бота можно позвать упоминанием.'
};
const FALLBACK = {
  general: c => `👋 <b>Добро пожаловать в Mundora!</b>\n\nMundora — музыка, финансы, крипта, заметки и ИИ в одном месте: ${SITE()}\n\n<b>Темы группы</b>\n🔥 Новости — обновления проекта\n💬 Жалобы — на пользователей и проблемы\n💸 Доверенные пользователи — проверенные аккаунты\n💲 Вопросы, баги, предложения — помощь и идеи\n💻 Доступ к сайту — как купить вход\n🗣 Общий чат — общение\n\n<b>Правила:</b> без мата, оскорблений, спама и рекламы.\n\nДоступ — <b>${c.price} ₽ / ${c.days} дней</b>, купить в боте: /buy`,
  news: c => `🚀 <b>Mundora запущена!</b>\n\n🎧 Музыка с «Волной» под твой вкус\n💰 Доходы и расходы, калькуляторы, проценты\n📈 Крипта в реальном времени\n📝 Заметки с ИИ\n🤖 ИИ-помощник, который сам управляет сайтом\n🔄 Один аккаунт на телефоне и ПК\n\nДоступ — <b>${c.price} ₽ / ${c.days} дней</b>. Купить — в боте: /buy\n\nЗдесь будут все обновления 🔥`,
  complaints: () => `💬 <b>Как подать жалобу</b>\n\n1. Кто: имя или ID пользователя\n2. Что случилось — коротко и по делу\n3. Скриншот, если есть\n\nЖалоба сразу уходит администрации. Флуд и ложные жалобы запрещены.\n\nЕсли заблокирован аккаунт — пиши на <b>mundoraaiapp@gmail.com</b>`,
  trusted: () => `💸 <b>Доверенные пользователи</b>\n\nЭто аккаунты с галочкой «Верифицированный аккаунт» на сайте — их проверила администрация.\n\n<b>Как проверить человека:</b> на сайте «Поиск → Люди» → введи его ID или имя — у доверенных стоит галочка.\n\n<b>Как получить галочку:</b> будь активным, соблюдай правила и напиши администрации.`,
  questions: () => `💲 <b>Вопросы, баги, предложения</b>\n\n❓ <b>Вопрос</b> — пиши как есть, бот ответит сразу (упомяни его или ответь на его сообщение)\n🐞 <b>Баг</b> — что делал, что ожидал, что получилось, телефон или ПК, скриншот\n💡 <b>Идея</b> — опиши, что добавить или улучшить\n\nСложное бот передаст администрации.`,
  access: c => `💻 <b>Доступ к сайту Mundora</b>\n\nЦена — <b>${c.price} ₽ за ${c.days} дней</b>.\n\n<b>Как купить:</b>\n1. Нажми «Купить доступ» ниже\n2. Оплати — бот пришлёт код\n3. Открой ${SITE()} и введи код\n4. Создай аккаунт: почта, пароль, имя\n\nКогда срок закончится, сайт попросит новый код — все данные сохранятся.`,
  chat: () => `🗣 <b>Общий чат</b>\n\nОбщайтесь, делитесь музыкой, плейлистами и находками по финансам и крипте 🎧💰\n\nБез мата, оскорблений и рекламы. Бота можно позвать упоминанием — он ответит.`
};
export async function topicPost(kind, name) {
  const c = await cfg();
  const txt = await ai([{ role: 'system', content: await persona() }, { role: 'user', content: `${TASK[kind] || TASK.general}\nТема называется «${name || 'General'}». Напиши готовый пост для Telegram: живо, структурно, с эмодзи, до 900 символов, Telegram HTML. Только сам текст поста.` }], 45000);
  let out = txt && txt.length > 80 ? txt : FALLBACK[kind](c);
  if (kind === 'trusted') {
    const list = await trustedList();
    out += '\n\n<b>✅ Сейчас с галочкой:</b>\n' + (list.length ? list.map(u => `• ${u.name} — ID <code>${u.id}</code>`).join('\n') : 'пока никого — будь первым!');
  }
  return out;
}
export async function trustedList() {
  const emails = await kv('SMEMBERS', 'users'); const admins = new Set(await kv('SMEMBERS', 'admins'));
  const owner = String(ENV().ADMIN_EMAIL || 'protakolov@gmail.com').toLowerCase();
  const us = (await kvMulti(emails.map(e => ['GET', 'u:' + e]))).map(v => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(Boolean);
  return us.filter(u => (u.verified || admins.has(u.email) || u.email === owner) && u.status !== 'banned').sort((a, b) => (a.id ?? 9e9) - (b.id ?? 9e9)).slice(0, 40)
    .map(u => ({ id: u.id ?? '—', name: (u.name || ('Пользователь ' + (u.id ?? ''))).replace(/[<>&]/g, '') }));
}
