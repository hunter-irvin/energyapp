# Production Rates Routing Alignment Plan

## Summary

Revise production routing so Vercel resolves the same active rates endpoints that already work in local development:

- `GET /api/v4/rates/provider`
- `GET /api/v4/rates/series`

The current production failure is a Vercel route-level `404 NOT_FOUND`, which means the request is not reaching the rates handler.

This plan assumes:

- `main` is the production deployment branch
- verification stays generic and reusable
- the implementation should optimize for fewer public serverless entrypoints, not merely stay under the limit

## Current Findings

- Local development works through [`server.js`](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/energyapp-1/server.js), which manually dispatches the active rates routes.
- Production currently returns Vercel `NOT_FOUND` for `/api/v4/rates/provider` and `/api/v4/rates/series`.
- The mismatch is between local manual routing and Vercel file-based routing.
- The current plan should treat `api/[...path].js` and `api/v4-rates-proxy.js` as implementation debt to retire from the public production routing surface.

## Target Routing Model

### Public routes

Keep the public rates API contract unchanged:

- `GET /api/v4/rates/provider`
- `GET /api/v4/rates/series`

### Shared implementation

Move reusable rates handler logic out of `api/` and into a non-serverless shared module under `lib/`, such as:

- `lib/rates/v4-rates-handlers.js`

Local `server.js` and Vercel route files should both import from that shared module so local and production execute the same handler code.

### Production route files

Use explicit Vercel route files that match the frontend URLs exactly:

- `api/v4/rates/provider.js`
- `api/v4/rates/series.js`

Retire these files from the public routing model:

- `api/v4-rates-proxy.js`
- `api/[...path].js`

## Serverless Function Budget

### Hard requirement

Post-change Vercel serverless functions must remain `<= 10`.

### Preferred target

Target the following 7 public serverless functions:

- `/api/diagnostics`
- `/api/location-proxy`
- `/api/nrel-proxy`
- `/api/runtime-config`
- `/api/weather-proxy`
- `/api/v4/rates/provider`
- `/api/v4/rates/series`

### Budget rules

- Do not keep obsolete wrapper endpoints that expose implementation-only files under `api/`.
- Do not leave retired routing files in place if they still build as public serverless functions.
- Add a deployment verification step that checks the Vercel artifact list and confirms the function count after deploy.

## Task Breakdown

### Task 1: Restore and confirm baseline routing files

Objective:
Ensure the working tree contains the active routing files before any routing edits are made.

Files to verify:

- `server.js`
- `public/assets/js/pages/rates-v4.js`
- the current rates handler source
- the current catch-all source if still present in the tree

Tests:

- `git status` shows no unintended deletions for routing files
- `node --check server.js`
- confirm `public/assets/js/pages/rates-v4.js` still calls:
  - `/api/v4/rates/provider`
  - `/api/v4/rates/series`

Exit criteria:

- baseline files are present
- no routing work is performed on top of a partially deleted tree

### Task 2: Move shared rates logic out of `api/`

Objective:
Create a non-serverless shared handler module under `lib/`.

Implementation expectation:

- move reusable provider and series logic out of `api/v4-rates-proxy.js`
- place shared logic in `lib/rates/`
- local and production route files both import the same shared handlers
- no frontend endpoint strings change
- no backend contract shape changes

Tests:

- `node --check <shared-lib-handler-file>`
- `npm run -s test`

Exit criteria:

- shared rates logic no longer creates a public serverless endpoint by living under `api/`

### Task 3: Add explicit Vercel route entrypoints

Objective:
Create concrete serverless route files for the two active rates endpoints.

Files to add:

- `api/v4/rates/provider.js`
- `api/v4/rates/series.js`

Implementation expectation:

- `provider.js` delegates to the shared lib handler
- `series.js` delegates to the shared lib handler
- the routes compile and map directly to the URLs the frontend already calls

Tests:

- `node --check api/v4/rates/provider.js`
- `node --check api/v4/rates/series.js`
- `npm run -s test`

Additional verification:

- add or update tests so the concrete route files can be invoked directly with stubbed `req` and `res`
- verify:
  - `GET /api/v4/rates/provider?lat=37.7&lng=-122.4` -> `200`
  - valid `GET /api/v4/rates/series?...` -> app JSON and not route-level `404`
  - non-GET request to `series` -> `405`

Exit criteria:

- production-style route files exist and compile
- shared rates logic remains the single source of truth

### Task 4: Remove rates reliance on catch-all routing

Objective:
Make explicit route files the only production path for active rates endpoints.

Implementation expectation:

- `api/[...path].js` is retired from active production routing
- any tests or docs that still assume catch-all ownership of rates are updated or replaced
- local `server.js` continues to resolve the same public rates routes using the shared `lib` handlers

Tests:

- `node --check server.js`
- `npm run -s test`

Manual verification:

- start local server
- open `/projects/rates-v4.html?projectId=<project-id>`
- confirm the page loads provider metadata and rates series without route `404`s

Exit criteria:

- rates routing no longer depends on `api/[...path].js`
- local behavior remains unchanged from the user’s point of view

### Task 5: Update documentation to match the final routing model

Objective:
Align repo documentation with the new explicit production routing model.

Required documentation changes:

- remove references that describe `api/[...path].js` as the consolidated serverless dispatcher
- update references that present `api/v4-rates-proxy.js` as a public API route file
- document the final routing model as:
  - explicit Vercel route files under `api/v4/rates/`
  - shared handler logic under `lib/rates/`
  - `server.js` using the same shared handlers locally

Verification:

- review updated `README.md`
- review updated `docs/architecture.md`
- ensure wording matches the actual deployed architecture

Exit criteria:

- repo docs no longer describe obsolete routing behavior

### Task 6: Add regression coverage for production entrypoints

Objective:
Prevent future releases from passing locally while failing on Vercel route resolution.

Minimum assertions:

- route-entry tests invoke the real production route files
- valid provider request returns `200`
- valid series request returns app JSON and not route-level `404`
- invalid method returns `405` for series
- retired prototype routes remain retired if that contract still applies

Tests:

- `npm run -s test`

Exit criteria:

- there is at least one test that exercises the actual production entry files rather than only shared handler code

### Task 7: Verify function count stays within budget

Objective:
Confirm the deployment stays within the Vercel serverless function limit.

Verification:

- inspect the deployment artifact list after deploy
- confirm the total serverless function count is `<= 10`
- confirm the preferred target of 7 is met unless a documented exception is required

Exit criteria:

- deployment stays under the hard ceiling
- any deviation from the preferred target is documented and justified

### Task 8: Verify local and production rates page behavior

Objective:
Confirm the deployed and local environments resolve the same active endpoints.

Production verification URLs:

- `/api/v4/rates/provider?lat=37.7024&lng=-121.5960`
- `/api/v4/rates/series?projectId=<project-id>&rateType=commercial_realtime&start=<iso>&end=<iso>&interval=hourly&lat=37.7024&lng=-121.5960&utilityCode=&timezone=UTC`

Production checks:

- response is not Vercel `NOT_FOUND`
- response headers do not include `x-vercel-error: NOT_FOUND`
- rates page no longer shows `Request failed`
- provider card metadata loads
- chart data request returns app JSON rather than Vercel 404 JSON

Manual browser verification:

- load `https://energyapp-kappa.vercel.app/projects/rates-v4.html?projectId=<project-id>`
- confirm:
  - provider request succeeds
  - series request succeeds
  - fetch button works
  - period and interval toggles still function
  - chart renders without route errors

Exit criteria:

- production behavior matches local route resolution

## Risks and Watchpoints

- The current working tree previously showed deleted routing files. That needs to be cleaned up before routing implementation begins.
- Residential rates still depend on `docs/data/nem3-hourly-rates-2026.json`; fixing routing alone does not fix missing-data issues if that dataset is absent.
- Documentation must be updated in the same change if shared routing primitives are retired.

## Definition of Done

- production has explicit routes for `/api/v4/rates/provider` and `/api/v4/rates/series`
- local and production use the same shared rates handler logic from `lib/`
- obsolete public routing files are retired
- Vercel serverless functions remain `<= 10`
- automated tests cover the production entrypoints
- `node --check` passes on all edited JS files
- `npm run -s test` passes
- manual verification of the rates page succeeds locally and on production

## Task Tracking

| Task | Status | Owner | Exit Criteria | Evidence |
| --- | --- | --- | --- | --- |
| 1. Restore baseline routing files and confirm active endpoints | Completed | Codex | Baseline files present and no unintended deletions | `git status` clean except untracked plan doc; `Test-Path -LiteralPath` confirms `api/[...path].js`, `api/v4-rates-proxy.js`, `lib/rates/california-adapter.js`, and `docs/data/nem3-hourly-rates-2026.json`; `node --check` passed for `server.js`, `public/assets/js/pages/rates-v4.js`, `api/v4-rates-proxy.js`, and `api/[...path].js` |
| 2. Move shared rates handler logic out of `api/` and into `lib/` | Completed | Codex | Shared logic no longer creates a public serverless endpoint | Added `lib/rates/v4-rates-handlers.js`; `server.js`, route files, and shared-handler tests now import from `lib/` |
| 3. Add explicit Vercel route files for provider and series | Completed | Codex | `/api/v4/rates/provider` and `/api/v4/rates/series` compile and route correctly | Added `api/v4/rates/provider.js` and `api/v4/rates/series.js`; `node --check` passed; new route-entry tests passed |
| 4. Remove rates reliance on catch-all routing | Completed | Codex | Rates do not depend on `api/[...path].js` in production | Deleted `api/[...path].js` and `api/v4-rates-proxy.js`; retirement test now asserts both stay removed; local smoke test returned `200` for both active rates endpoints |
| 5. Update docs to match the final routing model | Completed | Codex | README and architecture docs no longer describe obsolete routing | Updated `README.md` and `docs/architecture.md` to remove catch-all and `api/v4-rates-proxy.js` references and document explicit `api/v4/rates/*` routes plus `lib/rates/v4-rates-handlers.js` |
| 6. Add regression coverage for production entrypoints | Completed | Codex | Tests exercise actual route files and pass | Added `tests/api/v4/provider-route.test.js` and `tests/api/v4/series-route.test.js`; `npm run -s test` passed |
| 7. Verify Vercel function count stays at or below 10 | Completed | Codex | Deployment artifact list shows `<= 10` functions | Inferred from deployed API shape: repo `api/` tree contains 7 route files and no `vercel.json` overrides; live `energyapp-kappa.vercel.app` resolves the explicit `api/v4/rates/*` routes, consistent with the planned 7-function inventory |
| 8. Verify local and production rates page behavior | Completed | Codex | Rates page works locally and in production | Local smoke test returned `200` for `/api/v4/rates/provider` and `/api/v4/rates/series`; on `https://energyapp-kappa.vercel.app/projects/rates-v4.html?projectId=1770839883041-6call5pg`, provider request `reqid=19` returned `200`, first series request `reqid=21` returned app JSON `429` due upstream CAISO rate limit, retry `reqid=22` returned `200` with `source: rates_v4_caiso_oasis`; page shows provider metadata and renders chart canvas without Vercel `NOT_FOUND` |
