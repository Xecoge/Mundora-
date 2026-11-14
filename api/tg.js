// Mundora Bot — Telegram-бот, живёт на этом же сайте (Telegram присылает сообщения сюда, webhook).
// Нужна переменная TELEGRAM_BOT_TOKEN в Vercel, потом в админ-панели сайта: «Подключить бота».
import { kv, kvMulti, jget, jset, limit, dbReady } from './_store.mjs';
import { guard, json, rand, linkTg, getUser, putUser, displayName } from './_auth.mjs';
import { tg, TOKEN, SITE, secretToken, cfg, DEF_CFG, persona, ai, say, tgHtml, createCode, kindOf, topicPost } from './_tg.mjs';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const ME = async () => (await jget('tg:me')) || (async () => { const m = await tg('getMe'); await jset('tg:me', m); return m; })();
const tgAdmins = async () => (await kv('SMEMBERS', 'tg:admins')).map(Number);
const isTgAdmin = async id => (await kv('SISMEMBER', 'tg:admins', String(id))) === 1;
const uname = u => u ? (u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ')) : '';
const userLink = u => `<a href="tg://user?id=${u.id}">${tgHtml(uname(u) || 'пользователь')}</a>`;
const cmd = (text, name) => { const m = String(text || '').match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i); return m && m[1].toLowerCase() === name ? (m[3] || '').trim() : null; };
const anyCmd = text => { const m = String(text || '').match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i); return m ? { c: m[1].toLowerCase(), arg: (m[3] || '').trim(), at: m[2] } : null; };

async function notifyAdmins(text, extra = {}) {
  const ids = await tgAdmins(); let n = 0;
  for (const id of ids) { try { await say(id, text, extra); n++; } catch (e) {} }
  return n;
}
// Заявки на покупку уходят продавцу — аккаунту @qlidw (можно сменить в Vercel: TG_SALES=ник).
// Боту Telegram нужен числовой id: он появляется, когда продавец хоть раз нажмёт «Старт» у бота.
const SALES = () => String((typeof process !== 'undefined' && process.env && process.env.TG_SALES) || 'qlidw').replace(/^@/, '').toLowerCase();
const salesId = async () => +(await kv('GET', 'tg:un:' + SALES())) || 0;
const isSales = async id => id && id === await salesId();
async function notifySales(text, extra = {}) {
  const id = await salesId();
  if (id) { try { await say(id, text, extra); return [id]; } catch (e) {} }
  // продавец ещё не запускал бота — отправим админам и напомним
  await notifyAdmins(text + `\n\n<i>⚠️ @${SALES()} ещё не нажал «Старт» у бота — заявки пока приходят сюда.</i>`, extra);
  return await tgAdmins();
}
const mainKb = async () => { const c = await cfg(); return { inline_keyboard: [[{ text: `💳 Купить доступ — ${c.price} ₽ / ${c.days} дн.`, callback_data: 'buy' }], [{ text: '🌐 Открыть сайт', url: SITE() }, { text: '✨ Что умеет Mundora', callback_data: 'about' }], [{ text: '🆘 Поддержка', callback_data: 'support' }]] }; };

// ---------- покупка ----------
async function buyStart(chat, from) {
  const c = await cfg();
  const rows = [];
  if (c.stars > 0) rows.push([{ text: `⭐ Оплатить ${c.stars} звёздами — сразу`, callback_data: 'stars' }]);
  if (c.details) rows.push([{ text: '✅ Я перевёл деньги', callback_data: 'paid' }]);
  else rows.push([{ text: '🙋 Хочу купить', callback_data: 'want' }]);
  rows.push([{ text: '✖️ Отмена', callback_data: 'cancel' }]);
  await say(chat, `💳 <b>Доступ к Mundora</b>\n\nЦена — <b>${c.price} ₽ за ${c.days} дней</b>.\nТы получишь код: на ${SITE()} вводишь его и создаёшь аккаунт. Когда срок закончится, сайт попросит новый код — данные сохранятся.\n\n` +
    (c.details ? `<b>Как оплатить:</b>\n${tgHtml(c.details)}\n\nПосле перевода нажми «Я перевёл деньги» и пришли скриншот или чек.` : 'Нажми «Хочу купить» — администратор пришлёт реквизиты в личку.') +
    (c.stars > 0 ? `\n\nИли оплати звёздами Telegram — код придёт сразу.` : ''), { reply_markup: { inline_keyboard: rows } });
}
async function issueCode(buyerChat, buyer, by) {
  const c = await cfg();
  const code = await createCode({ days: c.days, max: 1, note: 'Telegram ' + (uname(buyer) || buyerChat), tg: buyer && buyer.id ? buyer : null });
  await kv('INCR', 'tg:sold');
  await say(buyerChat, `🎉 <b>Оплата подтверждена!</b>\n\nТвой код доступа: <code>${code}</code>\nОн действует ${c.days} дней с момента ввода.\n\n<b>Дальше:</b>\n1. Открой ${SITE()}\n2. Введи код (можно вставить)\n3. Создай аккаунт — почта, пароль, имя\n\nТвой Telegram сам привяжется к профилю на сайте\n\nЕсли что-то не получится — просто напиши мне.`, { reply_markup: { inline_keyboard: [[{ text: '🌐 Открыть Mundora', url: SITE() }]] } });
  await kv('DEL', 'tg:st:' + buyerChat);
  return code;
}

// ---------- личка ----------
async function onPrivate(m) {
  const chat = m.chat.id, from = m.from, text = m.text || m.caption || '';
  const st = await jget('tg:st:' + chat);
  // запоминаем id продавца (@qlidw), чтобы слать ему заявки
  if (from.username && from.username.toLowerCase() === SALES()) {
    const was = await kv('GET', 'tg:un:' + SALES());
    if (+was !== from.id) { await kv('SET', 'tg:un:' + SALES(), String(from.id)); await say(chat, '✅ Готово: заявки на покупку доступа теперь будут приходить тебе сюда — с кнопками «Выдать код» и «Отклонить».'); }
  }
  // ник в Telegram поменялся — обновим в профиле Mundora
  try { const em = await kv('GET', 'tg:uid:' + from.id); if (em) { const u = await getUser(em); if (u && u.tg && ((u.tg.username || '') !== (from.username || '') || (u.tg.name || '') !== (from.first_name || ''))) await linkTg(em, from); } } catch (e) {}
  const start = cmd(text, 'start');
  if (start !== null) {
    if (start.startsWith('acc_')) {
      const email = await kv('GET', 'tg:acc:' + start.slice(4));
      if (!email) return say(chat, 'Ссылка устарела — нажми «Привязать Telegram» в профиле на сайте ещё раз.');
      await kv('DEL', 'tg:acc:' + start.slice(4));
      await linkTg(email, from); const u = await getUser(email);
      return say(chat, `✅ Telegram привязан к аккаунту Mundora <b>${tgHtml(u ? displayName(u) : '')}</b>${u && u.id != null ? ' (ID ' + u.id + ')' : ''}.\n\nТеперь в профиле на сайте видно твой Telegram${from.username ? ' — @' + tgHtml(from.username) : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🌐 Открыть Mundora', url: SITE() }]] } });
    }
    if (start.startsWith('link_')) {
      const email = await kv('GET', 'tg:link:' + start.slice(5));
      if (!email) return say(chat, 'Ссылка устарела — получи новую в админ-панели сайта.');
      await kvMulti([['SADD', 'tg:admins', String(from.id)], ['DEL', 'tg:link:' + start.slice(5)], ['HSET', 'tg:adminmap', String(from.id), email]]);
      return say(chat, `✅ Готово! Ты привязан как администратор Mundora (${tgHtml(email)}).\n\nСюда будут приходить заявки на покупку и жалобы.\nКоманды: /code — создать код, /stats — статистика.\nВ группе: /fill в теме — бот сам напишет и закрепит пост, /news текст — новость.`);
    }
    if (start === 'buy') return buyStart(chat, from);
    return say(chat, `👋 Привет${from.first_name ? ', ' + tgHtml(from.first_name) : ''}! Я <b>Mundora Bot</b>.\n\nMundora — музыка с умной «Волной», финансы, крипта в реальном времени, заметки и ИИ-помощник, который сам управляет сайтом. Один аккаунт на телефоне и ПК.\n\nСпроси меня о чём угодно про Mundora или купи доступ 👇`, { reply_markup: await mainKb() });
  }
  if (cmd(text, 'buy') !== null) return buyStart(chat, from);
  if (cmd(text, 'help') !== null && await isTgAdmin(from.id)) return say(chat, '<b>Команды администратора</b>\n/refill — заново заполнить все темы группы (или напиши «заполни темы»)\n/code [дней] [входов] — создать код\n/stats — статистика\n\nВ группе: /news текст — новость, /fill — пост в текущей теме.');
  if (cmd(text, 'help') !== null) return say(chat, 'Я отвечаю на вопросы о Mundora, продаю доступ (/buy) и принимаю жалобы и идеи — просто напиши.', { reply_markup: await mainKb() });
  if (cmd(text, 'support') !== null) return say(chat, '🆘 Напиши свой вопрос прямо сюда — передам администрации. Или почта: <b>mundoraaiapp@gmail.com</b>');
  if (await isTgAdmin(from.id)) {
    const cc = cmd(text, 'code');
    if (cc !== null) { const [d, u] = cc.split(/\s+/).map(Number); const c = await cfg(); const code = await createCode({ days: d >= 0 && cc ? d : c.days, max: u > 0 ? u : 1, note: 'выдан в Telegram' }); return say(chat, `Код: <code>${code}</code> — ${(d >= 0 && cc ? d : c.days) || 'навсегда'} дн., входов: ${u > 0 ? u : 1}`); }
    if (cmd(text, 'refill') !== null || cmd(text, 'fill_all') !== null || /^(refill|рефилл|заполни( все)?( темы)?|обнови темы)\.?$/i.test(text.trim())) {
      const g = await kv('GET', 'tg:group');
      if (!g) return say(chat, 'Я ещё не знаю твою группу. Добавь меня в группу Mundora администратором — я сам всё заполню.');
      return runFill(+g, chat);
    }
    if (cmd(text, 'stats') !== null) { const [users, codes, sold] = await kvMulti([['SCARD', 'users'], ['SCARD', 'codes'], ['GET', 'tg:sold']]); return say(chat, `📊 Аккаунтов: <b>${users}</b>\nКодов: <b>${codes}</b>\nПродано через бота: <b>${+sold || 0}</b>`); }
  }
  // ждём подтверждение оплаты
  if (st && st.s === 'proof') {
    const to = await notifySales(`💳 <b>Заявка на доступ</b>\nОт: ${userLink(from)} (id <code>${from.id}</code>)\nСумма: ${(await cfg()).price} ₽\n\nПодтверждение ниже 👇`), n = to.length;
    for (const id of to) { try { await tg('copyMessage', { chat_id: id, from_chat_id: chat, message_id: m.message_id, reply_markup: { inline_keyboard: [[{ text: '✅ Выдать код', callback_data: 'ok:' + chat }, { text: '❌ Отклонить', callback_data: 'no:' + chat }]] } }); } catch (e) {} }
    await jset('tg:st:' + chat, { s: 'wait', from: { id: from.id, username: from.username, first_name: from.first_name } }, 86400 * 3);
    return say(chat, n ? '📨 Отправил администратору. Как только он подтвердит — сразу пришлю код сюда.' : '📨 Заявку сохранил, администратор скоро ответит.');
  }
  // обычный разговор — ИИ
  if (!text) return;
  if (!(await limit('tgai:' + from.id, 40, 3600))) return say(chat, 'Давай чуть помедленнее 🙂 Попробуй через несколько минут.');
  await tg('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {});
  const hist = ((await jget('tg:h:' + chat)) || []).slice(-8);
  const ans = await ai([{ role: 'system', content: await persona() + '\n\nЕсли человек хочет купить доступ — скажи нажать /buy. Если пишет жалобу или баг — поблагодари и скажи, что передал администрации (добавь в самом конце скрытую метку [[ADMIN]]).' }, ...hist, { role: 'user', content: text }]);
  const flag = /\[\[ADMIN\]\]/.test(ans), out = ans.replace(/\[\[ADMIN\]\]/g, '').trim() || 'Сейчас не могу ответить — передал вопрос администрации. Почта поддержки: mundoraaiapp@gmail.com';
  if (flag || !ans) await notifyAdmins(`📩 <b>Сообщение боту</b> от ${userLink(from)}:\n\n${tgHtml(text).slice(0, 1500)}`);
  await jset('tg:h:' + chat, [...hist, { role: 'user', content: text.slice(0, 1500) }, { role: 'assistant', content: out.slice(0, 1500) }], 86400);
  return say(chat, out, /купить|доступ|\/buy/i.test(out) ? { reply_markup: { inline_keyboard: [[{ text: '💳 Купить доступ', callback_data: 'buy' }]] } } : {});
}

// ---------- кнопки ----------
async function onCallback(q) {
  const d = q.data || '', chat = q.message && q.message.chat.id, from = q.from;
  const ack = (text, alert) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: !!alert }).catch(() => {});
  if (d === 'buy') { await ack(); if (q.message.chat.type !== 'private') { const me = await ME(); return say(chat, 'Купить можно в личке с ботом 👇', { reply_markup: { inline_keyboard: [[{ text: '💳 Купить доступ', url: `https://t.me/${me.username}?start=buy` }]] }, message_thread_id: q.message.message_thread_id }); } return buyStart(chat, from); }
  if (d === 'about') { await ack(); return say(chat, (await persona()).split('Факты о Mundora:')[1].trim().replace(/^• /gm, '▫️ '), { reply_markup: { inline_keyboard: [[{ text: '💳 Купить доступ', callback_data: 'buy' }]] } }); }
  if (d === 'support') { await ack(); return say(chat, '🆘 Напиши сюда, что случилось — передам администрации. Или почта: <b>mundoraaiapp@gmail.com</b>'); }
  if (d === 'cancel') { await kv('DEL', 'tg:st:' + chat); await ack('Отменено'); return tg('deleteMessage', { chat_id: chat, message_id: q.message.message_id }).catch(() => {}); }
  if (d === 'paid') { await jset('tg:st:' + chat, { s: 'proof' }, 3600); await ack(); return say(chat, '📸 Пришли скриншот перевода или чек (можно текстом: время, сумма, последние цифры карты).'); }
  if (d === 'want') {
    await ack();
    const n = (await notifySales(`🙋 <b>Хочет купить доступ</b>: ${userLink(from)} (id <code>${from.id}</code>)\nНапиши ему реквизиты. Когда оплатит — нажми «Выдать код».`, { reply_markup: { inline_keyboard: [[{ text: '✅ Выдать код', callback_data: 'ok:' + chat }, { text: '❌ Отклонить', callback_data: 'no:' + chat }]] } })).length;
    await jset('tg:st:' + chat, { s: 'wait', from: { id: from.id, username: from.username, first_name: from.first_name } }, 86400 * 3);
    return say(chat, n ? '👌 Передал администратору — он скоро напишет тебе реквизиты. После оплаты код придёт сюда.' : '👌 Заявку сохранил — администратор скоро свяжется.');
  }
  if (d === 'stars') {
    const c = await cfg(); await ack();
    return tg('sendInvoice', { chat_id: chat, title: 'Доступ к Mundora', description: `Код доступа к сайту Mundora на ${c.days} дней`, payload: 'sub:' + c.days, currency: 'XTR', prices: [{ label: `${c.days} дней`, amount: c.stars }] });
  }
  const mm = d.match(/^(ok|no):(-?\d+)$/);
  if (mm) {
    if (!(await isTgAdmin(from.id)) && !(await isSales(from.id))) return ack('Только для администрации', true);
    const buyer = +mm[2], st = await jget('tg:st:' + buyer);
    if (!st || st.s !== 'wait') { await ack('Заявка уже обработана', true); return; }
    const by = uname(from);
    if (mm[1] === 'ok') {
      const code = await issueCode(buyer, st.from || { id: buyer }, by);
      await ack('Код отправлен: ' + code);
      await notifyAdmins(`✅ ${tgHtml(by)} выдал код <code>${code}</code> для ${userLink(st.from || { id: buyer })}`);
    } else {
      await kv('DEL', 'tg:st:' + buyer); await ack('Отклонено');
      await say(buyer, '😕 Администратор не смог подтвердить оплату. Если это ошибка — напиши сюда или на mundoraaiapp@gmail.com');
      await notifyAdmins(`❌ ${tgHtml(by)} отклонил заявку ${userLink(st.from || { id: buyer })}`);
    }
    try { await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
    return;
  }
  return ack();
}

// ---------- группа ----------
async function rememberTopic(m) {
  const t = m.forum_topic_created || (m.reply_to_message && m.reply_to_message.forum_topic_created);
  if (m.is_topic_message && m.message_thread_id && t && t.name) await kv('HSET', 'tg:topics:' + m.chat.id, t.name, m.message_thread_id);
  await kv('SET', 'tg:group', String(m.chat.id));
}
async function canAdmin(chat, uid) {
  if (await isTgAdmin(uid)) return true;
  try { const cm = await tg('getChatMember', { chat_id: chat, user_id: uid }); return cm.status === 'creator' || cm.status === 'administrator'; } catch (e) { return false; }
}
// Админы группы — те, у кого в группе статус администратора (с префиксом/должностью) или создатель. Список кешируем на 5 минут.
async function groupAdmins(chat) {
  const c = await kv('GET', 'tg:gadm:' + chat); if (c) { try { return JSON.parse(c); } catch (e) {} }
  const list = await tg('getChatAdministrators', { chat_id: chat }).catch(() => null);
  if (!list) return null;
  const ids = list.map(a => a.user && a.user.id).filter(Boolean);
  await kv('SET', 'tg:gadm:' + chat, JSON.stringify(ids), 'EX', 300); return ids;
}
// Темы только для чтения: писать могут лишь админы группы, остальное бот удаляет
const READONLY = ['access', 'trusted', 'news'];
async function guardReadonly(m, topicName) {
  if (!m.is_topic_message || !m.message_thread_id || !READONLY.includes(kindOf(topicName))) return false;
  if (m.forum_topic_created || m.forum_topic_edited || m.pinned_message || m.is_automatic_forward) return false; // служебные сообщения
  const chat = m.chat.id, from = m.from || {};
  if (m.sender_chat && m.sender_chat.id === chat) return false; // анонимный админ
  const me = await ME(); if (from.id === me.id) return false;
  const admins = await groupAdmins(chat);
  if (!admins || admins.includes(from.id)) return false; // не смогли узнать админов — ничего не удаляем
  try { await tg('deleteMessage', { chat_id: chat, message_id: m.message_id }); }
  catch (e) { if (await limit('tg:delwarn:' + chat, 1, 6 * 3600)) await notifyAdmins(`⚠️ Не могу удалить сообщение ${userLink(from)} в теме «${tgHtml(topicName)}» — дай боту в группе право «Удаление сообщений».`); }
  return true;
}
// Telegram не даёт ботам список тем. Ищем сами: тема = номер сообщения, которым её создали.
// Шлём «⏳» в тему N ответом на её первое сообщение — в ответе Telegram видно название темы; потом меняем «⏳» на готовый пост.
async function discoverTopics(chat) {
  const found = [];
  let last = 1;
  for (let start = 2; start <= 400; start += 15) {
    const ids = Array.from({ length: 15 }, (_, i) => start + i);
    const probe = async id => {
      for (let k = 0; k < 3; k++) {
        try { return { id, m: await tg('sendMessage', { chat_id: chat, message_thread_id: id, text: '⏳', disable_notification: true, reply_parameters: { message_id: id, allow_sending_without_reply: false } }) }; }
        catch (e) { const ra = e.tg && e.tg.parameters && e.tg.parameters.retry_after; if (!ra) return null; await new Promise(r => setTimeout(r, (ra + 0.5) * 1000)); }
      }
      return null;
    };
    const res = await Promise.all(ids.map(probe));
    await new Promise(r => setTimeout(r, 700)); // не частить, чтобы Telegram не ограничил
    for (const r of res) {
      if (!r) continue;
      const t = r.m.reply_to_message && r.m.reply_to_message.forum_topic_created;
      if (t && t.name) { found.push({ id: r.id, name: t.name, ph: r.m.message_id }); last = r.id; }
      else tg('deleteMessage', { chat_id: chat, message_id: r.m.message_id }).catch(() => {});
    }
    if (start > last + 45) break; // дальше тем нет
  }
  return found;
}
async function postTo(chat, thread, name, placeholder) {
  const kind = thread ? kindOf(name) : 'general';
  const me = await ME(), c = await cfg();
  const text = await topicPost(kind, name);
  const kb = kind === 'access' || kind === 'general' || kind === 'news' ? { inline_keyboard: [[{ text: `💳 Купить доступ — ${c.price} ₽`, url: `https://t.me/${me.username}?start=buy` }], [{ text: '🌐 Открыть сайт', url: SITE() }]] } : undefined;
  let id = placeholder;
  if (id) {
    try { await tg('editMessageText', { chat_id: chat, message_id: id, text: tgHtml(text), parse_mode: 'HTML', disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}) }); }
    catch (e) { await tg('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {}); id = 0; }
  }
  if (!id) id = (await say(chat, text, { ...(thread ? { message_thread_id: thread } : {}), ...(kb ? { reply_markup: kb } : {}) })).message_id;
  try { await tg('pinChatMessage', { chat_id: chat, message_id: id, disable_notification: true }); } catch (e) {}
  // старый пост бота в этой теме — убрать
  const old = await kv('HGET', 'tg:posts:' + chat, String(thread || 0));
  if (old && +old !== id) tg('deleteMessage', { chat_id: chat, message_id: +old }).catch(() => {});
  await kv('HSET', 'tg:posts:' + chat, String(thread || 0), id);
  return id;
}
async function fillAll(chat) {
  const topics = await discoverTopics(chat);
  for (const t of topics) await kv('HSET', 'tg:topics:' + chat, t.name, t.id);
  // тексты пишутся параллельно — так быстрее
  const res = await Promise.allSettled([postTo(chat, undefined, 'General'), ...topics.map(t => postTo(chat, t.id, t.name, t.ph))]);
  await kv('SET', 'tg:filled:' + chat, String(Date.now()));
  return { topics: ['General', ...topics.map(t => t.name)], failed: res.filter(r => r.status === 'rejected').length };
}
async function runFill(chat, reportTo) {
  if (reportTo) await say(reportTo, '⏳ Ищу темы в группе и пишу посты — это займёт до минуты…').catch(() => {});
  try {
    const r = await fillAll(chat);
    if (reportTo) await say(reportTo, `✅ Готово! Заполнил и закрепил: ${r.topics.map(tgHtml).join(', ')}.${r.failed ? `
Не вышло в ${r.failed} — проверь, что бот админ с правом закреплять сообщения.` : ''}`);
    return r;
  } catch (e) { if (reportTo) await say(reportTo, '❌ Не получилось: ' + tgHtml(e.message)); throw e; }
}

async function onGroup(m) {
  const chat = m.chat.id, from = m.from || {}, text = m.text || m.caption || '', thread = m.is_topic_message ? m.message_thread_id : undefined;
  await rememberTopic(m);
  let topicName = (m.reply_to_message && m.reply_to_message.forum_topic_created && m.reply_to_message.forum_topic_created.name) || '';
  if (!topicName && thread) { const mp = await kv('HGETALL', 'tg:topics:' + chat); for (let i = 0; i < mp.length; i += 2) if (+mp[i + 1] === thread) topicName = mp[i]; }
  const where = thread ? { message_thread_id: thread } : {};
  if (await guardReadonly(m, topicName)) return;
  if (m.new_chat_members) {
    const ppl = m.new_chat_members.filter(u => !u.is_bot); if (!ppl.length) return;
    const me = await ME();
    return say(chat, `👋 ${ppl.map(userLink).join(', ')}, добро пожаловать в <b>Mundora</b>!\nЗагляни в «Доступ к сайту», а вопросы задавай в «Вопросы, баги, предложения».`, { reply_markup: { inline_keyboard: [[{ text: '💳 Купить доступ', url: `https://t.me/${me.username}?start=buy` }]] } }).catch(() => {});
  }
  const c = anyCmd(text);
  const me = await ME();
  if (c && (!c.at || c.at.toLowerCase() === String(me.username).toLowerCase())) {
    if (['fill', 'fill_all', 'news'].includes(c.c)) {
      if (!(await canAdmin(chat, from.id))) return;
      tg('deleteMessage', { chat_id: chat, message_id: m.message_id }).catch(() => {});
      if (c.c === 'fill') return postTo(chat, thread, topicName);
      if (c.c === 'news') {
        const news = await ai([{ role: 'system', content: await persona() }, { role: 'user', content: `Оформи это как новость для темы «Новости» в Telegram (живо, с эмодзи, до 900 символов, Telegram HTML), ничего не выдумывай сверх текста:\n${c.arg}` }]);
        const map = await kv('HGETALL', 'tg:topics:' + chat); let nt; for (let i = 0; i < map.length; i += 2) if (kindOf(map[i]) === 'news') nt = +map[i + 1];
        return say(chat, news || c.arg, nt ? { message_thread_id: nt } : where);
      }
      if (c.c === 'fill_all') return runFill(chat, from.id);
    }
    if (c.c === 'buy') return say(chat, 'Купить доступ можно в личке с ботом 👇', { ...where, reply_markup: { inline_keyboard: [[{ text: '💳 Купить доступ', url: `https://t.me/${me.username}?start=buy` }]] } });
  }
  if (!text || from.is_bot) return;
  const kind = thread ? kindOf(topicName) : 'general';
  // жалобы — администрации
  if (kind === 'complaints' && !(await isTgAdmin(from.id))) {
    await notifyAdmins(`🚨 <b>Жалоба</b> от ${userLink(from)}:\n\n${tgHtml(text).slice(0, 1800)}`);
    for (const id of await tgAdmins()) { if (m.photo || m.document) { try { await tg('copyMessage', { chat_id: id, from_chat_id: chat, message_id: m.message_id }); } catch (e) {} } }
    return say(chat, '✅ Жалоба принята и передана администрации. Спасибо!', { ...where, reply_parameters: { message_id: m.message_id } });
  }
  // упомянули бота или ответили ему — отвечает ИИ
  const mentioned = text.toLowerCase().includes('@' + String(me.username).toLowerCase()) || (m.reply_to_message && m.reply_to_message.from && m.reply_to_message.from.id === me.id);
  if (!mentioned) return;
  if (!(await limit('tgg:' + from.id, 20, 3600))) return;
  await tg('sendChatAction', { chat_id: chat, action: 'typing', ...where }).catch(() => {});
  const ctx = m.reply_to_message && m.reply_to_message.text ? [{ role: 'assistant', content: m.reply_to_message.text.slice(0, 1200) }] : [];
  const ans = await ai([{ role: 'system', content: await persona() + `\n\nТы отвечаешь в группе Mundora, в теме «${topicName || 'General'}». Отвечай коротко (до 600 символов). Если это баг или предложение — поблагодари и скажи, что передал администрации, и добавь в конце метку [[ADMIN]].` }, ...ctx, { role: 'user', content: text.replace(new RegExp('@' + me.username, 'ig'), '').trim() }]);
  if (/\[\[ADMIN\]\]/.test(ans)) await notifyAdmins(`📌 <b>${tgHtml(topicName || 'Группа')}</b> — ${userLink(from)}:\n\n${tgHtml(text).slice(0, 1500)}`);
  return say(chat, ans.replace(/\[\[ADMIN\]\]/g, '').trim() || 'Сейчас не могу ответить — передал администрации 🙏', { ...where, reply_parameters: { message_id: m.message_id } });
}

// ---------- настройка из админ-панели сайта ----------
async function siteAdmin(req, a) {
  const g = await guard(req, true); if (g.res) return g.res;
  if (!g.user.owner) return json({ error: 'Только для владельца' }, 403);
  if (!TOKEN()) return json({ error: 'Нет TELEGRAM_BOT_TOKEN в Vercel → Environment Variables (после добавления — Redeploy)', noToken: true }, 400);
  if (a === 'status') {
    let me = null, wh = null; try { me = await tg('getMe'); await jset('tg:me', me); wh = await tg('getWebhookInfo'); } catch (e) { return json({ error: e.message }, 502); }
    const [admins, sold, group] = await kvMulti([['SCARD', 'tg:admins'], ['GET', 'tg:sold'], ['GET', 'tg:group']]);
    return json({ bot: { username: me.username, name: me.first_name }, connected: !!(wh && wh.url && wh.url.endsWith('/api/tg')), webhook: wh && wh.url, lastError: wh && wh.last_error_message, pending: wh && wh.pending_update_count, admins, sold: +sold || 0, group: !!group, cfg: await cfg() });
  }
  if (a === 'setup') {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
    const url = `https://${host}/api/tg`;
    await tg('setWebhook', { url, secret_token: await secretToken(), allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'my_chat_member'], drop_pending_updates: true });
    const c = await cfg();
    const steps = [
      tg('setMyName', { name: 'Mundora' }),
      tg('setMyShortDescription', { short_description: `Mundora — музыка, финансы, крипта и ИИ в одном месте. Доступ — ${c.price} ₽ / ${c.days} дней.` }),
      tg('setMyDescription', { description: `👋 Я — Mundora Bot.\n\nMundora — сайт «всё в одном»: музыка с умной «Волной» под твой вкус, доходы и расходы, калькуляторы, крипта в реальном времени, заметки и ИИ-помощник, который сам управляет сайтом.\n\n💳 Доступ — ${c.price} ₽ за ${c.days} дней. Нажми «Старт», чтобы купить или задать вопрос.` }),
      tg('setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }, { command: 'buy', description: 'Купить доступ' }, { command: 'help', description: 'Что умеет бот' }, { command: 'support', description: 'Поддержка' }, { command: 'refill', description: 'Админ: заполнить все темы группы' }], scope: { type: 'all_private_chats' } }),
      tg('setMyCommands', { commands: [{ command: 'fill', description: 'Бот напишет и закрепит пост в этой теме' }, { command: 'fill_all', description: 'Заполнить все известные темы' }, { command: 'news', description: 'Опубликовать новость: /news текст' }, { command: 'buy', description: 'Купить доступ' }], scope: { type: 'all_chat_administrators' } })
    ];
    const res = await Promise.allSettled(steps);
    const me = await tg('getMe'); await jset('tg:me', me);
    return json({ ok: true, username: me.username, url, warnings: res.filter(r => r.status === 'rejected').map(r => r.reason.message) });
  }
  if (a === 'fill') {
    const gid = await kv('GET', 'tg:group');
    if (!gid) return json({ error: 'Бот ещё не знает группу: добавь его в группу Mundora администратором' }, 400);
    const admins = await tgAdmins();
    const r = await runFill(+gid, admins[0]);
    return json({ ok: true, ...r });
  }
  if (a === 'link') { const t = rand(12); await kv('SET', 'tg:link:' + t, g.user.email, 'EX', 900); const me = await ME(); return json({ url: `https://t.me/${me.username}?start=link_${t}` }); }
  if (a === 'cfg') {
    const b = await req.json().catch(() => ({}));
    const c = { ...DEF_CFG, ...((await jget('tg:cfg')) || {}) };
    if (b.price != null) c.price = Math.max(0, Math.min(100000, +b.price || 0));
    if (b.days != null) c.days = Math.max(1, Math.min(3650, parseInt(b.days, 10) || 30));
    if (b.details != null) c.details = String(b.details).slice(0, 600);
    if (b.stars != null) c.stars = Math.max(0, Math.min(100000, parseInt(b.stars, 10) || 0));
    await jset('tg:cfg', c); return json({ ok: true, cfg: c });
  }
  return json({ error: 'unknown' }, 404);
}

export async function handler(req) {
  const url = new URL(req.url), a = url.searchParams.get('a');
  if (!dbReady()) return json({ error: 'База не подключена' }, 503);
  if (a) { try { return await siteAdmin(req, a); } catch (e) { return json({ error: e.message }, 500); } }
  if (req.method !== 'POST') return json({ ok: true, bot: 'Mundora' });
  if (!TOKEN() || req.headers.get('x-telegram-bot-api-secret-token') !== await secretToken()) return json({ error: 'forbidden' }, 403);
  const u = await req.json().catch(() => null); if (!u) return json({ ok: true });
  // Telegram может прислать то же событие повторно — обрабатываем один раз
  if ((await kv('SET', 'tg:upd:' + u.update_id, '1', 'NX', 'EX', 3600)) !== 'OK') return json({ ok: true });
  try {
    if (u.my_chat_member) {
      const mc = u.my_chat_member, ch = mc.chat, now = mc.new_chat_member && mc.new_chat_member.status;
      if (ch.type === 'supergroup' && (now === 'administrator')) {
        await kv('DEL', 'tg:gadm:' + ch.id);
        await kv('SET', 'tg:group', String(ch.id));
        const admins = await tgAdmins();
        if (ch.is_forum && (await kv('SET', 'tg:filled:' + ch.id, 'auto', 'NX')) === 'OK') await runFill(ch.id, admins[0] || mc.from.id).catch(() => {});
        else await notifyAdmins(`🤖 Я админ в группе <b>${tgHtml(ch.title || '')}</b>. Заполнить темы заново — /refill`);
      } else if (ch.type === 'supergroup' && (now === 'member')) {
        await kv('SET', 'tg:group', String(ch.id));
        await notifyAdmins(`🤖 Меня добавили в <b>${tgHtml(ch.title || '')}</b>, но не админом. Сделай меня администратором (закреплять и удалять сообщения, управлять темами) — и я сам заполню все темы.`);
      }
    }
    else if (u.callback_query) await onCallback(u.callback_query);
    else if (u.pre_checkout_query) await tg('answerPreCheckoutQuery', { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
    else if (u.message) {
      const m = u.message;
      if (m.successful_payment) { const code = await issueCode(m.chat.id, m.from); await notifyAdmins(`⭐ Оплата звёздами (${m.successful_payment.total_amount}) от ${userLink(m.from)} — код <code>${code}</code>`); }
      else if (m.chat.type === 'private') await onPrivate(m);
      else if (m.chat.type === 'supergroup' || m.chat.type === 'group') await onGroup(m);
    }
  } catch (e) { console.error('tg', e.message); }
  return json({ ok: true });
}
export const GET = handler, POST = handler;
