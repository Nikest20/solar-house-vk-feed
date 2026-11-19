// ONE-TIME recovery of the Nov 19 approved VK clip. The first attempt selected
// the file, but did not press Publish. This script preserves that old journal,
// requires a read-only inspection and a NEW explicit --publish choice.
// It stops on ambiguous state and never retries a click or file selection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVideo, videoSha256 } from './video-cloud-lib.mjs';
import { verifyTerraceRecoveryEvidence } from './clip-recovery-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const PROFILE = path.join(APP, 'browser-profile');
const STAGING = path.join(APP, 'video-staging');
const INSPECTIONS = path.join(APP, 'clip-draft-inspection');
const ORIGINAL = path.join(STAGING, 'solar-house-terrace-20261119.json');
const RECOVERY = path.join(STAGING, 'solar-house-terrace-20261119-recovery.json');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT = path.join(STAGING, 'recovery-diagnostics', RUN_ID);
const CABINET = 'https://cabinet.vkvideo.ru/dashboard/@club211038294';
const CHANNEL = 'https://vkvideo.ru/@solarhouse_pro';
const OWNER = 'Строительство каркасных домов в Нижнем Новгороде';
const PUBLISH = process.argv.includes('--publish');

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'videos-queue', '2026-11-19-terrace.json'), 'utf8'));
const video = validateVideo(raw);
if (video.id !== 'solar-house-terrace-20261119' || video.status !== 'approved') {
  throw new Error('This recovery applies only to the approved Nov 19 terrace clip');
}
const filename = path.join(ROOT, video.file);
const bytes = fs.readFileSync(filename);
if (videoSha256(bytes) !== video.file_sha256) throw new Error('Approved video file SHA256 mismatch');
if (!fs.existsSync(ORIGINAL)) throw new Error('Original upload journal missing; recovery forbidden');
if (fs.existsSync(RECOVERY)) throw new Error('Recovery already attempted; do not upload again. Review its journal.');

const originalJournal = JSON.parse(fs.readFileSync(ORIGINAL, 'utf8'));
const originalResult = JSON.parse(fs.readFileSync(path.join(originalJournal.diagnostics, 'result.json'), 'utf8'));
const inspections = fs.readdirSync(INSPECTIONS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(INSPECTIONS, d.name, 'result.json'))
  .filter(f => fs.existsSync(f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
if (!inspections.length) throw new Error('No read-only inspection results: run Inspect-VK-Clip-Draft.ps1 first');
const latest = inspections[0];
if (Date.now() - fs.statSync(latest).mtimeMs > 36 * 3_600_000) {
  throw new Error('Read-only inspection is older than 36 hours; inspect again before recovery');
}
const inspection = JSON.parse(fs.readFileSync(latest, 'utf8'));
verifyTerraceRecoveryEvidence({ originalJournal, originalResult, inspection, expectedSha: video.file_sha256 });

console.log('RECOVERY PRECHECK: approved MP4 hash OK; first attempt never submitted; no clip found in latest inspection.');
console.log(`Read-only inspection: ${latest}`);
console.log(`First upload journal will NOT be deleted: ${ORIGINAL}`);
console.log('The original temporary clip link does NOT prove that a published clip exists.');
if (!PUBLISH) {
  console.log('CHECK ONLY: nothing uploaded. To make ONE recovery attempt, explicitly use -Publish.');
  process.exit(0);
}
if (process.platform !== 'win32' || !fs.existsSync(PROFILE)) {
  throw new Error('Use the signed-in interactive Windows account with Chrome profile');
}

fs.mkdirSync(OUTPUT, { recursive: true });
const result = {
  mode: 'EXPLICIT-ONE-SHOT-RECOVERY', approved_video: video.id, file_sha256: video.file_sha256,
  previous_inspection: latest, previous_clip_id: inspection.clip_id,
  uploaded_again: false, publish_click_initiated: false, published_verified: false,
  state: 'before-second-file-selection', recovery_journal: RECOVERY, output: OUTPUT,
};
const save = () => fs.writeFileSync(path.join(OUTPUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const updateJournal = state => {
  const journal = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  journal.state = state;
  journal.updated_at_utc = new Date().toISOString();
  fs.writeFileSync(RECOVERY, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
};
save();
let context;
let cabinet;
try {
  const { chromium } = await import('playwright');
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false, viewport: { width: 1380, height: 930 }, locale: 'ru-RU',
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(25_000);

  // LIVE read-only duplicate check (in addition to the attached inspection).
  await page.goto(CABINET, { waitUntil: 'commit', timeout: 35_000 });
  await page.getByText('Мой контент', { exact: true }).first().waitFor({ state: 'visible', timeout: 50_000 });
  await page.getByText('Мой контент', { exact: true }).first().click();
  await page.getByText('Клипы', { exact: true }).first().waitFor({ state: 'visible', timeout: 25_000 });
  await page.getByText('Клипы', { exact: true }).first().click();
  await page.waitForTimeout(2_500);
  const publishedText = await page.locator('body').innerText();
  await page.screenshot({ path: path.join(OUTPUT, 'before-recovery-clips.png') });
  if (!/135\s*клипов/i.test(publishedText) || !/17\s*нояб(?:ря)?\s*2026/i.test(publishedText) ||
      publishedText.includes(inspection.clip_id) || /Терраса\? Да зачем она нам/i.test(publishedText)) {
    throw new Error('Live clips listing changed since the inspection; check for an existing publication');
  }
  await page.getByText('Отложенные', { exact: true }).first().click();
  await page.waitForTimeout(2_000);
  const scheduledText = await page.locator('body').innerText();
  await page.screenshot({ path: path.join(OUTPUT, 'before-recovery-scheduled.png') });
  if (!/0\s*клипов/i.test(scheduledText)) {
    throw new Error('Scheduled clips listing is not empty; stop before another upload');
  }

  await page.goto(CHANNEL, { waitUntil: 'commit', timeout: 35_000 });
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  await add.nth(1).waitFor({ state: 'visible', timeout: 40_000 });
  await add.nth(1).click();
  const upload = page.getByText('Загрузить видео', { exact: true }).first();
  await upload.waitFor({ state: 'visible', timeout: 8_000 });
  const popup = context.waitForEvent('page', { timeout: 15_000 });
  await upload.click();
  cabinet = await popup;
  await cabinet.getByText('Новое видео', { exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  if (!cabinet.url().startsWith(CABINET)) throw new Error('Unexpected VK cabinet or channel');
  const newVideoDialog = cabinet.getByRole('dialog').filter({ hasText: 'Новое видео' }).last();
  if (!(await newVideoDialog.innerText()).includes(OWNER)) throw new Error('Wrong upload owner');
  const inputs = cabinet.locator('input[type="file"][accept*="video"]');
  if (await inputs.count() !== 1) throw new Error('Expected exactly one video input');
  await cabinet.screenshot({ path: path.join(OUTPUT, 'before-second-file-selection.png') });

  // Atomic one-shot guard written BEFORE transfer. Never remove this file to retry.
  fs.writeFileSync(RECOVERY, `${JSON.stringify({ video_id: video.id, file_sha256: video.file_sha256,
    state: 'second-upload-outcome-uncertain', selected_at_utc: new Date().toISOString(),
    previous_journal: ORIGINAL, diagnostics: OUTPUT }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log('Selecting approved MP4 ONE MORE TIME. Any subsequent error requires manual review, not a rerun.');
  await inputs.setInputFiles(filename, { timeout: 30_000 });
  result.uploaded_again = true;
  result.state = 'second-file-selected';
  save();

  await cabinet.getByText('Публикация клипа', { exact: true }).first().waitFor({ state: 'visible', timeout: 110_000 });
  await cabinet.getByText('Клип загружен и обработан', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 110_000 });
  // Close the identified VK onboarding tutorial only; never close the editor.
  const tutorial = cabinet.locator('[role="dialog"]').filter({ hasText: /Следите за.{0,4}охватами/ });
  if (await tutorial.count()) {
    await tutorial.first().getByRole('button', { name: 'Закрыть' }).first().click({ timeout: 7_000 });
  }
  const continueButton = cabinet.getByRole('button', { name: 'Продолжить публикацию' });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();

  const editor = cabinet.getByRole('dialog').filter({ hasText: 'Публикация клипа' }).first();
  const caption = cabinet.getByPlaceholder('О чём ваш клип?').first();
  if (await caption.count() !== 1 || !await caption.isVisible()) {
    throw new Error('Clip description field is not uniquely found; do not publish with an empty caption');
  }
  await caption.fill(video.text);
  const entered = await caption.evaluate(el => ('value' in el ? el.value : el.innerText));
  if (entered.trim() !== video.text.trim()) throw new Error('Clip description did not match approved text');

  const labels = await editor.innerText();
  if (!labels.includes('Клип загружен и обработан') || !labels.includes(video.file.split('/').at(-1)) ||
      !labels.includes('Сейчас') || !labels.includes('Показать на') || !labels.includes('Опубликовать в')) {
    throw new Error('Clip editor is not in expected processed/instant-publication state');
  }
  const match = labels.match(/https:\/\/vkvideo\.ru\/(clip-211038294_\d{5,})/);
  if (!match || match[1] === inspection.clip_id) {
    throw new Error('No NEW community-owned VK Clip ID; stop without publishing');
  }
  result.new_clip_id = match[1];
  result.new_clip_url = match[0];
  result.state = 'prepared-before-publish';
  await cabinet.screenshot({ path: path.join(OUTPUT, 'prepared-with-caption.png') });
  save();

  const publish = editor.getByRole('button', { name: 'Опубликовать', exact: true });
  if (await publish.count() !== 1 || !await publish.isEnabled()) {
    throw new Error('Publish button is not uniquely available; no click made');
  }
  // Playwright trial checks overlays and clickability without actually clicking.
  await publish.click({ trial: true, timeout: 12_000 });
  // Mark irreversible intent BEFORE the single click. Never click it twice.
  result.publish_click_initiated = true;
  result.state = 'publish-click-outcome-uncertain';
  updateJournal('publish-click-outcome-uncertain');
  save();
  await publish.click({ timeout: 15_000 });
  console.log(`Clicked VK 'Опубликовать' ONCE for ${result.new_clip_url}. Checking the visible result...`);
  await cabinet.waitForTimeout(5_000);
  await cabinet.screenshot({ path: path.join(OUTPUT, 'after-publish-click.png') }).catch(() => {});
  const after = await cabinet.locator('body').innerText().catch(() => '');
  result.after_click_excerpt = after.slice(0, 2100);
  result.state = 'publish-clicked-needs-live-confirmation';
  save();
  // Do not rely solely on the click. Verify that the new clip appears in the
  // creator listing, or leave a clearly reported uncertain outcome.
  await cabinet.goto(CABINET, { waitUntil: 'commit', timeout: 30_000 });
  await cabinet.getByText('Мой контент', { exact: true }).first().waitFor({ state: 'visible', timeout: 40_000 });
  await cabinet.getByText('Мой контент', { exact: true }).first().click();
  await cabinet.getByText('Клипы', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
  await cabinet.getByText('Клипы', { exact: true }).first().click();
  await cabinet.waitForTimeout(3_000);
  const finalText = await cabinet.locator('body').innerText();
  await cabinet.screenshot({ path: path.join(OUTPUT, 'final-clips.png') });
  result.published_verified = finalText.includes('Терраса?') || finalText.includes(video.text.slice(0, 43));
  result.state = result.published_verified ? 'visible-in-vk-published-clips' : 'publish-clicked-not-yet-confirmed';
  updateJournal(result.state);
  save();
  console.log(result.published_verified
    ? `VK CLIP VISIBLE IN CABINET: ${result.new_clip_url}`
    : `PUBLISH CLICKED, BUT RESULT NOT CONFIRMED. Check ${result.new_clip_url} and the diagnostics; NEVER retry upload.`);
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 500);
  result.state = fs.existsSync(RECOVERY) ? 'uncertain-no-retry' : 'stopped-before-second-file-selection';
  if (cabinet) await cabinet.screenshot({ path: path.join(OUTPUT, 'failure.png') }).catch(() => {});
  save();
  console.error(`RECOVERY STOPPED: ${result.error}`);
  console.error(`Diagnostics: ${OUTPUT}`);
  if (context && fs.existsSync(RECOVERY) && !result.publish_click_initiated) {
    console.error('The clip upload may now exist in the OPEN VK browser. Do not rerun this script.');
    console.error('If the full publication form is visible, you may complete it manually in that browser.');
    console.error('Press ENTER in PowerShell after reviewing VK, or wait up to 3 minutes to close Chrome.');
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 180_000);
      process.stdin.once('data', () => { clearTimeout(timer); resolve(); });
    });
    if (cabinet) await cabinet.screenshot({ path: path.join(OUTPUT, 'after-manual-review.png') }).catch(() => {});
    result.manual_review_window_offered = true;
    save();
  }
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
}
