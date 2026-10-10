# My Wallet

My Wallet is a pnpm workspace with a React single-page client, a Fastify API, and shared browser-safe contracts.

## Local setup

Use a supported Node.js and pnpm version from the root `package.json` (Node.js 22.22 or newer in the 22.x line, or 24 or newer), then install workspace dependencies:

```sh
pnpm install
```

Start the web development server with:

```sh
pnpm dev:web
```

Vite listens on `http://127.0.0.1:5173`. The development server proxies `/api` requests to `http://127.0.0.1:3000`. The API runtime is introduced in the API foundation slice, so API requests are unavailable until that slice is implemented.

Build the static web output with `pnpm --filter @my-wallets/web build`. `vite preview` is for local review only; production web hosting will serve the built output separately from the API.

The current web scaffold does not need a database or environment variables. The API's initial local settings will be `NODE_ENV=development`, `API_HOST=127.0.0.1`, and `PORT=3000`; the API runtime is not available yet. The PostgreSQL development/test services and ignored local environment files are introduced in the environment workflow slice. Later API persistence work will require a local PostgreSQL development database and a separate disposable test database; never use production data for local development or tests. Keep API secrets in API-only environment configuration and do not expose them through `VITE_` variables. The browser uses relative `/api` requests by default.

## Route configuration

The web app uses React Router Data Mode. `src/app/router.tsx` owns the typed `RouteObject` tree, and `src/main.tsx` mounts its `RouterProvider`. Route components are ordinary modules imported directly by route objects; folders are not file-system routes. Use nested routes with layout components and `<Outlet />` when routes share a shell. Keep each route's component and any future loader, action, or error boundary with the route behavior it owns. Keep the router focused on route composition, use direct imports instead of convenience re-export files, and load or mutate server state through route data APIs that call the typed API client.
