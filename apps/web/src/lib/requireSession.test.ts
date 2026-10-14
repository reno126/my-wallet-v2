import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestWithSession } from './requireSession';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession:
    vi.fn<
      () => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }>
    >(),
}));

vi.mock('./auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
  },
}));

async function getRedirectLocation(request: Promise<unknown>) {
  try {
    await request;
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error.headers.get('Location');
    }

    throw error;
  }

  throw new Error('Expected requestWithSession to redirect.');
}

describe('requestWithSession', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it('does not make a protected API request when the session is missing', async () => {
    const privateApiRequest = vi.fn(() =>
      Promise.resolve({ response: new Response(null, { status: 200 }) }),
    );

    await expect(getRedirectLocation(requestWithSession(privateApiRequest))).resolves.toBe(
      '/login',
    );
    expect(privateApiRequest).not.toHaveBeenCalled();
  });

  it('redirects to login when a protected API request reports an expired session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const privateApiRequest = vi.fn(() =>
      Promise.resolve({ response: new Response(null, { status: 401 }) }),
    );

    await expect(getRedirectLocation(requestWithSession(privateApiRequest))).resolves.toBe(
      '/login',
    );
    expect(privateApiRequest).toHaveBeenCalledOnce();
  });
});
