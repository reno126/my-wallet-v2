import { z as zod } from 'zod';

import {
  apiErrorSchema,
  createWalletSchema,
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';
import { apiClient, createApiClient } from '@/api/client';

export type WalletListQuery = zod.infer<typeof walletListQuerySchema>;
export type CreateWalletInput = zod.infer<typeof createWalletSchema>;
export type WalletSummary = zod.infer<typeof walletSummarySchema>;
export type WalletList = zod.infer<typeof walletListSchema>;

export type WalletApiFailure =
  | {
      kind: 'http';
      status: number;
      code?: zod.infer<typeof apiErrorSchema>['error']['code'];
      retryAfterSeconds?: number;
    }
  | { kind: 'network' }
  | { kind: 'invalid-response' };

type WalletApiResult<Value> = { ok: true; value: Value } | { ok: false; error: WalletApiFailure };
type ApiClient = ReturnType<typeof createApiClient>;

export function createWalletApi(client: ApiClient = apiClient) {
  return {
    list(query: WalletListQuery, signal?: AbortSignal): Promise<WalletApiResult<WalletList>> {
      return requestWalletResult(
        () => client.GET('/wallets', { params: { query }, signal: signal ?? null }),
        walletListSchema,
        signal,
      );
    },
    read(walletId: string, signal?: AbortSignal): Promise<WalletApiResult<WalletSummary>> {
      return requestWalletResult(
        () =>
          client.GET('/wallets/{walletId}', {
            params: { path: { walletId } },
            signal: signal ?? null,
          }),
        walletSummarySchema,
        signal,
      );
    },
    delete(walletId: string, signal?: AbortSignal): Promise<WalletApiResult<undefined>> {
      return requestWalletResult(
        () =>
          client.DELETE('/wallets/{walletId}', {
            params: { path: { walletId } },
            signal: signal ?? null,
          }),
        zod.undefined(),
        signal,
        204,
      );
    },
    create(
      input: CreateWalletInput,
      signal?: AbortSignal,
    ): Promise<WalletApiResult<WalletSummary>> {
      const body = {
        name: input.name,
        reportingCurrency: input.reportingCurrency,
        ...(input.description === undefined ? {} : { description: input.description }),
      };
      return requestWalletResult(
        () => client.POST('/wallets', { body, signal: signal ?? null }),
        walletSummarySchema,
        signal,
      );
    },
  };
}

async function requestWalletResult<Value>(
  request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
  schema: zod.ZodType<Value>,
  signal?: AbortSignal,
  expectedStatus?: number,
): Promise<WalletApiResult<Value>> {
  try {
    signal?.throwIfAborted();
    const result = await request();
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return {
      ok: false,
      error: { kind: error instanceof SyntaxError ? 'invalid-response' : 'network' },
    };
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;

  const delaySeconds = Number(value);
  if (!Number.isNaN(delaySeconds)) {
    const isValidDelay = /^\d+$/u.test(value) && Number.isFinite(delaySeconds);
    return isValidDelay ? delaySeconds : undefined;
  }

  const retryTimestamp = Date.parse(value);
  const secondsUntilRetry = (retryTimestamp - Date.now()) / 1000;
  return Number.isFinite(secondsUntilRetry) ? Math.max(0, Math.ceil(secondsUntilRetry)) : undefined;
}

export const walletsApi = createWalletApi();
