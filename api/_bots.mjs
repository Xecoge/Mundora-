// Боты Mundora: конструктор (как BotFather в Telegram) и HTTP API по токену.
// Бот — это аккаунт с полем bot { uname, owner, about, cmds }; почта служебная (…@bots.mundora), войти по ней нельзя.
import { kv, kvMulti, jget, jset } from './_store.mjs';
import { getUser, putUser, rand, ensureId } from './_auth.mjs';

export const BOT_DOM = '@bots.mundora';
export const isBotEmail = e => String(e || '').endsWith(BOT_DOM);
export const BF_UNAME = 'BotFather';
const SITE = 'https://mundorai.vercel.app';
const MAXBOTS = 20;
const unameOk = u => /^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(u) && /bot$/i.test(u) && u.length >= 5;
const newToken = id => id + ':' + rand(26).replace(/[-_]/g, 'x').slice(0, 35);

export async function botById(id) { const e = await kv('GET', 'id:' + id); return isBotEmail(e) ? getUser(e) : null; }
export async function botByUname(n) { const id = await kv('GET', 'bu:' + String(n || '').replace(/^@/, '').toLowerCase()); return id ? botById(id) : null; }
export async function botByToken(t) { t = String(t || ''); const id = /^\d{1,12}:[\w]{20,40}$/.test(t) ? await kv('GET', 'bt:' + t) : null; return id && t.startsWith(id + ':') ? botById(id) : null; }

async function makeBot({ name, uname, owner, verified, avatar }) {
  const u = { email: 'b' + rand(9).replace(/[-_]/g, 'x').toLowerCase() + BOT_DOM, name, created: Date.now(), status: 'active', avatar: avatar || 'chat',
    bot: { uname, owner: String(owner), about: '', desc: '', cmds: [] }, ...(verified ? { verified: true } : {}) };
  await ensureId(u);
  const tok = newToken(u.id); u.bot.tok = tok;
  await putUser(u);
  await kvMulti([['SET', 'bu:' + uname.toLowerCase(), String(u.id)], ['SET', 'bt:' + tok, String(u.id)], ['SADD', 'users', u.email], ['SADD', 'bots:' + owner, String(u.id)]]);
  return u;
}

// Конструктор ботов — системный бот с галочкой; создаётся сам при первом обращении
export async function botFatherId() {
  let id = await kv('GET', 'bu:' + BF_UNAME.toLowerCase());
  if (id && (await botById(id))) return String(id);
  const u = await makeBot({ name: 'BotFather', uname: BF_UNAME, owner: 'system', verified: true, avatar: 'code' });
  u.bot.about = 'Создаёт ботов Mundora и выдаёт токены. Напиши /newbot'; u.bot.cmds = [['newbot', 'Создать бота'], ['mybots', 'Мои боты'], ['setname', 'Сменить имя'], ['setdescription', 'Изменить описание'], ['setcommands', 'Задать команды'], ['token', 'Показать токен'], ['revoke', 'Новый токен'], ['deletebot', 'Удалить бота'], ['help', 'Помощь'], ['cancel', 'Отменить']].map(([c, d]) => ({ c, d })); u.bio = 'Официальный конструктор ботов Mundora'; await putUser(u);
  return String(u.id);
}

const myBots = async me => { const ids = (await kv('SMEMBERS', 'bots:' + me)) || []; const L = (await Promise.all(ids.map(botById))).filter(b => b && String(b.bot.owner) === String(me)); return L.sort((a, b) => a.created - b.created); };
const HELP = `Я помогу создать ботов Mundora и управлять ими.

Боты
/newbot — создать бота
/mybots — мои боты

Настройки
/setname — имя
/setdescription — описание (видно в профиле бота)
/setcommands — список команд
/token — показать токен
/revoke — выпустить новый токен
/deletebot — удалить бота

/cancel — отменить текущее действие`;
const apiDoc = tok => `Токен для HTTP API:
${tok}

Храни его в секрете — с ним кто угодно сможет управлять ботом.

Как пользоваться (как Bot API в Telegram):
${SITE}/bot${tok}/getMe
${SITE}/bot${tok}/getUpdates?timeout=25
${SITE}/bot${tok}/sendMessage?chat_id=ID&text=Привет`;
const pick = (L, verb) => L.length ? `Выбери бота, чтобы ${verb}: пришли его юзернейм.\n\n` + L.map(b => '@' + b.bot.uname).join('\n') : 'У тебя пока нет ботов. Создай: /newbot';

// Ответ конструктора на сообщение пользователя me. Возвращает текст ответа.
export async function botFatherReply(me, text) {
  const x = String(text || '').trim(), K = 'bfs:' + me;
  const st = (await jget(K)) || {};
  const done = async msg => { await kv('DEL', K); return msg; };
  const ask = async (s, msg) => { await jset(K, s, 3600); return msg; };
  const cmd = x.startsWith('/') ? x.split(/[\s@]/)[0].toLowerCase() : '';
  if (cmd === '/start' || cmd === '/help') return done(HELP);
  if (cmd === '/cancel') return done(st.cmd ? 'Отменено. Что дальше? /help' : 'Нечего отменять. /help');
  if (cmd === '/mybots') { const L = await myBots(me); return done(L.length ? 'Твои боты:\n\n' + L.map(b => `${b.name} — @${b.bot.uname}`).join('\n') + '\n\nНастройки: /setname, /setdescription, /setcommands, /token' : 'Ботов пока нет. Создай первого: /newbot'); }
  if (cmd === '/newbot') {
    if ((await myBots(me)).length >= MAXBOTS) return done(`Можно создать не больше ${MAXBOTS} ботов.`);
    return ask({ cmd: 'newbot', step: 'name' }, 'Хорошо, новый бот. Как его назовём? Пришли имя — его будут видеть в чатах.');
  }
  if (['/setname', '/setdescription', '/setabouttext', '/setcommands', '/token', '/revoke', '/deletebot'].includes(cmd)) {
    const L = await myBots(me), verb = { '/setname': 'сменить имя', '/setdescription': 'изменить описание', '/setabouttext': 'изменить описание', '/setcommands': 'задать команды', '/token': 'показать токен', '/revoke': 'выпустить новый токен', '/deletebot': 'удалить его' }[cmd];
    if (!L.length) return done('У тебя пока нет ботов. Создай: /newbot');
    return ask({ cmd: cmd.slice(1).replace('setabouttext', 'setdescription'), step: 'bot' }, pick(L, verb));
  }
  if (cmd) return done('Не знаю такой команды. Список: /help');

  // шаги диалога
  if (st.cmd === 'newbot' && st.step === 'name') {
    const name = x.replace(/[\u0000-\u001f]/g, '').slice(0, 64).trim(); if (!name) return 'Пришли имя бота текстом.';
    return ask({ cmd: 'newbot', step: 'uname', name }, `Отлично: «${name}». Теперь юзернейм — по нему бота найдут в поиске.\n\nОн должен заканчиваться на «bot», например tetris_bot или TetrisBot. Латиница, цифры и _, от 5 до 30 символов.`);
  }
  if (st.cmd === 'newbot' && st.step === 'uname') {
    const un = x.replace(/^@/, '');
    if (!/bot$/i.test(un)) return 'Юзернейм должен заканчиваться на «bot». Например: ' + (un.replace(/[^A-Za-z0-9_]/g, '') || 'my') + '_bot';
    if (!unameOk(un)) return 'Так нельзя: только латиница, цифры и _, начинается с буквы, от 5 до 30 символов. Попробуй ещё раз.';
    if (await kv('GET', 'bu:' + un.toLowerCase())) return `@${un} уже занят. Придумай другой.`;
    const b = await makeBot({ name: st.name, uname: un, owner: me });
    await kv('DEL', K);
    return `Готово! Бот ${st.name} создан: @${un}\n\nНапиши ему — он появится в чатах.\n\n` + apiDoc(b.bot.tok) + '\n\nОписание и команды: /setdescription, /setcommands';
  }
  if (st.step === 'bot') {
    const b = await botByUname(x); if (!b || String(b.bot.owner) !== String(me)) return 'Не нашёл такого бота среди твоих. Пришли юзернейм из списка или /cancel.';
    if (st.cmd === 'token') return done(`Токен @${b.bot.uname}:\n${b.bot.tok}`);
    if (st.cmd === 'revoke') { const old = b.bot.tok; b.bot.tok = newToken(b.id); await putUser(b); await kvMulti([['DEL', 'bt:' + old], ['SET', 'bt:' + b.bot.tok, String(b.id)]]); return done(`Старый токен больше не работает. Новый токен @${b.bot.uname}:\n${b.bot.tok}`); }
    if (st.cmd === 'deletebot') return ask({ cmd: 'deletebot', step: 'confirm', id: b.id }, `Точно удалить @${b.bot.uname}? Это нельзя отменить. Напиши «Да, удалить».`);
    const q = { setname: 'Пришли новое имя бота.', setdescription: 'Пришли описание — его увидят в профиле бота (до 300 символов).', setcommands: 'Пришли список команд, каждая с новой строки:\n\nstart - Начать\nhelp - Помощь' }[st.cmd];
    return ask({ cmd: st.cmd, step: 'val', id: b.id }, q);
  }
  if (st.step === 'val' || st.step === 'confirm') {
    const b = await botById(st.id); if (!b || String(b.bot.owner) !== String(me)) return done('Бот не найден.');
    if (st.cmd === 'setname') { const n = x.slice(0, 64).trim(); if (!n) return 'Пришли имя текстом.'; b.name = n; await putUser(b); return done(`Готово, теперь бот называется «${n}».`); }
    if (st.cmd === 'setdescription') { b.bot.about = x.slice(0, 300); b.bio = b.bot.about; await putUser(b); return done('Описание обновлено.'); }
    if (st.cmd === 'setcommands') {
      const cmds = x.split('\n').map(l => l.trim().replace(/^\//, '')).filter(Boolean).map(l => { const m = l.match(/^([a-z0-9_]{1,32})\s*[-—–]\s*(.{1,256})$/i); return m ? { c: m[1].toLowerCase(), d: m[2].trim() } : null; });
      if (!cmds.length || cmds.some(c => !c)) return 'Не понял формат. Каждая строка: команда - описание. Например:\nstart - Начать';
      b.bot.cmds = cmds.slice(0, 50); await putUser(b); return done(`Команды @${b.bot.uname} сохранены: ` + b.bot.cmds.map(c => '/' + c.c).join(', '));
    }
    if (st.cmd === 'deletebot') {
      if (!/^да,?\s*удалить$/i.test(x)) return done('Не удалил. Если передумаешь — /deletebot');
      await kvMulti([['DEL', 'bu:' + b.bot.uname.toLowerCase()], ['DEL', 'bt:' + b.bot.tok], ['SREM', 'bots:' + me, String(b.id)], ['SREM', 'users', b.email]]);
      b.status = 'deleted'; b.name = 'Удалённый бот'; delete b.bot.tok; await putUser(b);
      return done(`Бот @${b.bot.uname} удалён.`);
    }
  }
  return HELP;
}

// очередь обновлений для бота (getUpdates)
export async function botEnqueue(botId, upd) {
  const n = await kv('INCR', 'bqn:' + botId);
  await kvMulti([['RPUSH', 'bq:' + botId, JSON.stringify({ update_id: +n, ...upd })], ['LTRIM', 'bq:' + botId, '-500', '-1']]);
}
export async function botUpdates(botId, offset, limit) {
  const raw = (await kv('LRANGE', 'bq:' + botId, '0', '-1')) || [];
  const L = raw.map(r => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
  if (offset) { const drop = L.filter(u => u.update_id < offset).length; if (drop) await kv('LTRIM', 'bq:' + botId, String(drop), '-1'); }
  return L.filter(u => !offset || u.update_id >= offset).slice(0, limit);
}
