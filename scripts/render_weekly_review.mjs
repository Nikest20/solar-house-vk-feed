// Build PREVIEW-ONLY content for Solar House's 20–26 Nov editorial review.
// Never writes queue/, videos-queue/, stories-queue/ or sends VK requests.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEEK = JSON.parse(fs.readFileSync(path.join(ROOT, 'drafts/2026-11-20_26-weekly.json'), 'utf8'));
const OUT = path.join(ROOT, 'review/week-2026-11-20_26');
const TMP = path.join(OUT, '_render_tmp');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_ITALIC = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const illustrations = {
  '2026-11-20': 'source-2026-11-20.jpg',
  '2026-11-21': 'source-2026-11-21.jpg',
  '2026-11-22': 'source-2026-11-22.jpg',
  '2026-11-23': 'source-2026-11-23.jpg',
  '2026-11-24': 'source-2026-11-24.jpg',
  '2026-11-25': 'source-2026-11-25.jpg',
};

function ffmpeg(...args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}
function img(file) { return path.join(OUT, file); }
function textfile(name, value) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, value, 'utf8');
  return p;
}
function wordWrap(text, max = 20) {
  const lines = [];
  let line = '';
  for (const word of text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
function imageSize(file) {
  const value = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', file], { encoding: 'utf8' }).trim();
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}

if (WEEK.review_status !== 'needs_approval' || WEEK.publication_enabled !== false)
  throw new Error('Refusing to render publication queue; this script handles pending-review content only');
if (WEEK.items.length !== 7 || WEEK.items.some(i => i.status !== 'needs_approval'))
  throw new Error('Expected exactly 7 non-approved editorial drafts');
if (!fs.existsSync(FONT)) throw new Error('DejaVu Sans font unavailable');
fs.mkdirSync(TMP, { recursive: true });
const outputs = [];

for (const item of WEEK.items) {
  let source;
  if (item.date === '2026-11-26') {
    source = path.join(OUT, `${item.date}-base-options.jpg`);
    execFileSync('inkscape', [path.join(ROOT, 'review/base-options-2026-11-26.svg'),
      '--export-filename=' + path.join(OUT, `${item.date}-base-options.png`)], { stdio: 'inherit' });
    ffmpeg('-i', path.join(OUT, `${item.date}-base-options.png`), '-frames:v', '1', '-q:v', '3', source);
    outputs.push(source);
  } else {
    source = img(illustrations[item.date]);
    if (!fs.existsSync(source)) throw new Error(`Missing source illustration: ${source}`);
  }

  if (item.format === 'image_post' && item.date !== '2026-11-26') {
    const dest = path.join(OUT, `${item.date}-${item.id.split('-').slice(2, -1).join('-')}.jpg`);
    const filter = `scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,` +
      `drawbox=x=0:y=1263:w=iw:h=87:color=black@0.44:t=fill,` +
      `drawtext=fontfile=${FONT}:text='SOLAR HOUSE':x=43:y=1283:fontsize=31:fontcolor=white,` +
      `drawtext=fontfile=${FONT_ITALIC}:text='Визуализация':x=w-text_w-43:y=1286:fontsize=28:fontcolor=white`;
    ffmpeg('-i', source, '-vf', filter, '-frames:v', '1', '-q:v', '3', dest);
    outputs.push(dest);
  }

  if (item.format === 'clip') {
    const { width, height } = imageSize(source);
    if (item.scenes.length !== 3 || item.scenes.reduce((n, s) => n + s.seconds, 0) !== item.duration_seconds)
      throw new Error(`Bad timing: ${item.id}`);
    const panelWidth = Math.floor(width / 3);
    const filterParts = [];
    const ffArgs = [];
    item.scenes.forEach((scene, index) => {
      ffArgs.push('-loop', '1', '-framerate', '25', '-t', String(scene.seconds), '-i', source);
      const top = textfile(`${item.date}-s${index + 1}.txt`, wordWrap(scene.overlay, 20));
      const x = panelWidth * index;
      filterParts.push(`[${index}:v]crop=${panelWidth}:${height}:${x}:0,` +
        `scale=810:1440:force_original_aspect_ratio=increase,crop=810:1440,` +
        `zoompan=z='min(zoom+0.00045,1.08)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25,` +
        `drawbox=x=0:y=35:w=iw:h=285:color=black@0.55:t=fill,` +
        `drawtext=fontfile=${FONT}:textfile=${top}:x=(w-text_w)/2:y=104:fontsize=45:line_spacing=9:fontcolor=white:borderw=2:bordercolor=black@0.6,` +
        `drawbox=x=0:y=h-85:w=iw:h=85:color=black@0.5:t=fill,` +
        `drawtext=fontfile=${FONT}:text='SOLAR HOUSE':x=36:y=h-61:fontsize=29:fontcolor=0xffd049,` +
        `drawtext=fontfile=${FONT_ITALIC}:text='Визуализация':x=w-text_w-34:y=h-57:fontsize=20:fontcolor=white,` +
        `trim=duration=${scene.seconds},setpts=PTS-STARTPTS,setsar=1[v${index}]`);
    });
    filterParts.push(`[v0][v1][v2]concat=n=3:v=1:a=0[outv]`);
    const dest = path.join(OUT, `${item.date}-clip-preview.mp4`);
    ffmpeg(...ffArgs, '-filter_complex', filterParts.join(';'), '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an', dest);
    outputs.push(dest);
  }

  const story = path.join(OUT, `${item.date}-story.jpg`);
  const storyTop = textfile(`${item.date}-story.txt`, wordWrap(item.story_text.replace(/\n/g, ' '), 25));
  const inFile = item.date === '2026-11-26' ? source : img(illustrations[item.date]);
  let layout = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
  if (item.format === 'clip') {
    const { width, height } = imageSize(inFile);
    const pw = Math.floor(width / 3);
    layout = `crop=${pw}:${height}:${pw}:0,${layout}`;
  }
  const f = `${layout},drawbox=x=0:y=0:w=iw:h=575:color=black@0.57:t=fill,` +
    `drawtext=fontfile=${FONT}:text='SOLAR HOUSE':x=80:y=115:fontsize=49:fontcolor=0xffd049,` +
    `drawtext=fontfile=${FONT}:textfile=${storyTop}:x=75:y=258:fontsize=49:line_spacing=16:fontcolor=white:borderw=2:bordercolor=black@0.7,` +
    `drawbox=x=0:y=1840:w=iw:h=80:color=black@0.6:t=fill,` +
    `drawtext=fontfile=${FONT_ITALIC}:text='Визуализация · Solar House':x=(w-text_w)/2:y=1864:fontsize=29:fontcolor=white`;
  ffmpeg('-i', inFile, '-vf', f, '-frames:v', '1', '-q:v', '3', story);
  outputs.push(story);
  console.log(`${item.date}: ${item.title} — review assets rendered`);
}

const manifest = {
  week_id: WEEK.week_id,
  review_status: WEEK.review_status,
  publication_enabled: false,
  generated_at: new Date().toISOString(),
  outputs: outputs.map(file => ({ file: path.relative(ROOT, file), bytes: fs.statSync(file).size })),
};
fs.writeFileSync(path.join(OUT, 'preview-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const mediaName = item => item.format === 'clip'
  ? `${item.date}-clip-preview.mp4`
  : item.date === '2026-11-26'
    ? `${item.date}-base-options.jpg`
    : `${item.date}-${item.id.split('-').slice(2, -1).join('-')}.jpg`;
const reviewMd = [
  `# Solar House — на согласование: 20–26 ноября 2026`,
  '',
  `**СТАТУС: НЕ СОГЛАСОВАНО — ничего из этого пакета не публикуется.**`,
  '',
  `Семь публикаций на 10:00 МСК и семь анонсов-историй на 10:15 МСК. Иллюстрации и ролики созданы в качестве превью; музыку и финальные настройки клипов утвердим отдельно.`,
  '',
  `| Дата | Формат | Тема | Превью |`,
  `|---|---|---|---|`,
  ...WEEK.items.map(i => `| ${i.date} | ${i.format === 'clip' ? `Клип ${i.duration_seconds} с` : 'Пост с изображением'} | ${i.title} | [Открыть](${mediaName(i)}) |`),
  '',
];
for (const item of WEEK.items) {
  const media = mediaName(item);
  reviewMd.push(`## ${item.date} — ${item.title}`, '',
    `**Формат:** ${item.format === 'clip' ? `клип ${item.duration_seconds} секунд` : 'пост + изображение'}. **Согласование:** ожидается.`, '',
    `### Текст публикации`, '', item.text, '',
    `### Визуал`, '', item.format === 'clip' ? `[▶ Посмотреть клип](${media})` : `![Иллюстрация к публикации](${media})`, '',
    item.visual_brief, '');
  if (item.format === 'clip') {
    reviewMd.push(`### Раскадровка`, '');
    item.scenes.forEach((scene, idx) => reviewMd.push(`${idx + 1}. **${scene.seconds} с:** «${scene.overlay}» — ${scene.visual}`));
    reviewMd.push('');
  }
  reviewMd.push(`### История на 10:15`, '', `![История](${item.date}-story.jpg)`, '', item.story_text, '',
    `*${item.disclosure}*`, '', '---', '');
}
fs.writeFileSync(path.join(OUT, 'index.md'), `${reviewMd.join('\n')}\n`, 'utf8');

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cards = WEEK.items.map(item => {
  const media = mediaName(item);
  const video = item.format === 'clip'
    ? `<video controls playsinline preload="metadata" src="${escape(media)}"></video>`
    : `<img loading="lazy" src="${escape(media)}" alt="Иллюстрация"/>`;
  return `<section class="card"><div class="day"><span>${escape(item.date)}</span><span>${item.format === 'clip' ? 'КЛИП' : 'ПОСТ'} + ИСТОРИЯ</span></div>` +
    `<h2>${escape(item.title)}</h2><div class="grid"><div class="media">${video}<img loading="lazy" src="${item.date}-story.jpg" alt="История"/></div>` +
    `<div><h3>Текст</h3><div class="caption">${escape(item.text)}</div><h3>Визуальная идея</h3><p>${escape(item.visual_brief)}</p>` +
    (item.scenes ? `<h3>Раскадровка</h3><ol>${item.scenes.map(s => `<li>${s.seconds} с — ${escape(s.overlay)}</li>`).join('')}</ol>` : '') +
    `<p class="note">${escape(item.disclosure)}</p></div></div></section>`;
}).join('\n');
const reviewHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
  `<title>Solar House · публикации 20–26 ноября</title><style>*{box-sizing:border-box}body{margin:0;background:#ecebe7;color:#181818;font:17px/1.55 system-ui,Arial,sans-serif}` +
  `.header{background:#151515;color:#fff;padding:40px max(5vw,24px)}.header strong{color:#f9c734}.header h1{font-size:clamp(30px,4vw,56px);margin:.4em 0}` +
  `.wrapper{max-width:1400px;padding:34px 24px;margin:auto}.card{background:white;border-radius:22px;padding:30px;margin:0 0 34px;box-shadow:0 7px 26px #0001}` +
  `.day{display:flex;justify-content:space-between;color:#735b11;font-weight:800;letter-spacing:.07em}.card h2{font-size:28px;margin:16px 0}.grid{display:grid;grid-template-columns:minmax(280px,52%) 1fr;gap:26px}` +
  `.media{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:12px}.media img,.media video{width:100%;border-radius:12px;max-height:640px;object-fit:contain;background:#222}` +
  `h3{font-size:19px;margin:6px 0 10px}.caption{white-space:pre-wrap;font-size:16px}.note{color:#666;font-style:italic}.footer{font-size:14px;color:#666;padding:15px}` +
  `@media(max-width:900px){.grid{grid-template-columns:1fr}.card{padding:18px}.media{grid-template-columns:1fr 1fr}}` +
  `</style><header class="header"><strong>SOLAR HOUSE · РЕДАКЦИОННЫЙ ПАКЕТ</strong><h1>20–26 ноября 2026</h1>` +
  `<p>7 публикаций · 3 клипа · 4 фотопоста · 7 историй</p><p>⚠ НА СОГЛАСОВАНИИ — автоматическая публикация выключена.</p></header>` +
  `<main class="wrapper">${cards}<p class="footer">Все изображения и видеосцены иллюстративные. После согласования материалы переводятся в рабочую очередь отдельно.</p></main></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), reviewHtml, 'utf8');
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`REVIEW ONLY: ${outputs.length} assets in ${OUT}`);
