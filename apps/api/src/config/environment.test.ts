import { describe, expect, it } from 'vitest';

import { apiEnvironmentSchema } from './environment.js';

const validTestEnvironment = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'valid-test-environment-secret-with-32-characters',
};

const validProductionEnvironment = {
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'production-secret-value-that-is-more-than-32-characters',
  BETTER_AUTH_URL: 'https://api.wallet.example',
  WEB_ORIGIN: 'https://wallet.example',
  DATABASE_URL: 'postgresql://wallet:password@db.wallet.example:5432/wallet?schema=public',
};

function expectValidationIssue(environment: Record<string, unknown>, expectedPath: string) {
  const result = apiEnvironmentSchema.safeParse(environment);

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(`Expected validation to fail at ${expectedPath}.`);
  }

  expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(expectedPath);
}

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
      API_AUTH_RATE_LIMIT_MAX: 60,
      API_AUTHENTICATED_RATE_LIMIT_MAX: 300,
      BETTER_AUTH_RATE_LIMIT_ENABLED: false,
      BETTER_AUTH_RATE_LIMIT_MAX: 100,
      BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
      BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: 5,
      BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS: 60,
      BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      WEB_ORIGIN: 'http://localhost:5173',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      DATABASE_URL:
        'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_dev?schema=public',
      DATABASE_POOL_MAX: 10,
      DATABASE_CONNECT_TIMEOUT_MS: 5_000,
      DATABASE_IDLE_TIMEOUT_MS: 30_000,
    });
  });

  it('accepts a complete production environment', () => {
    expect(apiEnvironmentSchema.parse(validProductionEnvironment)).toMatchObject({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: validProductionEnvironment.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: validProductionEnvironment.BETTER_AUTH_URL,
      WEB_ORIGIN: validProductionEnvironment.WEB_ORIGIN,
      DATABASE_URL: validProductionEnvironment.DATABASE_URL,
    });
  });

  it('coerces numeric environment values', () => {
    expect(
      apiEnvironmentSchema.parse({
        ...validTestEnvironment,
        PORT: '3100',
        API_RATE_LIMIT_MAX: '120',
        API_RATE_LIMIT_TIME_WINDOW_MS: '30000',
        API_AUTH_RATE_LIMIT_MAX: '50',
        API_AUTHENTICATED_RATE_LIMIT_MAX: '600',
        BETTER_AUTH_RATE_LIMIT_MAX: '80',
        BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS: '120',
        BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: '3',
        BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS: '90',
        DATABASE_POOL_MAX: '12',
        DATABASE_CONNECT_TIMEOUT_MS: '7000',
        DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toMatchObject({
      PORT: 3100,
      API_RATE_LIMIT_MAX: 120,
      API_RATE_LIMIT_TIME_WINDOW_MS: 30_000,
      API_AUTH_RATE_LIMIT_MAX: 50,
      API_AUTHENTICATED_RATE_LIMIT_MAX: 600,
      BETTER_AUTH_RATE_LIMIT_MAX: 80,
      BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS: 120,
      BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: 3,
      BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS: 90,
      DATABASE_POOL_MAX: 12,
      DATABASE_CONNECT_TIMEOUT_MS: 7_000,
      DATABASE_IDLE_TIMEOUT_MS: 45_000,
    });
  });

  it('parses boolean flags', () => {
    expect(
      apiEnvironmentSchema.parse({
        ...validTestEnvironment,
        API_HTTPS_ENABLED: 'true',
        BETTER_AUTH_RATE_LIMIT_ENABLED: 'true',
      }),
    ).toMatchObject({
      API_HTTPS_ENABLED: true,
      BETTER_AUTH_RATE_LIMIT_ENABLED: true,
    });
  });

  it('splits, trims, and omits empty origins and trusted proxy entries', () => {
    expect(
      apiEnvironmentSchema.parse({
        ...validTestEnvironment,
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173, , https://wallet.example ',
        API_TRUSTED_PROXY_CIDRS: '127.0.0.1, , 10.1.0.0/16 ',
      }),
    ).toMatchObject({
      CORS_ALLOWED_ORIGINS: ['http://localhost:5173', 'https://wallet.example'],
      API_TRUSTED_PROXY_CIDRS: ['127.0.0.1', '10.1.0.0/16'],
    });
  });

  it('preserves explicitly configured host, auth origins, and database URL', () => {
    expect(
      apiEnvironmentSchema.parse({
        ...validTestEnvironment,
        API_HOST: '127.0.0.2',
        BETTER_AUTH_URL: 'https://api.wallet.example',
        WEB_ORIGIN: 'https://wallet.example',
        DATABASE_URL: 'postgresql://wallet:local@127.0.0.1:5432/wallet_dev?schema=public',
      }),
    ).toMatchObject({
      API_HOST: '127.0.0.2',
      BETTER_AUTH_URL: 'https://api.wallet.example',
      WEB_ORIGIN: 'https://wallet.example',
      DATABASE_URL: 'postgresql://wallet:local@127.0.0.1:5432/wallet_dev?schema=public',
    });
  });

  it.each([
    ['an unsupported runtime mode', { NODE_ENV: 'preview' }, 'NODE_ENV'],
    ['a port above the valid range', { PORT: '65536' }, 'PORT'],
    [
      'a CORS origin with a path',
      { CORS_ALLOWED_ORIGINS: 'https://wallet.example/path' },
      'CORS_ALLOWED_ORIGINS',
    ],
    [
      'a non-HTTP CORS origin',
      { CORS_ALLOWED_ORIGINS: 'ftp://wallet.example' },
      'CORS_ALLOWED_ORIGINS',
    ],
    [
      'a path in the Better Auth URL',
      { BETTER_AUTH_URL: 'https://api.wallet.example/path' },
      'BETTER_AUTH_URL',
    ],
    ['a path in the web origin', { WEB_ORIGIN: 'https://wallet.example/path' }, 'WEB_ORIGIN'],
    ['a wildcard trusted proxy', { API_TRUSTED_PROXY_CIDRS: '*' }, 'API_TRUSTED_PROXY_CIDRS'],
    [
      'a proxy hostname instead of an IP address',
      { API_TRUSTED_PROXY_CIDRS: 'uniquelocal' },
      'API_TRUSTED_PROXY_CIDRS',
    ],
    [
      'an out-of-range IPv4 prefix',
      { API_TRUSTED_PROXY_CIDRS: '10.0.0.0/99' },
      'API_TRUSTED_PROXY_CIDRS',
    ],
    [
      'an IPv4 catch-all proxy range',
      { API_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' },
      'API_TRUSTED_PROXY_CIDRS',
    ],
    [
      'an IPv6 catch-all proxy range',
      { API_TRUSTED_PROXY_CIDRS: '::/0' },
      'API_TRUSTED_PROXY_CIDRS',
    ],
    ['an unsupported HTTPS flag', { API_HTTPS_ENABLED: 'yes' }, 'API_HTTPS_ENABLED'],
    ['a zero public rate limit', { API_RATE_LIMIT_MAX: '0' }, 'API_RATE_LIMIT_MAX'],
    ['a zero auth rate limit', { API_AUTH_RATE_LIMIT_MAX: '0' }, 'API_AUTH_RATE_LIMIT_MAX'],
    [
      'an authenticated rate limit above its maximum',
      { API_AUTHENTICATED_RATE_LIMIT_MAX: '100001' },
      'API_AUTHENTICATED_RATE_LIMIT_MAX',
    ],
    [
      'an unsupported Better Auth rate-limit flag',
      { BETTER_AUTH_RATE_LIMIT_ENABLED: 'yes' },
      'BETTER_AUTH_RATE_LIMIT_ENABLED',
    ],
    [
      'a zero credential rate limit',
      { BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: '0' },
      'BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX',
    ],
    ['a non-PostgreSQL database URL', { DATABASE_URL: 'mysql://localhost/wallet' }, 'DATABASE_URL'],
    ['a zero database pool size', { DATABASE_POOL_MAX: '0' }, 'DATABASE_POOL_MAX'],
  ] satisfies ReadonlyArray<readonly [string, Record<string, unknown>, string]>)(
    'rejects %s',
    (_description, overrides, expectedPath) => {
      expectValidationIssue({ ...validTestEnvironment, ...overrides }, expectedPath);
    },
  );

  it.each([
    ['a missing secret', { BETTER_AUTH_SECRET: undefined }, 'BETTER_AUTH_SECRET'],
    ['a short secret', { BETTER_AUTH_SECRET: 'short' }, 'BETTER_AUTH_SECRET'],
    [
      'the test-only secret',
      { BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production' },
      'BETTER_AUTH_SECRET',
    ],
  ] satisfies ReadonlyArray<readonly [string, Record<string, unknown>, string]>)(
    'requires a non-test secret in development: %s',
    (_description, overrides, expectedPath) => {
      expectValidationIssue(
        { ...validTestEnvironment, NODE_ENV: 'development', ...overrides },
        expectedPath,
      );
    },
  );

  it.each([
    ['a missing secret', { BETTER_AUTH_SECRET: undefined }, 'BETTER_AUTH_SECRET'],
    [
      'the test-only secret',
      { BETTER_AUTH_SECRET: 'test-only-secret-that-is-never-valid-in-production' },
      'BETTER_AUTH_SECRET',
    ],
    ['a missing auth URL', { BETTER_AUTH_URL: undefined }, 'BETTER_AUTH_URL'],
    ['a missing web origin', { WEB_ORIGIN: undefined }, 'WEB_ORIGIN'],
    ['a missing explicit database URL', { DATABASE_URL: undefined }, 'DATABASE_URL'],
  ] satisfies ReadonlyArray<readonly [string, Record<string, unknown>, string]>)(
    'rejects production configuration with %s',
    (_description, overrides, expectedPath) => {
      expectValidationIssue({ ...validProductionEnvironment, ...overrides }, expectedPath);
    },
  );
});
