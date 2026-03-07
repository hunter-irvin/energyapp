# AGENTS.md

## Purpose

This repository is a static multi-page app with React island components. Future agent work should preserve this architecture and avoid reintroducing legacy template-driven UI code.

## Current Architecture

- Server/runtime:
  - `server.js` serves static files and API routes.
  - Weather routes: `/api/weather-proxy`, `/api/nrel-proxy`.
  - Rates routes: `/api/v4/rates/provider`, `/api/v4/rates/series`.
  - Shared rates handler logic lives in `lib/rates/v4-rates-handlers.js` and is used by both local and production entrypoints.
- Frontend modules:
  - `public/assets/js/core/` shared services and cache.
  - `public/assets/js/features/` domain compute helpers.
  - `public/assets/js/components/` React bridge components.
  - `public/assets/js/pages/` page orchestration and data wiring.

## API Routing Rules

- Local and production API routing must stay mirrored. `server.js` and Vercel `api/` entrypoints must expose the same public endpoints and delegate to the same shared handler logic so local testing accurately reflects deployed behavior.
- Prefer shared implementation modules under `lib/` for business logic, with thin route entrypoints in `api/` and thin route dispatch in `server.js`.
- Keep the total number of public serverless API entrypoints below 10 to stay within Vercel limits. Treat this as a hard budget when adding or removing files under `api/`.
- Remove obsolete API entrypoints when replacing routes so unused files do not continue building as serverless functions.

## UI Conventions (Post-Refactor)

- Shared page shell must use `EnergyProjectShell` (`project-shell.js`).
- Shared chart strip + legend must use `EnergyChartUI` bridges (`chart-ui.js`).
- Shared chart rendering must use `EnergyTimeSeriesChart` (`time-series-chart.js`).
- Generation and Storage asset editors are React-rendered via `createAssetEditorsBridge`.
- Do not add back HTML `<template>` card rendering for generation/storage editors.

## Chart/Control Rules

- Period and interval controls are separate.
- Interval group is right-aligned in the control strip.
- Allowed intervals by period:
  - `day`: sub-daily only (`half_hour`/`hourly`; rates may include `five_min` if source cadence supports it)
  - `week`: `half_hour`/`hourly`/`daily`
  - `month`: `hourly`/`daily`
  - `year`: `daily`
- Rates available intervals must remain source-cadence aware.

## Data/Persistence Rules

- Keep backend contracts unchanged unless explicitly requested.
- Use Supabase service helpers in `public/assets/js/core/supabase-client.js`.
- Respect shared-cache invalidation keys and schema versions when changing derived series shape.

## Verification Checklist

After any frontend change:

1. `node --check` each edited page/component file.
2. `npm run -s test`.
3. Manually verify affected page behaviors (period/interval toggles, legend toggles, chart rendering, navigation).

## Cleanup Policy

- Remove dead references/files introduced by refactors.
- Do not delete files that are still referenced by any HTML or JS entrypoint.
- If removing a shared primitive, update `README.md` and `docs/architecture.md` in the same change.
- If changing API routing, update `AGENTS.md` and `docs/architecture.md` in the same change when the routing model or serverless-function count changes.
