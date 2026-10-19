import { describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/lib/api/requestApiResult';

import { appDictionary } from '../../appDictionary';
import { pageFailureSchema } from './pageFailure';
import { requirePageData } from './requirePageData';

const options = { title: 'Portfolio', message: 'Could not load portfolio.' };

function captureFailure(error: ApiFailure, hideForbidden = false): Response {
  try {
    requirePageData({ ok: false, error }, { ...options, hideForbidden });
  } catch (failure) {
    if (failure instanceof Response) return failure;
    throw failure;
  }
  throw new Error('Expected a route response.');
}

describe('when requiring data to render a page', () => {
  it('should return successful data without changing its identity', () => {
    // Arrange
    const value = { quantity: '0.12345678' };
    // Act
    const result = requirePageData({ ok: true, value }, options);
    // Assert
    expect(result).toBe(value);
  });

  it('should redirect an expired API session to login', () => {
    // Act
    const failure = captureFailure({ kind: 'http', status: 401 });
    // Assert
    expect(failure.status).toBe(302);
    expect(failure.headers.get('location')).toBe('/login');
  });

  it.each([false, true])(
    'should conceal forbidden resources only when requested (%s)',
    async (hideForbidden) => {
      // Act
      const failure = captureFailure({ kind: 'http', status: 403 }, hideForbidden);
      const content = pageFailureSchema.parse(await failure.json());
      // Assert
      expect(failure.status).toBe(hideForbidden ? 404 : 403);
      expect(content.title).toBe(
        hideForbidden
          ? appDictionary.pageErrors.unavailableTitle
          : appDictionary.pageErrors.forbiddenTitle,
      );
    },
  );

  it.each([
    { error: { kind: 'network' }, status: 503 },
    { error: { kind: 'invalid-response' }, status: 502 },
    { error: { kind: 'http', status: 500 }, status: 500 },
  ] satisfies { error: ApiFailure; status: number }[])(
    'should expose safe page guidance for $error.kind',
    async ({ error, status }) => {
      // Act
      const failure = captureFailure(error);
      // Assert
      expect(failure.status).toBe(status);
      expect(pageFailureSchema.parse(await failure.json())).toMatchObject(options);
    },
  );

  it('should preserve the request throttle deadline', async () => {
    // Arrange
    const before = Date.now();
    // Act
    const failure = captureFailure({ kind: 'http', status: 429, retryAfterSeconds: 30 });
    const after = Date.now();
    const content = pageFailureSchema.parse(await failure.json());
    // Assert
    expect(failure.status).toBe(429);
    expect(content.retryAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(content.retryAt).toBeLessThanOrEqual(after + 30_000);
  });
});
