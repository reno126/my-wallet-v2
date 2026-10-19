import createClient from 'openapi-fetch';

import type { paths } from './generated/openapi.js';

const apiOrigin = import.meta.env.VITE_API_BASE_URL;
const defaultApiBaseUrl = apiOrigin ? `${apiOrigin.replace(/\/+$/u, '')}/api` : '/api';

export function createApiClient(baseUrl = defaultApiBaseUrl, signal?: AbortSignal) {
  return createClient<paths>({
    baseUrl,
    credentials: 'include',
    ...(signal === undefined ? {} : { signal }),
    fetch: (request) => globalThis.fetch(request),
  });
}
