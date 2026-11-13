// Собирает страницы для Vercel: src/app.html → api/_page.mjs, src/gate.html → api/_gate.mjs.
// Запускай после каждого изменения в src/:  node build.mjs
// (Папка src не публикуется — см. .vercelignore — поэтому сайт без входа не скачать.)
import fs from 'node:fs';
const out = (src, dst) => { const html = fs.readFileSync(new URL(src, import.meta.url), 'utf8'); fs.writeFileSync(new URL(dst, import.meta.url), '// Сгенерировано build.mjs из ' + src + ' — не редактировать вручную\nexport default ' + JSON.stringify(html) + ';\n'); return html.length; };
console.log('app', out('./src/app.html', './api/_page.mjs'), 'gate', out('./src/gate.html', './api/_gate.mjs'));
