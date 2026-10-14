import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeObjects } from './router';

const {
  mockGetSession,
  mockListWallets,
  mockSignUpEmail,
  mockSignInEmail,
  mockSignInSocial,
  mockSignOut,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListWallets: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignInEmail: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
    useSession: () => ({ isPending: false }),
    signUp: { email: mockSignUpEmail },
    signIn: { email: mockSignInEmail, social: mockSignInSocial },
    signOut: mockSignOut,
  },
}));

vi.mock('@/lib/api/wallets', () => ({
  walletsApi: { list: mockListWallets, create: vi.fn() },
}));

async function fillSignInForm(user: UserEvent) {
  await user.type(await screen.findByRole('textbox', { name: /email/i }), 'taylor@example.test');
  await user.type(await screen.findByLabelText(/password/i), 'a-strong-password');
}

describe('sign-in journeys', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: null, error: null });
    mockListWallets.mockReset().mockResolvedValue({
      ok: true,
      value: {
        wallets: [],
        pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
      },
    });
    mockSignUpEmail.mockReset();
    mockSignInEmail.mockReset();
    mockSignInSocial.mockReset();
    mockSignOut.mockReset();
  });

  it('registers with credentials and opens the authenticated area', async () => {
    const user = userEvent.setup();
    mockSignUpEmail.mockImplementation(() => {
      mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/register'] });

    render(<RouterProvider router={router} />);
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Taylor Investor');
    await user.type(await screen.findByRole('textbox', { name: /email/i }), 'taylor@example.test');
    await user.type(await screen.findByLabelText(/password/i), 'a-strong-password');
    await user.click(await screen.findByRole('button', { name: /create account/i }));

    expect(mockSignUpEmail).toHaveBeenCalledWith({
      name: 'Taylor Investor',
      email: 'taylor@example.test',
      password: 'a-strong-password',
      callbackURL: '/wallets',
    });
    expect(await screen.findByRole('heading', { name: /^Wallets$/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/wallets');
  });

  it('validates registration fields before submitting credentials', async () => {
    const user = userEvent.setup();
    render(
      <RouterProvider
        router={createMemoryRouter(routeObjects, { initialEntries: ['/register'] })}
      />,
    );

    const nameInput = await screen.findByRole('textbox', { name: /name/i });
    const emailInput = screen.getByRole('textbox', { name: /email/i });
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'invalid-email');
    await user.type(passwordInput, 'short');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(nameInput).toBeInvalid();
    expect(emailInput).toBeInvalid();
    expect(passwordInput).toBeInvalid();
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  it('signs in with credentials and opens the authenticated area', async () => {
    const user = userEvent.setup();
    mockSignInEmail.mockImplementation(() => {
      mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/login'] });

    render(<RouterProvider router={router} />);
    await fillSignInForm(user);
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));

    expect(mockSignInEmail).toHaveBeenCalledWith({
      email: 'taylor@example.test',
      password: 'a-strong-password',
      callbackURL: '/wallets',
    });
    expect(await screen.findByRole('heading', { name: /^Wallets$/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/wallets');
  });

  it('starts Google sign-in with a wallet callback', async () => {
    const user = userEvent.setup();
    mockSignInSocial.mockResolvedValue({ data: {}, error: null });
    render(
      <RouterProvider router={createMemoryRouter(routeObjects, { initialEntries: ['/login'] })} />,
    );

    await user.click(await screen.findByRole('button', { name: /continue with google/i }));

    expect(mockSignInSocial).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/wallets' });
  });

  it('shows a safe message when credential sign-in fails', async () => {
    const user = userEvent.setup();
    mockSignInEmail.mockResolvedValue({ data: null, error: { message: 'Private auth detail' } });
    render(
      <RouterProvider router={createMemoryRouter(routeObjects, { initialEntries: ['/login'] })} />,
    );

    await fillSignInForm(user);
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).not.toHaveTextContent(/private auth detail/i);
  });

  it.each(['API request limit', 'Better Auth credential limit'])(
    'shows retry guidance for a %s response',
    async () => {
      const user = userEvent.setup();
      mockSignInEmail.mockResolvedValue({
        data: null,
        error: { status: 429, message: 'Private rate limit detail' },
      });
      render(
        <RouterProvider
          router={createMemoryRouter(routeObjects, { initialEntries: ['/login'] })}
        />,
      );

      await fillSignInForm(user);
      await user.click(await screen.findByRole('button', { name: /^sign in$/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/wait|try again/i);
      expect(alert).not.toHaveTextContent(/private rate limit detail/i);
    },
  );

  it('signs out and returns to the public landing page', async () => {
    const user = userEvent.setup();
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockSignOut.mockImplementation(() => {
      mockGetSession.mockResolvedValue({ data: null, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={router} />);
    await user.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('offers login and registration from the public landing page', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    await user.click(await screen.findByRole('link', { name: /create your account/i }));
    expect(
      await screen.findByRole('heading', { name: /create your account/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});
