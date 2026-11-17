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
try {
  const { chromium } = await import('playwright');
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false, viewport: { width: 1380, height: 930 }, locale: 'ru-RU',
  });
  const page = context.pages()[0] ?? await context.newPage();
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
      return { text_length: body.length,
        clip_id_in_visible_text: body.includes(clipId),
        filename_visible: body.includes('solar-house-terrace-2026-11-19.mp4'),
        matching_clip_links: links.length,
        visible_buttons: [...document.querySelectorAll('button')]
          .filter(el => el.getBoundingClientRect().width > 0)
          .map(el => (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 65))
          .filter(t => /чернов|отлож|клип|видео|создать|добавить/i.test(t)).slice(0, 22),
      };
    }, { clipId }).catch(() => ({ text_length: 0 }));
    const url = new URL(page.url());
    result.views.push({ name, page: `${url.origin}${url.pathname}`, screenshot: file, ...visible });
    console.log(`${name}: text=${visible.text_length}; clip_id_visible=${visible.clip_id_in_visible_text}; filename_visible=${visible.filename_visible}; screenshot=${file}`);
  }

  await snapshot('cabinet');
  await page.getByText('Клипы', { exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(2_500);
  await snapshot('clips');
  const drafts = page.getByText('Черновики', { exact: true });
  await drafts.first().waitFor({ state: 'visible', timeout: 12_000 });
  await drafts.first().click();
  await page.waitForTimeout(3_000);
  await snapshot('clips-drafts');
  save();
  console.log(`READ ONLY RESULT: ${path.join(DIAG, 'result.json')}`);
  console.log('No video file selected; no clip saved, published or deleted.');
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 220);
  save();
  console.error(`CLIP INSPECTION STOPPED: ${result.error}`);
  console.error(`Diagnostics: ${DIAG}`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
}
