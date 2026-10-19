import { describe, expect, it, vi } from 'vitest';
import { z as zod } from 'zod';

import { createFmpClient } from './client.js';

const environment = {
  FMP_API_KEY: 'test-only-fmp-key',
  FMP_BASE_URL: 'https://provider.test.example/stable/',
};
const responseSchema = zod.array(zod.object({ symbol: zod.string() }));
const searchRequest = {
  endpoint: 'search-symbol',
  parameters: { query: 'AAPL' },
  responseSchema,
} satisfies Parameters<ReturnType<typeof createFmpClient>['request']>[0];

describe('when an FMP request cannot be dispatched', () => {
  it('should leave quota untouched when the API key is absent', async () => {
    // Arrange
    const reserveRequest = vi.fn<() => Promise<boolean>>();
    const fetchRequest = vi.fn<typeof fetch>();
    const client = createFmpClient({
      environment: { ...environment, FMP_API_KEY: '' },
      reserveRequest,
      fetch: fetchRequest,
    });

    // Act
    const result = await client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'NOT_CONFIGURED' } });
    expect(reserveRequest).not.toHaveBeenCalled();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each(['apikey', 'APIKEY', 'invalid-key'])(
    'should reject the parameter %s before reserving',
    async (key) => {
      // Arrange
      const reserveRequest = vi.fn<() => Promise<boolean>>();
      const fetchRequest = vi.fn<typeof fetch>();
      const client = createFmpClient({ environment, reserveRequest, fetch: fetchRequest });

      // Act
      const result = await client.request({ ...searchRequest, parameters: { [key]: 'untrusted' } });

      // Assert
      expect(result).toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(reserveRequest).not.toHaveBeenCalled();
      expect(fetchRequest).not.toHaveBeenCalled();
    },
  );

  it('should fail closed when quota is exhausted', async () => {
    // Arrange
    const fetchRequest = vi.fn<typeof fetch>();
    const client = createFmpClient({
      environment,
      reserveRequest: () => Promise.resolve(false),
      fetch: fetchRequest,
    });

    // Act
    const result = await client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'QUOTA_EXHAUSTED' } });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('should sanitize reservation failures without dispatching', async () => {
    // Arrange
    const fetchRequest = vi.fn<typeof fetch>();
    const client = createFmpClient({
      environment,
      reserveRequest: () => Promise.reject(new Error('private database details')),
      fetch: fetchRequest,
    });

    // Act
    const result = await client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'QUOTA_UNAVAILABLE' } });
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

describe('when a dispatched FMP attempt fails', () => {
  it('should retain the charge and sanitize a transport exception containing the key', async () => {
    // Arrange
    let used = 0;
    const client = createFmpClient({
      environment,
      reserveRequest: () => Promise.resolve(++used <= 10),
      fetch: () => Promise.reject(new Error(`fetch failed: apikey=${environment.FMP_API_KEY}`)),
    });

    // Act
    const result = await client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'NETWORK_ERROR' } });
    expect(used).toBe(1);
  });

  it('should reserve again before an explicit retry and stop when no budget remains', async () => {
    // Arrange
    let used = 0;
    const fetchRequest = vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure'));
    const reserveRequest = vi.fn(() => Promise.resolve(used < 2 && ++used > 0));
    const client = createFmpClient({ environment, reserveRequest, fetch: fetchRequest });

    // Act
    const results = [
      await client.request(searchRequest),
      await client.request(searchRequest),
      await client.request(searchRequest),
    ];

    // Assert
    expect(results).toStrictEqual([
      { ok: false, error: { code: 'NETWORK_ERROR' } },
      { ok: false, error: { code: 'NETWORK_ERROR' } },
      { ok: false, error: { code: 'QUOTA_EXHAUSTED' } },
    ]);
    expect(used).toBe(2);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(reserveRequest).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 0.5, 60_001, Number.NaN])(
    'should reject an invalid timeout of %s',
    (timeoutMs) => {
      // Arrange
      const options = { environment, reserveRequest: () => Promise.resolve(true), timeoutMs };

      // Act
      // Assert
      expect(() => createFmpClient(options)).toThrow();
    },
  );
});
