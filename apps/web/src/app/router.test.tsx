import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionFunction, RouteObject } from 'react-router';
import { createMemoryRouter, Form, RouterProvider, useActionData } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestWithSession } from '../lib/requireSession';
import { RootLayout } from './layouts/RootLayout';
import { routeObjects } from './router';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { RootErrorBoundary } from './routes/RootErrorBoundary';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession:
    vi.fn<
      () => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }>
    >(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
    useSession: () => ({ isPending: false }),
  },
}));

const saveScaffoldPreference: ActionFunction = () => ({ status: 'saved' });

function ActionRoute() {
  const actionData = useActionData<{ status: string }>();

  return (
    <>
      <Form method="post">
        <button type="submit">Save scaffold preference</button>
      </Form>
      {actionData ? <p role="status">{actionData.status}</p> : null}
    </>
  );
}

function LoadingRouteFallback() {
  return <p role="status">Loading route</p>;
}

describe('application routing', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: null, error: null });
  });

  it('renders the home route from the shared route configuration', async () => {
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeTruthy();
  });

  it('sends an authenticated visitor from the home route to wallets', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /wallets/i })).toBeTruthy();
    expect(memoryRouter.state.location.pathname).toBe('/wallets');
  });

  it.each(['/login', '/register'])(
    'sends an authenticated visitor from %s to wallets',
    async (path) => {
      mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: [path] });

      render(<RouterProvider router={memoryRouter} />);

      expect(await screen.findByRole('heading', { name: /wallets/i })).toBeTruthy();
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
      ).toBeTruthy();
      expect(memoryRouter.state.location.pathname).toBe(path);
    },
  );

  it('redirects an unauthenticated visitor away from the protected wallet route', async () => {
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    expect(memoryRouter.state.location.pathname).toBe('/login');
  });

  it('does not make a protected API request when the session is missing', async () => {
    const privateApiRequest = vi.fn(() =>
      Promise.resolve({ response: new Response(null, { status: 200 }) }),
    );

    const redirectLocation = await requestWithSession(privateApiRequest).then(
      () => null,
      (error: unknown) => (error instanceof Response ? error.headers.get('Location') : null),
    );

    expect(redirectLocation).toBe('/login');
    expect(privateApiRequest).not.toHaveBeenCalled();
  });

  it('redirects to login when a protected API request reports an expired session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const privateApiRequest = vi.fn(() =>
      Promise.resolve({ response: new Response(null, { status: 401 }) }),
    );

    const redirectLocation = await requestWithSession(privateApiRequest).then(
      () => null,
      (error: unknown) => (error instanceof Response ? error.headers.get('Location') : null),
    );

    expect(redirectLocation).toBe('/login');
    expect(privateApiRequest).toHaveBeenCalledOnce();
  });

  it('shows the route error boundary when session lookup fails', async () => {
    mockGetSession.mockRejectedValue(new Error('Private session service detail'));
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByText(/status 503/i)).toBeTruthy();
    expect(screen.queryByText(/private session service detail/i)).toBeNull();
  });

  it('shows the route error boundary when the session service returns an error', async () => {
    mockGetSession.mockResolvedValue({ data: null, error: { message: 'Session lookup failed' } });
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/wallets'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole('heading', { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByText(/status 503/i)).toBeTruthy();
  });

  it('renders a not-found route and navigates back home', async () => {
    const user = userEvent.setup();
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/missing'] });

    render(<RouterProvider router={memoryRouter} />);

    await user.click(screen.getByRole('link', { name: /return to the home page/i }));

    expect(
      await screen.findByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeTruthy();
  });

  it('submits a route action and renders its result', async () => {
    const user = userEvent.setup();
    const actionRoutes = [
      { path: '/', action: saveScaffoldPreference, Component: ActionRoute },
    ] satisfies RouteObject[];
    const memoryRouter = createMemoryRouter(actionRoutes, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    await user.click(screen.getByRole('button', { name: /save scaffold preference/i }));

    expect((await screen.findByRole('status')).textContent).toBe('saved');
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

    expect(await screen.findByRole('heading', { name: /something went wrong/i })).toBeTruthy();
    expect(screen.queryByText(/private diagnostic detail/i)).toBeNull();
  });
});
