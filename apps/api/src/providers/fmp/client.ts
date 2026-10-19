import { z as zod } from 'zod';

import type { ApiEnvironmentInput } from '../../config/environment.js';
import type { Result } from '../../result.js';

const requestSchema = zod.strictObject({
  endpoint: zod.enum([
    'search-symbol',
    'search-name',
    'profile',
    'historical-price-eod/full',
    'quote',
  ]),
  parameters: zod
    .record(
      zod
        .string()
        .regex(/^[a-zA-Z][a-zA-Z0-9]*$/)
        .refine((key) => key.toLowerCase() !== 'apikey'),
      zod.string().max(1_000),
    )
    .refine((parameters) => Object.keys(parameters).length <= 10),
});

export type FmpFailure =
  | { code: 'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'QUOTA_EXHAUSTED' | 'QUOTA_UNAVAILABLE' }
  | { code: 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'PROVIDER_ERROR' }
  | { code: 'HTTP_ERROR'; status: number };

export interface FmpDependencies {
  // The store must atomically reserve one unit, return false on exhaustion, and never refund dispatches.
  reserveRequest: () => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface FmpClientOptions extends FmpDependencies {
  environment: Pick<ApiEnvironmentInput, 'FMP_API_KEY' | 'FMP_BASE_URL'>;
}

interface FmpRequest<Value> {
  endpoint: zod.infer<typeof requestSchema>['endpoint'];
  parameters: Record<string, string>;
  responseSchema: zod.ZodType<Value>;
}

export function createFmpClient(options: FmpClientOptions) {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('FMP timeout must be an integer from 1 to 60000 milliseconds.');
  }

  return { request };

  async function request<Value>(input: FmpRequest<Value>): Promise<Result<Value, FmpFailure>> {
    if (!options.environment.FMP_API_KEY) {
      return { ok: false, error: { code: 'NOT_CONFIGURED' } };
    }

    const parsedRequest = requestSchema.safeParse({
      endpoint: input.endpoint,
      parameters: input.parameters,
    });

    if (!parsedRequest.success) {
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }

    const requestUrl = new URL(parsedRequest.data.endpoint, options.environment.FMP_BASE_URL);
    requestUrl.search = new URLSearchParams(parsedRequest.data.parameters).toString();
    requestUrl.searchParams.set('apikey', options.environment.FMP_API_KEY);

    try {
      if (!(await options.reserveRequest())) {
        return { ok: false, error: { code: 'QUOTA_EXHAUSTED' } };
      }
    } catch {
      return { ok: false, error: { code: 'QUOTA_UNAVAILABLE' } };
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetchRequest(requestUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: timeoutSignal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, error: { code: 'HTTP_ERROR', status: response.status } };
      }

      let body: unknown;

      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          error: { code: timeoutSignal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE' },
        };
      }

      if (typeof body === 'object' && body !== null && 'Error Message' in body) {
        return { ok: false, error: { code: 'PROVIDER_ERROR' } };
      }

      const parsedResponse = input.responseSchema.safeParse(body);

      return parsedResponse.success
        ? { ok: true, value: parsedResponse.data }
        : { ok: false, error: { code: 'INVALID_RESPONSE' } };
    } catch {
      return { ok: false, error: { code: timeoutSignal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' } };
    }
  }
}
