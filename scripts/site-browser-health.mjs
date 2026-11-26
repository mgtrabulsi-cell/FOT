import { chromium } from 'playwright';
import { writeFile, appendFile } from 'node:fs/promises';
import { checkSite } from './site-health.mjs';
import { checkBlockedAuthStartup } from './auth-startup-health.mjs';

const report = { checkedAt: new Date().toISOString(), static: { ok: false }, browser: { ok: false },
  recoveryAllowed: false, runtimeErrorCount: 0, failedResponses: [] };
try {
  await checkSite();
  report.static.ok = true;
} catch (error) {
  report.static.error = error instanceof Error ? error.message : 'Static check failed';
  report.recoveryAllowed = /^assets\/[\w-]+\.(?:js|css) returned HTTP 404$/.test(report.static.error);
  console.error('Static availability check failed:', report.static.error);
}
let browser;
try {
  report.browser.stage = 'launch';
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('pageerror', () => { report.runtimeErrorCount++; });
  page.on('response', response => {
    if (response.status() < 400 || report.failedResponses.length >= 20) return;
    const url = new URL(response.url());
    report.failedResponses.push({ host: url.hostname, path: url.pathname, status: response.status() });
  });
  report.browser.stage = 'navigation';
  await page.goto('https://gamewire.us/?availability=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 });
  const guest = page.getByRole('button', { name: 'Continue as guest', exact: true });
  report.browser.stage = 'guest-entry';
  await guest.waitFor({ state: 'visible', timeout: 25000 });
  await guest.click();
  report.browser.stage = 'initial-render';
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  report.browser.stage = 'cached-session-reload';
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  report.browser.stage = 'foreground-resume';
  await page.evaluate(() => window.dispatchEvent(new Event('gamewire-app-active')));
  await page.waitForTimeout(3000);
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 5000 });
  if (report.runtimeErrorCount) throw new Error('Uncaught browser errors occurred');
  report.browser.stage = 'blocked-saved-session';
  report.savedSession = await checkBlockedAuthStartup(browser);
  report.browser.ok = true;
  report.browser.stage = 'complete';
} catch (error) {
  report.browser.errorType = error instanceof Error ? error.name : 'UnknownError';
  report.browser.error = error instanceof Error && /Executable doesn't exist/.test(error.message)
    ? 'Monitor browser is not installed' : 'Browser startup, guest access or cached-session reload failed';
  console.error('Browser availability check failed:', report.browser.error);
} finally {
  if (browser) await browser.close();
}
report.ok = report.static.ok && report.browser.ok;
await writeFile('site-health-report.json', JSON.stringify(report, null, 2));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  `healthy=${report.ok}\nrecovery_allowed=${report.recoveryAllowed}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
