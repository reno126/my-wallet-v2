import { z as zod } from 'zod';

import { apiErrorSchema } from '@my-wallets/contracts';

export type ApiFailure =
  | {
      kind: 'http';
      status: number;
      code?: zod.infer<typeof apiErrorSchema>['error']['code'];
      retryAfterSeconds?: number;
    }
  | { kind: 'network' }
  | { kind: 'invalid-response' };

export type ApiResult<Value> = { ok: true; value: Value } | { ok: false; error: ApiFailure };

export async function requestApiResult<Value>(
  request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
  schema: zod.ZodType<Value>,
  signal: AbortSignal,
  expectedStatus?: number,
): Promise<ApiResult<Value>> {
  try {
    signal.throwIfAborted();
    const result = await request();
    signal.throwIfAborted();
    if (!result.response.ok) {
      const parsedError = apiErrorSchema.safeParse(result.error);
      const retryAfterSeconds = parseRetryAfter(result.response.headers.get('retry-after'));
      return {
        ok: false,
        error: {
          kind: 'http',
          status: result.response.status,
          ...(parsedError.success ? { code: parsedError.data.error.code } : {}),
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      };
    }
    if (expectedStatus !== undefined && result.response.status !== expectedStatus) {
      return { ok: false, error: { kind: 'invalid-response' } };
    }
    const parsed = schema.safeParse(result.data);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: { kind: 'invalid-response' } };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      ok: false,
      error: { kind: error instanceof SyntaxError ? 'invalid-response' : 'network' },
    };
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const delaySeconds = Number(value);
  if (!Number.isNaN(delaySeconds)) {
    const isValidDelay = /^\d+$/u.test(value) && Number.isFinite(delaySeconds);
    return isValidDelay ? delaySeconds : undefined;
  }
  const secondsUntilRetry = (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(secondsUntilRetry) ? Math.max(0, Math.ceil(secondsUntilRetry)) : undefined;
}
