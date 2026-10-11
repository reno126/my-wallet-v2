import { describe, expect, it } from 'vitest';

import { apiEnvironmentSchema } from './environment.js';

describe('API environment validation', () => {
  it('uses safe local defaults when values are absent', () => {
    expect(apiEnvironmentSchema.parse({ NODE_ENV: 'test' })).toStrictEqual({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      PORT: 3000,
      CORS_ALLOWED_ORIGINS: [],
      API_TRUSTED_PROXY_CIDRS: [],
      API_HTTPS_ENABLED: false,
      API_RATE_LIMIT_MAX: 100,
      API_RATE_LIMIT_TIME_WINDOW_MS: 60_000,
      BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      DATABASE_URL:
        'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_dev?schema=public',
      DATABASE_POOL_MAX: 10,
      DATABASE_CONNECT_TIMEOUT_MS: 5_000,
      DATABASE_IDLE_TIMEOUT_MS: 30_000,
    });
  });

  it('coerces a configured port and preserves an explicit host', () => {
    expect(
      apiEnvironmentSchema.parse({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.2',
        PORT: '3100',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://wallet.example',
        API_TRUSTED_PROXY_CIDRS: '127.0.0.1, 10.1.0.0/16',
        API_HTTPS_ENABLED: 'true',
        API_RATE_LIMIT_MAX: '120',
        API_RATE_LIMIT_TIME_WINDOW_MS: '30000',
        DATABASE_URL: 'postgresql://wallet:local@127.0.0.1:5432/wallet_dev?schema=public',
        DATABASE_POOL_MAX: '12',
        DATABASE_CONNECT_TIMEOUT_MS: '7000',
        DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toStrictEqual({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.2',
      PORT: 3100,
      CORS_ALLOWED_ORIGINS: ['http://localhost:5173', 'https://wallet.example'],
      API_TRUSTED_PROXY_CIDRS: ['127.0.0.1', '10.1.0.0/16'],
      API_HTTPS_ENABLED: true,
      API_RATE_LIMIT_MAX: 120,
      API_RATE_LIMIT_TIME_WINDOW_MS: 30_000,
      BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      DATABASE_URL: 'postgresql://wallet:local@127.0.0.1:5432/wallet_dev?schema=public',
      DATABASE_POOL_MAX: 12,
      DATABASE_CONNECT_TIMEOUT_MS: 7_000,
      DATABASE_IDLE_TIMEOUT_MS: 45_000,
    });
  });

  it('rejects unsupported runtime modes and invalid ports', () => {
    expect(apiEnvironmentSchema.safeParse({ NODE_ENV: 'preview' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ PORT: '65536' }).success).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({ CORS_ALLOWED_ORIGINS: 'https://wallet.example/path' })
        .success,
    ).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({ CORS_ALLOWED_ORIGINS: 'ftp://wallet.example' }).success,
    ).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ API_TRUSTED_PROXY_CIDRS: '*' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ API_TRUSTED_PROXY_CIDRS: 'uniquelocal' }).success).toBe(
      false,
    );
    expect(apiEnvironmentSchema.safeParse({ API_TRUSTED_PROXY_CIDRS: '10.0.0.0/99' }).success).toBe(
      false,
    );
    expect(apiEnvironmentSchema.safeParse({ API_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }).success).toBe(
      false,
    );
    expect(apiEnvironmentSchema.safeParse({ API_HTTPS_ENABLED: 'yes' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ API_RATE_LIMIT_MAX: '0' }).success).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({ DATABASE_URL: 'mysql://localhost/wallet' }).success,
    ).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ DATABASE_POOL_MAX: '0' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ NODE_ENV: 'production' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ NODE_ENV: 'development' }).success).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'short' })
        .success,
    ).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production',
        BETTER_AUTH_URL: 'https://api.wallet.example',
        WEB_ORIGIN: 'https://wallet.example',
        DATABASE_URL: 'postgresql://wallet:password@db.wallet.example:5432/wallet?schema=public',
      }).success,
    ).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: 'local-development-secret-with-at-least-32-bytes',
        WEB_ORIGIN: 'https://wallet.example/path',
      }).success,
    ).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'production-secret-value-that-is-more-than-32-characters',
      }).success,
    ).toBe(false);
  });
});
