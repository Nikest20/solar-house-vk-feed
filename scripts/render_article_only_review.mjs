// Review only: rebuild the four-post static-article plan from existing assets.
// Never changes queue/, videos-queue/ or stories-queue/ or contacts VK.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectArticleOnlyDrafts } from '../src/article-only-plan-lib.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'drafts/2026-11-20_26-articles-only.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(root, plan.source_file), 'utf8'));
const items = selectArticleOnlyDrafts(source, plan);
const out = path.join(root, 'review/week-2026-11-20_26');
const images = new Map([
  ['2026-11-20', '2026-11-20-family-home.jpg'],
  ['2026-11-22', '2026-11-22-vapor-barrier.jpg'],
  ['2026-11-24', '2026-11-24-wood-fibreboard.jpg'],
  ['2026-11-26', '2026-11-26-base-options.jpg'],
]);
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lines = [
  '# Solar House — статьи на согласование, 20–26 ноября 2026', '',
  '**Четыре поста с иллюстрациями. Клипов и автоматических историй нет.**', '',
  '**СТАТУС: ЖДЁМ СОГЛАСОВАНИЯ. Ничего не поставлено в очередь.**', '',
  '| Дата (10:00 МСК) | Статья | Иллюстрация |', '|---|---|---|',
  ...items.map(i => `| ${i.date} | ${i.title} | [Открыть](${images.get(i.date)}) |`), '',
];
for (const item of items) {
  const image = images.get(item.date);
  if (!fs.existsSync(path.join(out, image))) throw new Error(`Missing reviewed image: ${image}`);
  lines.push(`## ${item.date} — ${item.title}`, '', item.text, '',
    `![Иллюстрация: ${item.title}](${image})`, '', `*${item.disclosure}*`, '', '---', '');
}
fs.writeFileSync(path.join(out, 'articles-only.md'), `${lines.join('\n')}\n`, 'utf8');

const cards = items.map(item => `<article class="card"><div class="date">${escape(item.date)} · 10:00 МСК · ожидает согласования</div>` +
  `<h2>${escape(item.title)}</h2><div class="layout"><figure><img src="${images.get(item.date)}" alt="Иллюстрация: ${escape(item.title)}"/>` +
  `<figcaption>${escape(item.disclosure)}</figcaption></figure><div class="post">${escape(item.text)}</div></div></article>`).join('');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
  `<title>Solar House · четыре статьи 20–26 ноября</title><style>*{box-sizing:border-box}body{margin:0;background:#eeeae4;color:#1b1b1b;font:16px/1.55 system-ui,Arial,sans-serif}` +
  `header{background:#191919;color:white;padding:40px max(24px,6vw)}header strong{color:#f4c643}header h1{font-size:clamp(29px,4vw,50px);line-height:1.2}` +
  `main{max-width:1280px;margin:30px auto;padding:0 20px}.card{background:#fff;border-radius:20px;margin:0 0 28px;padding:28px;box-shadow:0 8px 25px #0001}` +
  `.date{font-weight:700;color:#785b11}.card h2{font-size:27px}.layout{display:grid;grid-template-columns:minmax(300px,49%) 1fr;gap:25px}` +
  `figure{margin:0}figure img{display:block;width:100%;border-radius:12px}figcaption{font-size:13px;color:#666;margin-top:10px}` +
  `.post{white-space:pre-wrap;font-size:16px}@media(max-width:870px){.layout{grid-template-columns:1fr}.card{padding:18px}}</style></head>` +
  `<body><header><strong>SOLAR HOUSE · ПЛАН ПУБЛИКАЦИЙ</strong><h1>Только статьи с иллюстрациями</h1>` +
  `<p>20, 22, 24 и 26 ноября · 10:00 МСК · 4 статьи · 0 клипов · 0 историй</p>` +
  `<p>⚠ На согласовании: публикация не включена.</p></header><main>${cards}</main></body></html>`;
fs.writeFileSync(path.join(out, 'articles-only.html'), html, 'utf8');
console.log('REVIEW ONLY: four article previews created; no queue or VK changes.');
