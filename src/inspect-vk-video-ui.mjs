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
  }
  const communityPage = await inspect('VK community', COMMUNITY_URL, 'community-page.png');
  const diagnostics = {
    mode: 'READ-ONLY', community_id: GROUP_ID,
    pages: [videoPage, communityPage], add_menu_probes: addMenuProbes,
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
