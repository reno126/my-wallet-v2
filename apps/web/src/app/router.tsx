import type { RouteObject } from 'react-router';
import { createBrowserRouter, redirect } from 'react-router';

import { getSession, redirectAuthenticatedUser, requireSession } from '../lib/requireSession';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';
import { RootLayout } from './layouts/RootLayout';
import { HomeRoute } from './routes/home/HomeRoute';
import { NotFoundRoute } from './routes/not-found/NotFoundRoute';
import { PrivateRouteErrorBoundary } from './routes/PrivateRouteErrorBoundary';
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
            ErrorBoundary: PrivateRouteErrorBoundary,
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
                path: 'wallets/:walletId/buy',
                lazy: async () => {
                  const routeModule = await import('./routes/wallets/buy/BuyPurchaseModule');
                  return {
                    Component: routeModule.BuyPurchaseComponent,
                    loader: routeModule.buyPurchaseLoader,
                    action: routeModule.buyPurchaseAction,
                  };
                },
              },
              {
                path: 'wallets/:walletId/buy/search',
                lazy: async () => {
                  const routeModule = await import('./routes/wallets/buy/purchaseLookups');
                  return { loader: routeModule.instrumentSearchLoader };
                },
              },
              {
                path: 'wallets/:walletId/buy/price',
                lazy: async () => {
                  const routeModule = await import('./routes/wallets/buy/purchaseLookups');
                  return { loader: routeModule.purchasePriceLoader };
                },
              },
              {
                path: 'wallets/:walletId/transactions',
                lazy: async () => {
                  const routeModule = await import('./routes/wallets/transactionAction');
                  return { action: routeModule.transactionAction };
                },
              },
              {
                path: 'wallets/:walletId/instruments/:symbol',
                lazy: async () => {
                  const routeModule =
                    await import('./routes/wallets/instrument/InstrumentDetailModule');
                  return {
                    Component: routeModule.InstrumentDetailComponent,
                    loader: routeModule.instrumentDetailLoader,
                  };
                },
              },
              {
                path: 'wallets/:walletId',
                lazy: async () => {
                  const [routeModule, deleteModule] = await Promise.all([
                    import('./routes/wallets/detail/WalletDetailModule'),
                    import('./routes/wallets/detail/deleteWalletAction'),
                  ]);
                  return {
                    Component: routeModule.WalletDetailComponent,
                    loader: routeModule.walletDetailLoader,
                    action: deleteModule.deleteWalletAction,
                  };
                },
              },
            ],
          },
        ],
      },
      { path: '*', Component: NotFoundRoute },
    ],
  },
] satisfies RouteObject[];

export const router = createBrowserRouter(routeObjects);
