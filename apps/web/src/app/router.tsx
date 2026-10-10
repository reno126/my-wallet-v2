import type { RouteObject } from 'react-router';
import { createBrowserRouter } from 'react-router';

import { RootLayout } from './layouts/RootLayout';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { RootErrorBoundary } from './routes/RootErrorBoundary';

export const routeObjects = [
  {
    path: '/',
    Component: RootLayout,
    ErrorBoundary: RootErrorBoundary,
    children: [
      { index: true, Component: HomeRoute },
      { path: '*', Component: NotFoundRoute },
    ],
  },
] satisfies RouteObject[];

export const router = createBrowserRouter(routeObjects);
