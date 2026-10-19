import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RootLayout } from './layouts/RootLayout';
import { routeObjects } from './router';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { RootErrorBoundary } from './routes/RootErrorBoundary';

const { mockGetSession, mockListWallets } = vi.hoisted(() => ({
  mockGetSession:
    vi.fn<
      () => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }>
    >(),
  mockListWallets: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
    useSession: () => ({ isPending: false }),
  },
}));

vi.mock('@/lib/api/createRequestApi', () => ({
  createRequestApi: () => ({ wallets: { list: mockListWallets, create: vi.fn() } }),
}));

function LoadingRouteFallback() {
  return <p role="status">Loading route</p>;
}

describe('application routing', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: null, error: null });
    mockListWallets.mockReset().mockResolvedValue({
      ok: true,
      value: {
        wallets: [],
        pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
      },
    });
  });

  it('renders the home route from the shared route configuration', async () => {
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeInTheDocument();
  });

  it('sends an authenticated visitor from the home route to wallets', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /^Wallets$/ })).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/wallets');
  });

  it.each(['/login', '/register'])(
    'sends an authenticated visitor from %s to wallets',
    async (path) => {
      mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: [path] });

      render(<RouterProvider router={memoryRouter} />);

      expect(await screen.findByRole('heading', { name: /^Wallets$/ })).toBeInTheDocument();
      expect(memoryRouter.state.location.pathname).toBe('/wallets');
    },
  );

  it.each(['/login', '/register'])(
    'allows an unauthenticated visitor to reach %s',
    async (path) => {
      const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: [path] });

      render(<RouterProvider router={memoryRouter} />);

      expect(
        await screen.findByRole('heading', { name: /welcome back|create your account/i }),
      ).toBeInTheDocument();
      expect(memoryRouter.state.location.pathname).toBe(path);
    },
  );

  it('redirects an unauthenticated visitor away from the protected wallet route', async () => {
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/login');
  });

  it('shows the route error boundary when session lookup fails', async () => {
    mockGetSession.mockRejectedValue(new Error('Private session service detail'));
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/status 503/i)).toBeInTheDocument();
    expect(screen.queryByText(/private session service detail/i)).not.toBeInTheDocument();
  });

  it('shows the route error boundary when the session service returns an error', async () => {
    mockGetSession.mockResolvedValue({ data: null, error: { message: 'Session lookup failed' } });
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/status 503/i)).toBeInTheDocument();
  });

  it('renders a not-found route and navigates back home', async () => {
    const user = userEvent.setup();
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/missing'] });

    render(<RouterProvider router={memoryRouter} />);

    await user.click(screen.getByRole('link', { name: /return to the home page/i }));

    expect(
      await screen.findByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeInTheDocument();
  });

  it('renders a safe route error boundary when a loader fails', async () => {
    const errorRoutes = [
      {
        path: '/',
        Component: RootLayout,
        ErrorBoundary: RootErrorBoundary,
        HydrateFallback: LoadingRouteFallback,
        children: [
          {
            index: true,
            Component: HomeRoute,
            loader() {
              throw new Error('Private diagnostic detail');
            },
          },
          { path: '*', Component: NotFoundRoute },
        ],
      },
    ] satisfies RouteObject[];
    const memoryRouter = createMemoryRouter(errorRoutes, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private diagnostic detail/i)).not.toBeInTheDocument();
  });
});
