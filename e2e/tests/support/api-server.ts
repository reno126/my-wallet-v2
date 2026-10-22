import type { Page } from '@playwright/test';

import type { FmpPluginDependencies } from '../../../apps/api/src/plugin-options';

export async function startBrowserApi(fmp?: FmpPluginDependencies) {
  const databaseUrl = process.env['DATABASE_URL'];
  if (process.env['NODE_ENV'] !== 'test' || !databaseUrl) {
    throw new Error('Database browser journeys require the explicit wallet_test environment.');
  }
  const target = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/wallet_test') {
    throw new Error('Database browser journeys may only use the local wallet_test database.');
  }
  const { createTestServer } = await import('../../../apps/api/test-support/create-test-server');
  const server = createTestServer(
    {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: 'http://127.0.0.1:5173',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      FMP_API_KEY: fmp ? 'browser-test-only-provider-key' : '',
      FMP_BASE_URL: 'http://127.0.0.1/stable/',
    },
    fmp ? { fmp } : {},
  );
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    return {
      server,
      async close() {
        server.server.closeAllConnections();
        await server.close();
      },
      async connect(page: Page) {
        await page.route(
          (url) => url.pathname.startsWith('/api/'),
          (route) => {
            const url = new URL(route.request().url());
            return route.continue({ url: new URL(url.pathname + url.search, address).href });
          },
        );
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
