// Select the ONE approved Solar House terrace MP4 using the signed-in Chrome.
// This starts VK Video upload/draft creation, but NEVER clicks Next/Save/
// Publish or posts to the wall. Reruns after an attempt are blocked locally.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateVideo, videoSha256 } from './video-cloud-lib.mjs';
import { videoEligibleForBrowserStage } from './video-ui-stage-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUEUE_FILE = path.join(ROOT, 'videos-queue', '2026-11-19-terrace.json');
const APP_ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const PROFILE = path.join(APP_ROOT, 'browser-profile');
const STAGING = path.join(APP_ROOT, 'video-staging');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT = path.join(STAGING, 'diagnostics', RUN_ID);
const EXPECTED_OWNER = 'Строительство каркасных домов в Нижнем Новгороде';
const CHANNEL_URL = 'https://vkvideo.ru/@solarhouse_pro';
const CABINET_PREFIX = 'https://cabinet.vkvideo.ru/dashboard/@club211038294';

const mode = process.argv.includes('--stage') ? 'stage' : 'check';
const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
const video = validateVideo(raw);
const filename = path.join(ROOT, video.file);
if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error('Approved MP4 is missing');
const bytes = fs.readFileSync(filename);
if (videoSha256(bytes) !== video.file_sha256) throw new Error('Approved MP4 hash mismatch');

const JOURNAL = path.join(STAGING, `${video.id}.json`);
if (mode === 'check') {
  console.log(`SOLAR HOUSE VK VIDEO: mode=check; approved=${video.status === 'approved'}; file_hash=ok`);
  console.log(`Video: ${video.file}; bytes=${bytes.length}; browser_staging=available_now_if_approved`);
  console.log(`Current time: ${new Date().toISOString()}; prior_attempt=${fs.existsSync(JOURNAL)}`);
  console.log('CHECK ONLY: no Chrome, VK upload or wall post.');
  process.exit(0);
}

if (process.platform !== 'win32') throw new Error('Video staging requires interactive Windows Chrome');
if (!fs.existsSync(PROFILE)) throw new Error('Signed-in Chrome profile is missing');
videoEligibleForBrowserStage(raw, bytes, new Date(), fs.existsSync(JOURNAL));
fs.mkdirSync(OUTPUT, { recursive: true });
const summary = {
  video_id: video.id, owner_id: '-211038294', file: video.file,
  file_sha256: video.file_sha256, run_id: RUN_ID,
  status: 'before-file-selection', journal_file: JOURNAL,
  selected_file_once: false, clicked_next: false,
  clicked_save: false, clicked_publish: false, clicked_wall_post: false,
};
function saveSummary() {
  fs.writeFileSync(path.join(OUTPUT, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
saveSummary();

let context;
try {
  const { chromium } = await import('playwright');
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false, viewport: { width: 1380, height: 930 }, locale: 'ru-RU',
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(30_000);
  console.log('Opening Solar House VK Video channel...');
  await page.goto(CHANNEL_URL, { waitUntil: 'commit', timeout: 35_000 });
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  await add.nth(1).waitFor({ state: 'visible', timeout: 40_000 });
  await add.nth(1).click();
  const uploadEntry = page.getByText('Загрузить видео', { exact: true }).first();
  await uploadEntry.waitFor({ state: 'visible', timeout: 8_000 });
  const popup = context.waitForEvent('page', { timeout: 15_000 });
  await uploadEntry.click();
  const cabinet = await popup;
  await cabinet.getByText('Новое видео', { exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  if (!cabinet.url().startsWith(CABINET_PREFIX)) throw new Error('Unexpected VK Video cabinet/owner');
  const dialog = cabinet.getByRole('dialog').filter({ hasText: 'Новое видео' }).last();
  await dialog.waitFor({ state: 'visible', timeout: 12_000 });
  if (!(await dialog.innerText()).includes(EXPECTED_OWNER)) {
    throw new Error('Upload dialog did not select the Solar House community');
  }
  const fileInputs = cabinet.locator('input[type="file"][accept*="video"]');
  if (await fileInputs.count() !== 1) throw new Error('Expected exactly one video file input');
  await cabinet.screenshot({ path: path.join(OUTPUT, 'before-file-selection.png'), timeout: 15_000 });

  // Journal BEFORE triggering upload. Its existence prevents repeat uploads
  // even if Playwright crashes, VK times out, or the response is uncertain.
  const journal = { video_id: video.id, state: 'upload-outcome-uncertain',
    selected_at_utc: new Date().toISOString(), file_sha256: video.file_sha256,
    approval_status: video.status, diagnostics: OUTPUT };
  fs.mkdirSync(STAGING, { recursive: true });
  fs.writeFileSync(JOURNAL, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log('Selecting approved MP4 ONCE for VK Video upload (no Publish/Save/Next)...');
  await fileInputs.setInputFiles(filename, { timeout: 30_000 });
  summary.selected_file_once = true;
  summary.status = 'file-selected-upload-or-draft-may-exist';
  saveSummary();

  // Small MP4 is usually transferred quickly. Wait for the next screen or
  // a clear error before closing Chrome; never click subsequent steps.
  const until = Date.now() + 75_000;
  let modalText = '';
  while (Date.now() < until) {
    await cabinet.waitForTimeout(2_500);
    modalText = await cabinet.locator('[role="dialog"]').evaluateAll(nodes => nodes
      .filter(node => node.getBoundingClientRect().width > 0)
      .map(node => String(node.innerText || '').slice(0, 1400)).join('\n---\n')).catch(() => '');
    if (/название видео|описание видео|настроить видео|обложка видео|загрузка завершена|ошибка загрузки/i.test(modalText)) break;
  }
  summary.status = 'upload-ui-inspected-outcome-not-yet-confirmed';
  summary.page = new URL(cabinet.url()).origin + new URL(cabinet.url()).pathname;
  summary.modal_labels = modalText.slice(0, 1700);
  summary.visible_actions = await cabinet.getByRole('button').evaluateAll(nodes => nodes
    .filter(node => node.getBoundingClientRect().width > 0)
    .map(node => (node.getAttribute('aria-label') || node.innerText || '').trim().slice(0, 80))
    .filter(Boolean).slice(-35)).catch(() => []);
  const screenshot = path.join(OUTPUT, 'after-file-selection.png');
  await cabinet.screenshot({ path: screenshot, timeout: 20_000 }).catch(() => {});
  summary.screenshot = screenshot;
  saveSummary();
  console.log(`STAGE INSPECTION COMPLETE: ${OUTPUT}`);
  console.log('No Next, Save, Publish or wall post clicked. Do NOT rerun until result is reviewed.');
} catch (error) {
  summary.status = fs.existsSync(JOURNAL) ? 'upload-outcome-uncertain-do-not-retry' : 'stopped-before-upload';
  summary.error = String(error?.message ?? error).slice(0, 250);
  saveSummary();
  console.error(`STOPPED: ${summary.error}`);
  console.error(`Diagnostics: ${OUTPUT}`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
}
