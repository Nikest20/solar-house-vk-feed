// VK photo-album inspector and upload-only diagnostic for Solar House.
// Uses the browser UI selectors captured by the owner with Playwright codegen.
// No token access, wall.post request or automatic retries.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import process from 'node:process';

const GROUP_ID = '211038294';
const ALBUM_ID = '281257058';
const ALBUM_URL = `https://vk.ru/album-${GROUP_ID}_${ALBUM_ID}`;
const PROFILE = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto', 'browser-profile');
const ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = path.join(ROOT, 'upload-diagnostics', RUN_ID);
const SUMMARY_FILE = path.join(LOG_DIR, 'result.json');

function photoIds(value) {
  const ids = new Set();
  const regex = new RegExp(`photo-${GROUP_ID}_(\\d{6,})`, 'g');
  for (const match of String(value).matchAll(regex)) ids.add(match[1]);
  return ids;
}

function photoObjects(value, depth = 0, acc = new Set()) {
  if (depth > 16 || !value || typeof value !== 'object') return acc;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) photoObjects(item, depth + 1, acc);
  } else {
    if (String(value.owner_id) === `-${GROUP_ID}` && /^\d{6,}$/.test(String(value.id ?? ''))) {
      acc.add(String(value.id));
    }
    for (const item of Object.values(value).slice(0, 200)) photoObjects(item, depth + 1, acc);
  }
  return acc;
}

function testExtraction() {
  const assert = (ok, what) => { if (!ok) throw new Error(`Self-test failed: ${what}`); };
  assert(photoIds('https://vk.ru/photo-211038294_457240386').has('457240386'), 'photo URL');
  assert(photoIds('https://vk.ru/photo-123_457240386').size === 0, 'different group');
  assert(photoObjects({ response: [{ owner_id: -211038294, id: 457240387 }] }).has('457240387'), 'VK photo response');
  assert(photoObjects({ response: [{ owner_id: -999, id: 457240387 }] }).size === 0, 'different owner');
  console.log('Self-test OK');
}

if (process.argv.includes('--self-test')) {
  testExtraction();
  process.exit(0);
}

const INSPECT_ONLY = process.argv.includes('--inspect');
const inputArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const inputFile = inputArg ? path.resolve(inputArg) : path.join(import.meta.dirname, 'test-photo.jpg');
const summary = {
  run_id: RUN_ID,
  album_url: ALBUM_URL,
  mode: INSPECT_ONLY ? 'read-only-inspect' : 'upload-one-photo',
  file_name: INSPECT_ONLY ? null : path.basename(inputFile),
  status: 'started',
  new_photo_ids: [],
  network_photo_ids: [],
  save_clicked: false,
  started_at: new Date().toISOString(),
};

function writeSummary() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function getVisiblePhotoIds(page) {
  const html = await page.evaluate(() => document.body.innerHTML);
  return photoIds(html);
}

async function visibleButtonNames(page) {
  return page.getByRole('button').evaluateAll(items =>
    items.filter(x => x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height > 0)
      .slice(0, 65)
      .map(x => (x.getAttribute('aria-label') || x.innerText || x.title || '').trim().slice(0, 100))
      .filter(Boolean)
  );
}

async function run() {
  if (!INSPECT_ONLY) {
    if (!fs.existsSync(inputFile) || !fs.statSync(inputFile).isFile()) {
      throw new Error(`Файл фотографии не найден: ${inputFile}`);
    }
    const ext = path.extname(inputFile).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      throw new Error('Для первого теста используйте JPG, PNG или WEBP.');
    }
    summary.file_sha256 = crypto.createHash('sha256').update(fs.readFileSync(inputFile)).digest('hex');
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Библиотека Playwright не найдена. Используйте каталог SolarHouseVK с установленным Playwright.');
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1380, height: 930 },
      locale: 'ru-RU',
    });
  } catch (error) {
    throw new Error(`Chrome не запустился. Закройте Playwright codegen и его окно Chrome, затем попробуйте ещё раз. ${error.message.slice(0, 180)}`);
  }

  let page;
  try {
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(20000);
    console.log('Открываю альбом сообщества...');
    try {
      // VK can keep its large page loading while the useful interface is
      // already visible. Wait for response commit, then the actual button.
      await page.goto(ALBUM_URL, { waitUntil: 'commit', timeout: 30000 });
    } catch (navigationError) {
      summary.navigation_warning = String(navigationError?.message ?? navigationError).slice(0, 220);
      console.log('Предупреждение: переход задержался. Проверяю, появился ли интерфейс альбома...');
    }
    const addButton = page.getByRole('button', { name: 'Добавить фотографии' });
    try {
      await addButton.waitFor({ state: 'visible', timeout: 25000 });
    } catch {
      summary.current_page = page.url();
      summary.document_state = await page.evaluate(() => document.readyState).catch(() => 'unavailable');
      summary.page_title = await page.title().catch(() => 'unavailable');
      summary.buttons_on_page = await visibleButtonNames(page).catch(() => []);
      try {
        await page.screenshot({ path: path.join(LOG_DIR, 'navigation-error.png'), timeout: 8000 });
      } catch { /* Keep the more useful page diagnostics. */ }
      throw new Error('Кнопка «Добавить фотографии» не появилась. Нужен скриншот navigation-error.png из папки диагностики.');
    }
    // Let the album load before capturing the baseline of existing photos.
    await page.waitForTimeout(1500);
    const before = await getVisiblePhotoIds(page);
    summary.photos_visible_before = before.size;

    if (INSPECT_ONLY) {
      const ids = [...before].sort((a, b) => Number(b) - Number(a));
      summary.status = ids.length ? 'album-ids-read' : 'album-ids-not-found';
      summary.photos_visible = ids.length;
      summary.recent_photo_candidates = ids.slice(0, 10).map(id => `https://vk.ru/photo-${GROUP_ID}_${id}`);
      console.log(`\nНайдено ID фотографий сообщества: ${ids.length}`);
      if (ids.length) {
        console.log('Наибольший ID (предположительно последняя загруженная фотография):');
        console.log(summary.recent_photo_candidates[0]);
        console.log('Проверьте, что по ссылке именно тестовая фотография Solar House.');
      } else {
        console.log('ID не найдены в текущей разметке альбома.');
      }
      console.log(`Диагностика: ${SUMMARY_FILE}`);
      writeSummary();
      return ids.length ? 0 : 3;
    }

    // Track any new photo IDs returned by the upload requests. Never store raw
    // response bodies: they can contain account or session information.
    const networkPhotos = new Set();
    let captureNetwork = false;
    const pendingResponses = new Set();
    page.on('response', response => {
      if (!captureNetwork) return;
      if (!/(?:photo|upload|save)/i.test(response.url())) return;
      if (response.status() < 200 || response.status() >= 300) return;
      const promise = (async () => {
        try {
          const contentLength = Number(response.headers()['content-length'] || 0);
          if (contentLength > 500_000) return;
          const body = await response.text();
          if (body.length > 500_000) return;
          for (const id of photoIds(body)) networkPhotos.add(id);
          try {
            for (const id of photoObjects(JSON.parse(body))) networkPhotos.add(id);
          } catch { /* VK sometimes returns non-JSON response wrappers. */ }
        } catch { /* Network capture is supplementary. */ }
      })();
      pendingResponses.add(promise);
      void promise.finally(() => pendingResponses.delete(promise));
    });

    console.log('Нажимаю «Добавить фотографии»...');
    // Clicking VK's button opens the *native Windows file dialog*. Listening
    // for Playwright's filechooser BEFORE the click captures that dialog and
    // lets Playwright supply the file without any user interaction. Setting
    // input files only AFTER clicking left a native dialog open and required
    // manual selection; the old DOM also contained duplicate input IDs.
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 20_000 });
    captureNetwork = true;
    await addButton.click();
    const fileChooser = await fileChooserPromise;
    console.log(`Автоматически передаю файл в VK: ${path.basename(inputFile)}. Ничего в Chrome не нажимайте.`);
    await fileChooser.setFiles(inputFile);
    summary.file_selection_method = 'playwright-filechooser';
    summary.status = 'file-selected-upload-not-yet-confirmed';
    writeSummary();

    // Some versions of the album uploader save immediately; others show
    // a separate «Сохранить»/«Готово» button. Click only an unambiguous
    // visible confirmation on this already-opened uploader.
    const confirmations = [
      /^Сохранить(?: фотографии| фото)?$/i,
      /^Готово$/i,
      /^Завершить$/i,
    ];
    let newIds = [];
    const until = Date.now() + 35_000;
    while (Date.now() < until) {
      await page.waitForTimeout(1400);
      const after = await getVisiblePhotoIds(page);
      newIds = [...after].filter(id => !before.has(id));
      if (newIds.length > 0) break;

      if (!summary.save_clicked) {
        for (const pattern of confirmations) {
          const matching = page.getByRole('button', { name: pattern });
          if (await matching.count() !== 1) continue;
          if (!await matching.isVisible()) continue;
          const disabled = await matching.isDisabled();
          if (disabled) continue;
          await matching.click();
          summary.save_clicked = true;
          console.log('Нажал подтверждение сохранения фотографии.');
          break;
        }
      }
    }

    // VK replaces the gallery with a single just-uploaded thumbnail. In that
    // view photo-<owner>_<id> often isn't present in document HTML. Once the
    // upload has settled, reopen the album and compare its full list with the
    // pre-upload snapshot. This is read-only and never uploads twice.
    if (newIds.length === 0) {
      console.log('Обновляю альбом и сравниваю список фотографий до и после загрузки...');
      try {
        await page.goto(ALBUM_URL, { waitUntil: 'commit', timeout: 30000 });
        await page.getByRole('button', { name: 'Добавить фотографии' })
          .waitFor({ state: 'visible', timeout: 25000 });
        await page.waitForTimeout(2000);
        const afterReload = await getVisiblePhotoIds(page);
        summary.photos_visible_after_reload = afterReload.size;
        newIds = [...afterReload].filter(id => !before.has(id));
      } catch (error) {
        summary.reload_warning = String(error?.message ?? error).slice(0, 200);
      }
    }

    await Promise.race([
      Promise.allSettled([...pendingResponses]),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    summary.network_photo_ids = [...networkPhotos].sort();
    summary.new_photo_ids = newIds.sort();
    summary.current_page = page.url();
    summary.buttons_after_upload = (await visibleButtonNames(page)).slice(0, 30);

    try {
      await page.screenshot({ path: path.join(LOG_DIR, 'after-upload.png'), fullPage: false, timeout: 8000 });
    } catch { /* Screenshot failure must not discard the upload result. */ }

    if (newIds.length === 1) {
      summary.status = 'candidate-photo-id-found-needs-visual-check';
      summary.photo_url = `https://vk.ru/photo-${GROUP_ID}_${newIds[0]}`;
      console.log('\nНайдена новая фотография в альбоме:');
      console.log(summary.photo_url);
      console.log('Пожалуйста, проверьте, что ссылка ведёт именно на загруженный файл.');
    } else if (newIds.length > 1) {
      summary.status = 'several-new-photo-ids-review-required';
      console.log(`\nВ альбоме появились ${newIds.length} новых ID — определить единственный автоматически не удалось.`);
    } else if (networkPhotos.size > 0) {
      summary.status = 'network-candidate-review-required';
      console.log('\nVK вернул ID фотографий в сетевых ответах, но новая фотография пока не обнаружена в альбоме.');
      console.log('Возможные ID: ' + [...networkPhotos].join(', '));
    } else {
      summary.status = 'not-confirmed';
      console.log('\nФайл передан в браузер, но подтверждения сохранения новой фотографии НЕТ.');
      console.log('Нельзя пока считать эту часть автопостинга рабочей.');
    }
    console.log(`Диагностика: ${SUMMARY_FILE}`);
    console.log(`Скриншот: ${path.join(LOG_DIR, 'after-upload.png')}`);
    writeSummary();
    if (summary.status !== 'candidate-photo-id-found-needs-visual-check') {
      console.log('Если требуется, откройте скриншот и пришлите результат или ссылку новой фотографии.');
    }
    return summary.status === 'candidate-photo-id-found-needs-visual-check' ? 0 : 3;
  } catch (error) {
    // Capture the actual browser state for any early failure. Never save HTML,
    // cookies or session values in diagnostics.
    summary.current_page = page && !page.isClosed() ? page.url() : 'unavailable';
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({ path: path.join(LOG_DIR, 'error.png'), timeout: 8000 });
      } catch { /* Screenshot is best-effort only. */ }
    }
    writeSummary();
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

try {
  const exitCode = await run();
  process.exitCode = exitCode;
} catch (error) {
  summary.status = 'error';
  summary.error = String(error?.message ?? error).slice(0, 400);
  writeSummary();
  console.error('\nОШИБКА: ' + summary.error);
  console.error(`Диагностика: ${SUMMARY_FILE}`);
  process.exitCode = 1;
}
