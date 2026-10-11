import createClient from 'openapi-fetch';

import type { paths } from './generated/openapi.js';

export function createApiClient(baseUrl = '/api') {
  return createClient<paths>({
    baseUrl,
    credentials: 'include',
    fetch: (request) => globalThis.fetch(request),
  });
}

export const apiClient = createApiClient();
