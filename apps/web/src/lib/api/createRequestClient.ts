import type { z as zod } from 'zod';

import { createApiClient } from '@/api/client';

import { requestApiResult } from './requestApiResult';

export function createRequestClient(signal: AbortSignal, baseUrl?: string) {
  const request = <Value>(
    send: Parameters<typeof requestApiResult>[0],
    schema: zod.ZodType<Value>,
    expectedStatus?: number,
  ) => requestApiResult(send, schema, signal, expectedStatus);
  return {
    client: createApiClient(baseUrl, signal),
    request,
  };
}

export type RequestClient = ReturnType<typeof createRequestClient>;
