import { describe, expect, it } from 'vitest';

import { apiEnvironmentSchema } from './environment.js';

describe('API environment validation', () => {
  it('uses safe local defaults when values are absent', () => {
    expect(apiEnvironmentSchema.parse({})).toStrictEqual({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      PORT: 3000,
    });
  });

  it('coerces a configured port and preserves an explicit host', () => {
    expect(
      apiEnvironmentSchema.parse({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.2',
        PORT: '3100',
      }),
    ).toStrictEqual({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.2',
      PORT: 3100,
    });
  });

  it('rejects unsupported runtime modes and invalid ports', () => {
    expect(apiEnvironmentSchema.safeParse({ NODE_ENV: 'preview' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ PORT: '65536' }).success).toBe(false);
  });
});
