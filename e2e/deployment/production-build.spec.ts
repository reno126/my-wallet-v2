import { expect, test } from '@playwright/test';

import configuration from '../../apps/web/vercel.json' with { type: 'json' };
import { startProductionWeb } from './support/production-web';

for (const mode of ['report-only', 'enforced'] as const) {
  test(`the production build loads deep links and forms under ${mode} CSP`, async ({ page }) => {
    const web = await startProductionWeb(mode);
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().startsWith('csp-violation:')) {
        violations.push(message.text());
      }
    });
    try {
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.log(`csp-violation:${event.effectiveDirective}:${event.blockedURI}`);
        });
      });
      await page.route(
        (url) => url.pathname.startsWith('/api/'),
        (route) => route.fulfill({ json: null }),
      );
      await page.goto(
        `${web.origin}/wallets/8b82af32-9f56-49b2-85b5-5a0613479118/instruments/BRK.B`,
      );
      await expect(page).toHaveURL(`${web.origin}/login`);
      await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
      await page.goto(`${web.origin}/register`);
      await page.getByRole('textbox', { name: /^name$/i }).fill('CSP preview investor');
      await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
      expect(violations).toEqual([]);

      const violation = await page.evaluate(
        () =>
          new Promise<{ directive: string; disposition: string } | null>((resolveViolation) => {
            const timeout = globalThis.setTimeout(() => resolveViolation(null), 2_000);
            document.addEventListener(
              'securitypolicyviolation',
              (event) => {
                globalThis.clearTimeout(timeout);
                resolveViolation({
                  directive: event.effectiveDirective,
                  disposition: event.disposition,
                });
              },
              { once: true },
            );
            const script = document.createElement('script');
            script.textContent = "document.title = 'unsafe-script-executed'";
            document.head.append(script);
          }),
      );
      expect(violation).toEqual({
        directive: 'script-src-elem',
        disposition: mode === 'enforced' ? 'enforce' : 'report',
      });
      if (mode === 'enforced') {
        await expect(page).toHaveTitle('My Wallet');
      } else {
        await expect(page).toHaveTitle('unsafe-script-executed');
      }
    } finally {
      await page.close();
      await web.close();
    }
  });
}

test('the static configuration keeps API, missing files and browser routes distinct', async ({
  request,
}) => {
  const web = await startProductionWeb('report-only');
  try {
    for (const path of [
      '/assets/missing.js',
      '/missing.css',
      '/.well-known/missing',
      '/api/unknown',
      '/api',
    ]) {
      expect((await request.get(web.origin + path)).status(), path).toBe(404);
    }
    for (const path of [
      '/',
      '/login',
      '/register',
      '/wallets',
      '/wallets/new',
      '/wallets/example/instruments/BRK.B',
      '/unknown-route',
    ]) {
      const response = await request.get(web.origin + path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-cache');
      expect(response.headers()['content-type']).toContain('text/html');
    }
    const html = await (await request.get(web.origin)).text();
    const assetPath = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
    expect(assetPath).toBeDefined();
    if (!assetPath) {
      throw new Error('The production index must reference its fingerprinted JavaScript asset.');
    }
    const asset = await request.get(web.origin + assetPath);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toContain('immutable');
    expect(asset.headers()['content-type']).toContain('javascript');
    expect(configuration.rewrites[0]).toMatchObject({ source: '/api/:path*' });
    const proxy = configuration.rewrites[0];
    expect(proxy?.destination.startsWith('https://')).toBe(true);
    expect(proxy?.destination.endsWith('/api/:path*')).toBe(true);
  } finally {
    await web.close();
  }
});
