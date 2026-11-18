// READ ONLY: locate the already-uploaded Solar House clip in VK Video creator
// cabinet, without selecting a new file or clicking Publish/Save/Delete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GROUP = '211038294';
const ID = 'solar-house-terrace-20261119';
const ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const PROFILE = path.join(ROOT, 'browser-profile');
const JOURNAL = path.join(ROOT, 'video-staging', `${ID}.json`);
const DIAG = path.join(ROOT, 'clip-draft-inspection', new Date().toISOString().replace(/[:.]/g, '-'));
const CABINET = `https://cabinet.vkvideo.ru/dashboard/@club${GROUP}`;

if (process.argv.includes('--self-test')) { console.log('CLIP_INSPECTION_READ_ONLY=true'); process.exit(0); }
if (process.platform !== 'win32') throw new Error('Needs signed-in interactive Windows Chrome');
if (!fs.existsSync(JOURNAL)) throw new Error('First-upload journal not found; do not upload again');
const previous = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
const summaryPath = path.join(previous.diagnostics, 'result.json');
if (!fs.existsSync(summaryPath)) throw new Error('First-upload diagnostic report not found');
const previousResult = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const matches = String(previousResult.modal_labels ?? '').match(new RegExp(`clip-${GROUP}_(\\d{5,})`));
if (!matches) throw new Error('No confirmed clip ID in the first-upload report');
const clipId = `clip-${GROUP}_${matches[1]}`;
fs.mkdirSync(DIAG, { recursive: true });
const result = { mode: 'READ-ONLY', clip_id: clipId, original_status: previousResult.status,
  views: [], owner_id: `-${GROUP}`, published_or_saved: 'not-confirmed' };
function save() { fs.writeFileSync(path.join(DIAG, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8'); }

let context;
let page;
try {
  const { chromium } = await import('playwright');
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false, viewport: { width: 1380, height: 930 }, locale: 'ru-RU',
  });
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(25_000);
  console.log(`Checking ${clipId} in Solar House creator cabinet (read only)...`);
  await page.goto(CABINET, { waitUntil: 'commit', timeout: 35_000 });
  await page.getByText('Мой контент', { exact: true }).first().waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(2_000);

  // The onboarding tutorial can cover the content tabs. Close only that
  // identified tutorial, never a publication/editing dialog.
  const tutorial = page.locator('[role="dialog"]').filter({ hasText: /Следите за.{0,4}охватами/ });
  if (await tutorial.count()) {
    await tutorial.first().getByRole('button', { name: 'Закрыть' }).first().click({ timeout: 6_000 }).catch(() => {});
  }

  async function snapshot(name) {
    const file = path.join(DIAG, `${name}.png`);
    await page.screenshot({ path: file, timeout: 18_000 }).catch(() => {});
    const visible = await page.evaluate(({ clipId }) => {
      const body = document.body?.innerText || '';
      const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || '')
        .filter(href => href.includes(clipId)).slice(0, 10);
      const interactive = [...document.querySelectorAll('button,a,[role="tab"],[role="button"],input,select')]
        .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
        .map(el => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80))
        .filter(Boolean);
      return { text_length: body.length,
        clip_id_in_visible_text: body.includes(clipId),
        clip_id_in_dom: document.documentElement?.outerHTML?.includes(clipId) || false,
        filename_visible: body.includes('solar-house-terrace-2026-11-19.mp4'),
        matching_clip_links: links.length,
        matching_clip_urls: links,
        visible_actions: [...new Set(interactive)].slice(0, 90),
        content_excerpt: body.slice(0, 6500),
      };
    }, { clipId }).catch(() => ({ text_length: 0 }));
    const url = new URL(page.url());
    result.views.push({ name, page: `${url.origin}${url.pathname}`, screenshot: file, ...visible });
    console.log(`${name}: text=${visible.text_length}; clip_id_visible=${visible.clip_id_in_visible_text}; filename_visible=${visible.filename_visible}; screenshot=${file}`);
  }

  await snapshot('cabinet');
  // The dashboard opens on Overview. "Мой контент" in its sidebar is a
  // navigation item, not proof that the content tabs have loaded.
  const myContent = page.getByText('Мой контент', { exact: true }).first();
  await myContent.click({ timeout: 12_000 });
  await page.waitForTimeout(2_000);
  await snapshot('my-content');
  await page.getByText('Клипы', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 22_000 });
  await page.getByText('Клипы', { exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(2_500);
  await snapshot('clips');
  // The VK Video interface does not consistently display a "Черновики" tab
  // on the clips listing. Record the actual options instead of failing on a
  // guessed label. A visible draft filter is safe to open: it does not submit.
  const possibleFilters = [/^Черновики$/i, /^Черновик$/i, /^Неопубликованные$/i,
    /^Отложенные$/i, /^Запланированные$/i, /^В ожидании публикации$/i];
  let clickedFilter = false;
  for (const filter of possibleFilters) {
    const loc = page.getByText(filter).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 8_000 });
      await page.waitForTimeout(2_500);
      await snapshot('clips-filter');
      result.clicked_filter = String(filter);
      clickedFilter = true;
      break;
    }
  }
  if (!clickedFilter) result.note = 'No visible drafts/scheduled filter in the Clips interface; do not infer that the clip is missing.';

  // The ID assigned by the upload form may only exist in a transient session.
  // Visiting its already-known URL is a read-only availability check.
  await page.goto(`https://vkvideo.ru/${clipId}`, { waitUntil: 'commit', timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await snapshot('direct-clip-link');
  result.publication_status = 'not-confirmed';
  result.next_step = 'Review clips.png, direct-clip-link.png and result.json before any repeat upload or publication';
  save();
  console.log(`READ ONLY RESULT: ${path.join(DIAG, 'result.json')}`);
  console.log('No video file selected; no clip saved, published or deleted. Publication is NOT confirmed.');
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 220);
  if (page) {
    const failureImage = path.join(DIAG, 'failure.png');
    await page.screenshot({ path: failureImage, timeout: 12_000 }).catch(() => {});
    result.failure_screenshot = failureImage;
    try { const u = new URL(page.url()); result.failure_page = `${u.origin}${u.pathname}`; } catch {}
  }
  save();
  console.error(`CLIP INSPECTION STOPPED: ${result.error}`);
  console.error(`Diagnostics: ${DIAG}`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
}
