export async function checkBlockedAuthStartup(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let blocked = 0;
  try {
    await context.route('**/auth/v1/**', () => {
      blocked++;
      return new Promise(() => {});
    });
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: 1, sub: '00000000-0000-0000-0000-000000000001' })}.testsignature`;
    await context.addInitScript(({ token }) => {
      localStorage.setItem('sb-cbwhmouuckrqnhvfnaol-auth-token', JSON.stringify({
        access_token: token, refresh_token: 'isolated-monitor-placeholder', token_type: 'bearer', expires_at: 1,
        user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' },
      }));
    }, { token });
    const page = await context.newPage();
    await page.goto('https://gamewire.us/?auth-startup-check=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('.auth-page').waitFor({ state: 'visible', timeout: 25000 });
    if (!blocked) throw new Error('Saved-session monitor did not intercept a refresh request');
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });
    return { ok: true, blockedRefresh: true, guestRecovery: true };
  } finally { await context.close(); }
}

export async function checkBlockedSignIn(browser, siteUrl = 'https://gamewire.us/') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let blocked = 0;
  try {
    await context.route('**/auth/v1/**', () => { blocked++; return new Promise(() => {}); });
    const page = await context.newPage();
    const url = new URL(siteUrl);
    url.searchParams.set('sign-in-check', String(Date.now()));
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email', { exact: true }).fill('monitor@example.invalid');
    await page.locator('input[autocomplete="current-password"]').fill('isolated-monitor-placeholder');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.auth-error').waitFor({ state: 'visible', timeout: 25000 });
    await page.getByRole('button', { name: 'Reload sign-in connection', exact: true }).waitFor({ state: 'visible' });
    if (!blocked || !await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled())
      throw new Error('Blocked sign-in did not release its loading state');
    return { ok: true, blockedRequest: true, retryAvailable: true };
  } finally { await context.close(); }
}
