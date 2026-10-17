import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSession, requireSession } from './requireSession';

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

  throw new Error('Expected requireSession to redirect.');
}

describe('protected route session lookup', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it('should redirect a visitor without a session to login', async () => {
    // Act
    const destination = await getRedirectLocation(requireSession());
    // Assert
    expect(destination).toBe('/login');
  });

  it('should return the authenticated user for the route guard', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    // Act
    const session = await requireSession();
    // Assert
    expect(session).toStrictEqual({ user: { id: 'user-1' } });
  });

  it('should report an unavailable auth service without treating it as logout', async () => {
    // Arrange
    mockGetSession.mockRejectedValue(new Error('Private diagnostic detail'));
    // Assert
    await expect(getSession()).rejects.toMatchObject({ status: 503 });
  });
});
