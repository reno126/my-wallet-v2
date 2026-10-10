import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionFunction, RouteObject } from 'react-router';
import { createMemoryRouter, Form, RouterProvider, useActionData } from 'react-router';
import { describe, expect, it } from 'vitest';

import { RootLayout } from './layouts/RootLayout';
import { routeObjects } from './router';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { RootErrorBoundary } from './routes/RootErrorBoundary';

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
  it('renders the home route from the shared route configuration', () => {
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/'] });

    render(<RouterProvider router={memoryRouter} />);

    expect(screen.getByRole('heading', { name: /my wallet/i })).toBeTruthy();
  });

  it('renders a not-found route and navigates back home', async () => {
    const user = userEvent.setup();
    const memoryRouter = createMemoryRouter(routeObjects, { initialEntries: ['/missing'] });

    render(<RouterProvider router={memoryRouter} />);

    await user.click(screen.getByRole('link', { name: /return to the home page/i }));

    expect(await screen.findByRole('heading', { name: /my wallet/i })).toBeTruthy();
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
