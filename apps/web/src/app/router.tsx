import type { RouteObject } from 'react-router';
import { createBrowserRouter, redirect } from 'react-router';

import { getSession, redirectAuthenticatedUser, requireSession } from '../lib/requireSession';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';
import { RootLayout } from './layouts/RootLayout';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { RootErrorBoundary } from './routes/RootErrorBoundary';
import { RootLoadingFallback } from './routes/RootLoadingFallback';
import { WalletsLoadingState } from './routes/wallets/_components/WalletsLoadingState';

async function homeLoader() {
  if (await getSession()) {
    return redirect('/wallets');
  }

  return null;
}

export const routeObjects = [
  {
    path: '/',
    Component: RootLayout,
    ErrorBoundary: RootErrorBoundary,
    HydrateFallback: RootLoadingFallback,
    children: [
      { index: true, Component: HomeRoute, loader: homeLoader },
      {
        path: 'login',
        loader: redirectAuthenticatedUser,
        lazy: async () => {
          const routeModule = await import('./routes/auth/AuthRoute');
          return {
            Component: routeModule.SignInRoute,
            action: routeModule.signInAction,
          };
        },
      },
      {
        path: 'register',
        loader: redirectAuthenticatedUser,
        lazy: async () => {
          const routeModule = await import('./routes/auth/AuthRoute');
          return {
            Component: routeModule.RegisterRoute,
            action: routeModule.registerAction,
          };
        },
      },
      {
        Component: AuthenticatedLayout,
        loader: requireSession,
        children: [
          {
            path: 'wallets',
            HydrateFallback: WalletsLoadingState,
            lazy: async () => {
              const routeModule = await import('./routes/wallets/list/WalletListModule');
              return {
                Component: routeModule.WalletListComponent,
                loader: routeModule.walletListLoader,
              };
            },
          },
          {
            path: 'wallets/new',
            lazy: async () => {
              const routeModule = await import('./routes/wallets/create/CreateWalletModule');
              return {
                Component: routeModule.CreateWalletComponent,
                action: routeModule.createWalletAction,
              };
            },
          },
          {
            path: 'wallets/:walletId',
            lazy: async () => {
              const routeModule = await import('./routes/wallets/detail/WalletDetailModule');
              return {
                Component: routeModule.WalletDetailComponent,
                loader: routeModule.walletDetailLoader,
              };
            },
          },
        ],
      },
      { path: '*', Component: NotFoundRoute },
    ],
  },
] satisfies RouteObject[];

export const router = createBrowserRouter(routeObjects);
