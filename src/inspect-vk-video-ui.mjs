// Read-only inspection of the logged-in community VIDEO upload interface.
// May open the two "Add" menus, but never chooses a file, saves a video,
// starts an upload, or publishes a wall post.
// Diagnostics are local to the owner's Windows account, never pushed to GitHub.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const GROUP_ID = '211038294';
const ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const PROFILE = path.join(ROOT, 'browser-profile');
const ID = new Date().toISOString().replace(/[:.]/g, '-');
const DIAG = path.join(ROOT, 'video-ui-inspection', ID);
const VIDEO_URL = `https://vk.ru/videos-${GROUP_ID}`;
const COMMUNITY_URL = `https://vk.ru/club${GROUP_ID}`;

if (process.argv.includes('--self-test')) {
  console.log('READ_ONLY_INSPECTION=true');
  process.exit(0);
}

let context;
try {
  if (process.platform !== 'win32') throw new Error('This inspector needs the existing Windows Chrome profile');
  if (!fs.existsSync(PROFILE)) throw new Error('Chrome profile missing; photo staging must work first');
  fs.mkdirSync(DIAG, { recursive: true });
  const { chromium } = await import('playwright');
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: false,
    locale: 'ru-RU', viewport: { width: 1380, height: 930 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(20_000);
  async function inspect(label, url, screenshotName) {
    console.log(`Inspecting ${label} (read only)...`);
    // Store only network status and host, never request URLs, payloads or credentials.
    const networkIssues = [];
    const onRequestFailed = request => {
      try {
        networkIssues.push({ kind: 'failed', origin: new URL(request.url()).origin,
          error: String(request.failure()?.errorText ?? 'unknown').slice(0, 80) });
      } catch { /* Ignore malformed diagnostic URLs. */ }
    };
    const onBadResponse = response => {
      if (response.status() < 400) return;
      try {
        networkIssues.push({ kind: 'http', origin: new URL(response.url()).origin, status: response.status() });
      } catch { /* Ignore malformed diagnostic URLs. */ }
    };
    page.on('requestfailed', onRequestFailed);
    page.on('response', onBadResponse);
    try { await page.goto(url, { waitUntil: 'commit', timeout: 30_000 }); }
    catch { console.log(`${label}: navigation is slow, waiting for page content...`); }
    // VK's sidebar alone can have 269–533 characters while the main page is
    // completely grey. Never mistake this for a loaded video/community page.
    const until = Date.now() + 30_000;
    let probe = { text_length: 0, headings: [], visible_skeletons: 0 };
    while (Date.now() < until) {
      await page.waitForTimeout(2_000);
      probe = await page.evaluate(() => {
        const visible = node => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return {
          text_length: (document.body?.innerText || '').trim().length,
          headings: Array.from(document.querySelectorAll('h1, h2')).filter(visible)
            .slice(0, 8).map(node => (node.innerText || '').trim().slice(0, 80)),
          visible_skeletons: Array.from(document.querySelectorAll('[class*="keleton" i], [aria-busy="true"]'))
            .filter(visible).length,
        };
      }).catch(() => probe);
      // This generous threshold is intentional. In the attached screenshots,
      // both pages had only the navigation shell, not actual group content.
      if (probe.text_length >= (label === 'VK Video' ? 900 : 1_200) && probe.visible_skeletons === 0) break;
    }
    // Only labels and safe public paths. Never save response bodies, cookies,
    // tokens, HTML, network logs or arbitrary page content.
    const buttons = await page.getByRole('button').evaluateAll(nodes => nodes
      .filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
      .slice(0, 70)
      .map(node => (node.getAttribute('aria-label') || node.textContent || node.title || '').trim().slice(0, 95))
      .filter(Boolean)).catch(() => []);
    const relevantLinks = await page.locator('a[href]').evaluateAll(nodes => nodes
      .filter(node => /видео|загруз|добавить|video|upload/i.test((node.textContent || '').trim()))
      .slice(0, 25)
      .map(node => ({ text: (node.textContent || '').trim().slice(0, 65),
        path: (() => { try { const u = new URL(node.href); return u.pathname.slice(0, 150); } catch { return ''; } })() })))
      .catch(() => []);
    const pageUrl = new URL(page.url());
    page.off('requestfailed', onRequestFailed);
    page.off('response', onBadResponse);
    const uniqueIssues = Array.from(new Map(networkIssues.map(issue => [JSON.stringify(issue), issue])).values()).slice(0, 20);
    const isLoaded = probe.text_length >= (label === 'VK Video' ? 900 : 1_200)
      && probe.visible_skeletons === 0;
    const state = {
      label, page: `${pageUrl.origin}${pageUrl.pathname}`,
      title: (await page.title().catch(() => '')).slice(0, 140),
      text_length: probe.text_length,
      render_state: isLoaded ? 'content-present' : 'skeleton-or-incomplete',
      visible_skeletons: probe.visible_skeletons,
      headings: probe.headings,
      network_issues: uniqueIssues,
      buttons, relevant_links: relevantLinks,
      upload_trigger_candidates: buttons.filter(value => /видео|загруз|добавить/i.test(value)),
      screenshot: path.join(DIAG, screenshotName),
    };
    try { await page.screenshot({ path: state.screenshot, timeout: 15_000 }); }
    catch { state.screenshot = 'not-captured'; }
    console.log(`${label}: ${state.page}; state=${state.render_state}; text_length=${probe.text_length}; skeletons=${probe.visible_skeletons}; network issues=${uniqueIssues.length}; visible candidates=${state.upload_trigger_candidates.join(' | ') || 'none'}`);
    console.log(`${label} screenshot: ${state.screenshot}`);
    return state;
  }

  const videoPage = await inspect('VK Video', VIDEO_URL, 'video-page.png');
  const addMenuProbes = [];
  let uploadFormProbe = null;
  if (videoPage.render_state === 'content-present') {
    const addButtons = page.getByRole('button', { name: 'Добавить', exact: true });
    const addCount = Math.min(await addButtons.count().catch(() => 0), 2);
    console.log(`VK Video: inspecting ${addCount} Add menu(s) without selecting any file...`);
    for (let i = 0; i < addCount; i++) {
      try {
        if (i > 0) {
          await page.goto(videoPage.page, { waitUntil: 'commit', timeout: 30_000 });
          await page.getByRole('button', { name: 'Добавить', exact: true }).nth(i)
            .waitFor({ state: 'visible', timeout: 30_000 });
        }
        // Playwright intercepts any native file chooser. Never call setFiles().
        const chooser = page.waitForEvent('filechooser', { timeout: 4_000 })
          .then(() => true).catch(() => false);
        await page.getByRole('button', { name: 'Добавить', exact: true }).nth(i)
          .click({ timeout: 8_000 });
        await page.waitForTimeout(800);
        const fileChooserOpened = await chooser;
        const actionLabels = await page.locator('button, [role="menuitem"], a').evaluateAll(nodes => nodes
          .filter(node => {
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map(node => (node.getAttribute('aria-label') || node.innerText || node.title || '').trim().slice(0, 95))
          .filter(value => /загруз|добавить|создать|видео|клип|файл/i.test(value))
          .slice(0, 35)).catch(() => []);
        const inputs = await page.locator('input[type="file"]').evaluateAll(nodes => nodes.map(node => ({
          accept: String(node.accept || '').slice(0, 70), multiple: !!node.multiple,
        }))).catch(() => []);
        const screenshot = path.join(DIAG, `video-add-menu-${i + 1}.png`);
        await page.screenshot({ path: screenshot, timeout: 15_000 }).catch(() => {});
        const openedUrl = new URL(page.url());
        addMenuProbes.push({ index: i + 1, file_chooser_opened: fileChooserOpened,
          page: `${openedUrl.origin}${openedUrl.pathname}`, action_labels: actionLabels,
          file_inputs: inputs, screenshot });
        console.log(`VK Video Add #${i + 1}: chooser=${fileChooserOpened}; actions=${actionLabels.join(' | ') || 'none'}; screenshot=${screenshot}`);
      } catch (error) {
        addMenuProbes.push({ index: i + 1, error: String(error.message ?? error).slice(0, 130) });
        console.log(`VK Video Add #${i + 1}: menu inspection unavailable; continuing.`);
      }
    }
    // The second Add button belongs to the Solar House channel. Open its
    // "Upload video" entry to inspect the form, but NEVER provide a filename.
    if (addCount === 2 && addMenuProbes.some(result => result.index === 2 && !result.error)) {
      try {
        console.log('VK Video: inspecting channel upload form (no file selected)...');
        const uploadEntry = page.getByText('Загрузить видео', { exact: true }).first();
        await uploadEntry.waitFor({ state: 'visible', timeout: 8_000 });
        const cabinetNetworkIssues = [];
        let cabinetPageErrors = 0;
        const onCabinetPage = newPage => {
          newPage.on('requestfailed', request => {
            try { cabinetNetworkIssues.push({ kind: 'failed', origin: new URL(request.url()).origin,
              error: String(request.failure()?.errorText ?? 'unknown').slice(0, 65) }); } catch {}
          });
          newPage.on('response', response => {
            if (response.status() < 400) return;
            try { cabinetNetworkIssues.push({ kind: 'http', origin: new URL(response.url()).origin,
              status: response.status() }); } catch {}
          });
          newPage.on('pageerror', () => { cabinetPageErrors++; });
        };
        context.on('page', onCabinetPage);
        const chooser = page.waitForEvent('filechooser', { timeout: 5_000 })
          .then(() => true).catch(() => false);
        const popup = context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
        await uploadEntry.click({ timeout: 8_000 });
        await page.waitForTimeout(1_500);
        const popupPage = await popup;
        const fileChooserOpened = await chooser;
        const formPage = popupPage ?? page;
        await formPage.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => {});
        // VK Video creator cabinet is a separate SPA. Its new tab may be an
        // entirely grey blank shell for 10–30 seconds after DOMContentLoaded.
        const deadline = Date.now() + 38_000;
        let formRender = { text_length: 0, control_count: 0, headings: [] };
        while (Date.now() < deadline) {
          await formPage.waitForTimeout(2_000);
          formRender = await formPage.evaluate(() => ({
            text_length: (document.body?.innerText || '').trim().length,
            control_count: document.querySelectorAll('button, input, textarea, [role="button"]').length,
            headings: Array.from(document.querySelectorAll('h1, h2'))
              .map(node => (node.innerText || '').trim().slice(0, 75)).filter(Boolean).slice(0, 7),
          })).catch(() => formRender);
          if (formRender.text_length > 350 && formRender.control_count > 2) break;
        }
        context.off('page', onCabinetPage);
        const formControls = await formPage.locator('input, textarea, select, [role="checkbox"], [role="radio"]').evaluateAll(nodes => nodes
          .slice(0, 50).map(node => ({
            tag: node.tagName.toLowerCase(), type: String(node.getAttribute('type') || '').slice(0, 35),
            placeholder: String(node.getAttribute('placeholder') || '').slice(0, 90),
            label: String(node.getAttribute('aria-label') || '').slice(0, 90),
            accept: String(node.getAttribute('accept') || '').slice(0, 65),
            checked: node.matches('[type="checkbox"], [role="checkbox"]') ? !!(node.checked || node.getAttribute('aria-checked') === 'true') : undefined,
          }))).catch(() => []);
        const actionLabels = await formPage.locator('button, [role="button"], [role="menuitem"]').evaluateAll(nodes => nodes
          .filter(node => {
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map(node => String(node.getAttribute('aria-label') || node.innerText || '').trim().slice(0, 100))
          .filter(Boolean).slice(0, 55)).catch(() => []);
        const dialogLabels = await formPage.locator('[role="dialog"], dialog').evaluateAll(nodes => nodes
          .filter(node => {
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }).map(node => String(node.innerText || '').slice(0, 900)).slice(0, 3)).catch(() => []);
        const screenshot = path.join(DIAG, 'video-upload-form.png');
        await formPage.screenshot({ path: screenshot, timeout: 15_000 }).catch(() => {});
        const opened = new URL(formPage.url());
        uploadFormProbe = { file_chooser_opened: fileChooserOpened,
          new_tab_opened: !!popupPage, page: `${opened.origin}${opened.pathname}`,
          title: (await formPage.title().catch(() => '')).slice(0, 140),
          render_state: formRender.text_length > 350 && formRender.control_count > 2 ? 'content-present' : 'blank-or-incomplete',
          render_probe: formRender, page_errors: cabinetPageErrors,
          network_issues: Array.from(new Map(cabinetNetworkIssues.map(issue => [JSON.stringify(issue), issue])).values()).slice(0, 22),
          form_controls: formControls, action_labels: actionLabels, dialog_labels: dialogLabels,
          screenshot };
        console.log(`VK Video upload form: state=${uploadFormProbe.render_state}; chooser=${fileChooserOpened}; new_tab=${!!popupPage}; controls=${formControls.length}; issues=${uploadFormProbe.network_issues.length}; screenshot=${screenshot}`);
      } catch (error) {
        uploadFormProbe = { error: String(error.message ?? error).slice(0, 180) };
        console.log(`VK Video upload form: inspection stopped: ${uploadFormProbe.error}`);
      }
    }
  }
  const communityPage = await inspect('VK community', COMMUNITY_URL, 'community-page.png');
  const diagnostics = {
    mode: 'READ-ONLY', community_id: GROUP_ID,
    pages: [videoPage, communityPage], add_menu_probes: addMenuProbes,
    upload_form_probe: uploadFormProbe,
    inspected_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DIAG, 'result.json'), JSON.stringify(diagnostics, null, 2) + '\n', 'utf8');
  console.log('SOLAR HOUSE VK — VIDEO INTERFACE INSPECTED (READ ONLY)');
  console.log(`Video page screenshot: ${videoPage.screenshot}`);
  console.log(`Community page screenshot: ${communityPage.screenshot}`);
  console.log(`Report: ${path.join(DIAG, 'result.json')}`);
  console.log('No video selected, uploaded or posted.');
} catch (error) {
  console.error('INSPECTION ERROR: ' + String(error.message ?? error).slice(0, 270));
  console.error('Read-only inspection made no video upload or wall publication.');
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
}
