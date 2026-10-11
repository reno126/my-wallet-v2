import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from './client.js';

const mockApiServer = setupServer();

beforeAll(() => mockApiServer.listen());
afterEach(() => mockApiServer.resetHandlers());
afterAll(() => mockApiServer.close());

describe('typed API client', () => {
  it('sends a typed health request through the API base path', async () => {
    const apiClient = createApiClient('http://localhost/api');
    let requestedPath = '';
    mockApiServer.use(
      http.get('http://localhost/api/health', ({ request }) => {
        requestedPath = new URL(request.url).pathname;
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const response = await apiClient.GET('/health');

    expect(requestedPath).toBe('/api/health');
    expect(response.data).toEqual({ status: 'ok' });
    expect(response.error).toBeUndefined();
  });

  it('returns a documented API error response for typed error handling', async () => {
    const apiClient = createApiClient('http://localhost/api');
    mockApiServer.use(
      http.get('http://localhost/api/health', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred.',
              requestId: 'c129d5c8-c0d3-45e9-8c6c-4c59093d6886',
            },
          },
          { status: 500 },
        ),
      ),
    );

    const response = await apiClient.GET('/health');

    expect(response.data).toBeUndefined();
    expect(response.error?.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
