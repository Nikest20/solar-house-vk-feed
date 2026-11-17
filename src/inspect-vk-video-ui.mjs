// Read-only inspection of the logged-in community VIDEO upload interface.
// Does not click upload, choose a file, save a video, or publish a wall post.
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
    try { await page.goto(url, { waitUntil: 'commit', timeout: 30_000 }); }
    catch { console.log(`${label}: navigation is slow, waiting for page content...`); }
    // VK Video initially renders a completely grey skeleton. Waiting just 4s
    // produces a false "no upload button" result; wait for actual content.
    const until = Date.now() + 26_000;
    let textLength = 0;
    while (Date.now() < until) {
      await page.waitForTimeout(2_000);
      textLength = await page.locator('body').evaluate(node => (node.innerText || '').trim().length)
        .catch(() => 0);
      if (textLength >= (label === 'VK Video' ? 180 : 260)) break;
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
    const state = {
      label, page: `${pageUrl.origin}${pageUrl.pathname}`,
      title: (await page.title().catch(() => '')).slice(0, 140),
      text_length: textLength, render_state: textLength < 180 ? 'possibly-still-loading' : 'content-present',
      buttons, relevant_links: relevantLinks,
      upload_trigger_candidates: buttons.filter(value => /видео|загруз|добавить/i.test(value)),
      screenshot: path.join(DIAG, screenshotName),
    };
    try { await page.screenshot({ path: state.screenshot, timeout: 15_000 }); }
    catch { state.screenshot = 'not-captured'; }
    console.log(`${label}: ${state.page}; text_length=${textLength}; visible candidates=${state.upload_trigger_candidates.join(' | ') || 'none'}`);
    console.log(`${label} screenshot: ${state.screenshot}`);
    return state;
  }

  const videoPage = await inspect('VK Video', VIDEO_URL, 'video-page.png');
  const communityPage = await inspect('VK community', COMMUNITY_URL, 'community-page.png');
  const diagnostics = {
    mode: 'READ-ONLY', community_id: GROUP_ID,
    pages: [videoPage, communityPage],
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
