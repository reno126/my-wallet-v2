import { expect, test } from '@playwright/test';

test('the hosted preview serves deep links, revalidates HTML and preserves asset 404s', async ({
  request,
}) => {
  for (const path of [
    '/login',
    '/register',
    '/wallets/8b82af32-9f56-49b2-85b5-5a0613479118',
    '/wallets/8b82af32-9f56-49b2-85b5-5a0613479118/instruments/BRK.B',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['cache-control']).toMatch(/no-cache|max-age=0/);
    expect(response.headers()['strict-transport-security']).toMatch(/max-age=[1-9]\d*/);
    const policyHeader =
      process.env['DEPLOYMENT_CSP_MODE'] === 'enforced'
        ? 'content-security-policy'
        : 'content-security-policy-report-only';
    expect(response.headers()[policyHeader]).toContain("script-src 'self'");
  }
  for (const path of ['/assets/deployment-smoke-missing.js', '/deployment-smoke-missing.css']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const html = await (await request.get('/')).text();
  const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
  if (!asset) {
    throw new Error('Expected a fingerprinted production JavaScript asset.');
  }
  const response = await request.get(asset);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('immutable');
});

test('the same-origin proxy returns API JSON and private authentication failures without caching', async ({
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  const privateResponse = await request.get('/api/wallets');
  expect(privateResponse.status()).toBe(401);
  expect(privateResponse.headers()['content-type']).toContain('application/json');
  expect(privateResponse.headers()['cache-control']).toContain('no-store');
  expect(privateResponse.headers()['strict-transport-security']).toMatch(/max-age=[1-9]\d*/);
});

test('the browser loads the hosted login screen and preserves a private deep-link redirect', async ({
  page,
}) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.log(`csp-violation:${event.effectiveDirective}:${event.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (message.text().startsWith('csp-violation:')) {
      violations.push(message.text());
    }
  });
  await page.goto('/wallets/8b82af32-9f56-49b2-85b5-5a0613479118');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  expect(violations).toEqual([]);
});
