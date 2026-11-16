// Собирает страницы для Vercel: src/app.html → api/_page.mjs (+ api/_asset.mjs), src/gate.html → api/_gate.mjs.
// Запускай после каждого изменения в src/:  node build.mjs
// (Папка src не публикуется — см. .vercelignore — поэтому сайт без входа не скачать.)
// Скрипт и стили сайта отдаются отдельно через /api/asset (только вошедшим) и кэшируются браузером навсегда —
// поэтому при каждом входе качается только маленькая страница, а не ~1 МБ.
import fs from 'node:fs';
import crypto from 'node:crypto';
const read = src => fs.readFileSync(new URL(src, import.meta.url), 'utf8');
const mod = (dst, obj, from) => fs.writeFileSync(new URL(dst, import.meta.url), '// Сгенерировано build.mjs из ' + from + ' — не редактировать вручную\nexport default ' + JSON.stringify(obj) + ';\n');
let app = read('./src/app.html');
const sm = app.match(/<style>([\s\S]*?)<\/style>/), jm = app.match(/<script>([\s\S]*?)<\/script>/);
const css = sm[1], js = jm[1];
const hash = crypto.createHash('sha256').update(css + js).digest('hex').slice(0, 12);
app = app.replace(sm[0], `<link rel="preload" href="/api/asset?f=js&v=${hash}" as="script"><link rel="stylesheet" href="/api/asset?f=css&v=${hash}">`)
         .replace(jm[0], `<script src="/api/asset?f=js&v=${hash}"></script>`);
mod('./api/_page.mjs', app, 'src/app.html');
mod('./api/_asset.mjs', { hash, css, js }, 'src/app.html');
const gate = read('./src/gate.html'); mod('./api/_gate.mjs', gate, 'src/gate.html');
console.log('app', app.length, 'css', css.length, 'js', js.length, 'v', hash, 'gate', gate.length);
