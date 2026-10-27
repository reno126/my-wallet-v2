# Production-like deployment verification

[Security and deployment](security-and-deployment.md) · [Testing](testing.md)

Slice 8B prepares and verifies deployment behavior. Hosted acceptance remains pending until the selected projects, domains, ingress controls and preview URLs are confirmed. The existing configuration targets Vercel for the SPA and Railway for the API; this is a configuration reference, not confirmation of access or a successful preview deployment.

## Prepared configuration

The web build explicitly selects `NODE_ENV=production` inside its build process. Workspace CI retains `NODE_ENV=test` for database checks; invoking Vite directly with that inherited value included development React code in the artifact. This keeps CI's database environment intact while producing the intended browser build.

`apps/web/vercel.json` keeps the browser on a relative `/api` URL and forwards that path to the existing Railway destination. The API is deployed separately and does not serve the SPA. Vercel checks existing files before rewrites. The generic SPA fallback excludes `/api`, `/assets`, `/.well-known` and paths ending in a file extension, so missing scripts/styles do not become HTML. An explicit instrument-detail rewrite preserves legitimate dotted symbols such as `BRK.B`; unknown extensionless browser routes still reach React Router. See [Vercel rewrite configuration](https://vercel.com/docs/project-configuration/vercel-json).

HTML and any future public runtime configuration revalidate with `no-cache`. Fingerprinted Vite assets under `/assets/` use a one-year immutable cache; private `/api/` responses use `private, no-store`. The static host supplies HSTS without subdomain/preload opt-in, MIME-sniffing protection, frame denial and a strict referrer policy. Verify the actual edge response headers after deployment; the local fixture does not emulate Vercel's CDN or prove proxy behavior. See [Vercel cache-control behavior](https://vercel.com/docs/caching/cache-control-headers).

The committed SPA CSP is **report-only**. It permits scripts, API connections and fonts only from the browser origin; images may also use `data:`. Inline styles are allowed for the UI libraries' runtime styles and style attributes. Inline scripts and `unsafe-eval` are excluded. Zod is configured with `jitless: true` before schema imports to avoid runtime code-generation probes, following [Zod's CSP guidance](https://zod.dev/compile#content-security-policy). Browser checks confirmed these probes caused CSP violations before this change.

Review violations in browser DevTools on the real preview. There is no centralized CSP-report collector configured; choose one separately if required. Local Chromium tests observe `securitypolicyviolation` events directly. After the hosted journeys have no unexplained violations, rename the header to `Content-Security-Policy`, redeploy and run the enforced checks. Keep preview toolbars/extensions out of the application policy; disable the toolbar during acceptance instead of allowing arbitrary third-party scripts. Report-only policy is observation, not enforcement; see [MDN's report-only header reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only).

## API settings and ingress

Inject settings through the API host's environment/secret manager. Keep the web/API build roots consistent with the pnpm workspace. Build the API with `pnpm --filter @my-wallets/api build`, start it with `pnpm --filter @my-wallets/api start`, and run migrations as a controlled release step. Set `API_HOST=0.0.0.0` and the host-provided `PORT` for container hosting. Keep one API process until rate limits and refresh queues support multiple processes.

| Setting                                    | Same-origin preview value or rule                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `production`                                                                                                  |
| `API_HTTPS_ENABLED`                        | `true` after confirming HTTPS ingress                                                                         |
| `WEB_ORIGIN`                               | Exact browser-visible HTTPS preview origin                                                                    |
| `BETTER_AUTH_URL`                          | The same browser-visible origin; no `/api/auth` suffix                                                        |
| `VITE_API_BASE_URL`                        | Empty, so browser requests use `/api`                                                                         |
| `CORS_ALLOWED_ORIGINS`                     | Empty for the same-origin proxy                                                                               |
| `API_TRUSTED_PROXY_CIDRS`                  | Only verified immediate proxy IPs/CIDRs; never guess or trust all                                             |
| `DATABASE_URL`, `BETTER_AUTH_SECRET`       | Isolated preview database and preview-only secret in the API secret manager                                   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Preview-only OAuth client, configured in the API secret manager                                               |
| FMP settings                               | Optional for auth/static checks; if enabled, explicit limit 250 and `America/New_York`, with its key API-only |

The edge must preserve request `Origin` and `Cookie`, response `Set-Cookie`, query strings, status codes and request bodies. Cookies remain host-only, Secure, HttpOnly and SameSite=Lax. Do not set their domain to the Railway hostname. Google must register the exact `${WEB_ORIGIN}/api/auth/callback/google` URI and the preview web origin. OAuth credentials and the database must be distinct from production.

Confirm how Vercel and Railway normalize forwarded IP headers before trusting an address range. Restrict direct API-origin access where supported, and verify spoofed `X-Forwarded-For`/`X-Real-IP` cannot change rate-limit buckets through the public edge. If the selected providers cannot establish this boundary, decide on supported ingress controls before acceptance; do not substitute `trustProxy: true` or a guessed hop count. Direct cross-origin cookie traffic is deferred unless custom same-site domains and that fallback are explicitly selected.

## Checks to run

```sh
pnpm test:deployment
```

This builds the real SPA and runs local Chromium tests against a loopback static fixture using the configured headers and SPA-fallback expression. It checks deep-link reloads, missing files, immutable asset headers, normal form rendering without CSP violations, and a deliberately injected inline script under both report-only and enforced CSP. Its auth responses are controlled; it never forwards requests to the hosted API. Hosted checks use a separate configuration and are never part of workspace CI. Local checks do not establish real TLS, edge cache behavior, OAuth completion or cookie forwarding.

For an authorized deployed preview, set `DEPLOYMENT_URL` to the exact HTTPS browser origin in the shell or ignored environment file, then run:

```sh
pnpm exec dotenv -e .env.ci.local -- pnpm test:preview
```

The hosted checks fail configuration loading unless `DEPLOYMENT_URL` is an exact HTTPS origin. They only read public pages, assets, health and unauthenticated wallet responses. They verify deep links, cache/security headers, real missing-asset 404s, API JSON routing, and login rendering with no observed CSP violations. They do not create accounts, call FMP, or attempt a live Google login. Set `DEPLOYMENT_CSP_MODE=enforced` after promoting the hosted header and repeat.

Then complete the authenticated walkthrough with a disposable preview account:

1. Register, inspect Secure/HttpOnly/SameSite=Lax host-only cookies on the **web** origin, reload a private wallet URL and confirm the session survives. Create/delete a disposable wallet to verify request bodies, cookie forwarding, statuses and trusted-origin mutations.
2. Send a wallet mutation with an untrusted Origin; expect 403 and no mutation. Verify rate-limit 429/Retry-After behavior with a deliberately low preview-only limit, including spoofed forwarded-header attempts, then restore the agreed settings.
3. Sign out and verify a private deep link redirects to login. Sign in again through credentials.
4. Complete Google consent and callback on the browser-visible origin; verify the session and private redirect, then logout. Check that untrusted callback/redirect origins are rejected.
5. Repeat the critical wallet/purchase/ledger and dialog flows while reviewing CSP violations, then enforce the reviewed policy and repeat. Confirm HTTP redirects to HTTPS at the edge and TLS certificates validate without browser exceptions.

Record preview URLs, commit/deployment IDs, configuration-presence confirmation, browser results, CSP findings and the enforcement deployment. Do not record secret values or session cookies.

## Information needed to finish 8B

Local verification on 2026-10-22 passed: 46 existing browser journeys, 23 API auth/security tests, three production-build/CSP checks, lint, formatting, workspace typechecks, API/web/contracts builds and the dependency audit (no known vulnerabilities). The production auth test was rerun after adding owned OAuth-state cleanup. The final deployment checks also cover dotted-symbol deep links. These local results do not establish hosted behavior or live Google consent.

The developer confirmed the existing GitHub-triggered Vercel frontend / Railway API deployment and supplied `https://my-stock-wallets.vercel.app` through `.env.example`. After `main` reached `482678a` (including implementation commit `bba5eb0`), all three hosted smoke tests passed on 2026-10-22. The deployed frontend exposes report-only CSP, revalidates HTML, preserves ordinary and dotted-symbol deep links, serves immutable fingerprinted assets, and returns real missing-asset 404s. API health/private JSON responses retain no-store caching, and private-route login redirects/reloads work. The earlier missing-CSP and asset-200 baseline failures are resolved.

Additional hosted diagnostics confirmed an HTTP-to-HTTPS 308 redirect, 403 `INVALID_ORIGIN` for an untrusted cookie-bearing auth request, and 403 `INVALID_CALLBACK_URL` for an untrusted callback destination. A cookie-bearing request from the configured web origin passes the origin guard. These used a deliberately invalid session-cookie value, not an authenticated account; they do not establish real session-cookie forwarding or private mutation behavior.

The browser's Google sign-in initiation currently returns 404 `PROVIDER_NOT_FOUND`, including when the trusted web origin is supplied. The deployed API does not have the Google provider enabled. No request was sent to Google: the diagnostic browser was configured to intercept an authorization handoff before it could reach Google. No account registration, wallet mutation, deployment or DNS change was performed by these checks.

To continue, configure both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the intended Railway service/environment and redeploy the API. Register `https://my-stock-wallets.vercel.app/api/auth/callback/google` as the exact Google OAuth redirect URI for this web origin. Report only whether the settings are present; never share their values in chat. Complete authenticated session-cookie forwarding, private mutation/forwarded-IP behavior and live Google callback checks, then promote the reviewed CSP to enforcement and repeat. These requirements come from [slice 8B and P8-R06](../IMPLEMENTATION_PLAN.md#p8-r06); the hosting topology no longer needs to be selected again.

The engineering review covers routing precedence, cache boundaries, CSP scope, bootstrap ordering, test listener cleanup and secret separation. The deliberate import-sorting exception in `main.tsx` keeps Zod configuration ahead of router/schema evaluation; automatic sorting would reverse that required order. No migration, dependency, production account, deployment or DNS changes are made by this preparation. Authenticated/OAuth/ingress checks and CSP enforcement remain open acceptance gates, not assumed successes.
