# Architecture Overview

## Runtime

- Static pages and assets are served by `server.js` from `public/`.
- `server.js` routes weather API requests to `api/weather-proxy.js`.
- `api/nrel-proxy.js` is kept as a thin compatibility wrapper for the NREL CSV proxy handler.
- API endpoints exposed by `server.js`:
  - `/api/weather-proxy`
  - `/api/nrel-proxy`
  - `/api/runtime-config`
  - `/api/diagnostics`

## Route Map

- `/` -> project landing/list page
- `/projects/location.html` -> location + weather chart page
- `/projects/generation.html` -> generation asset modeling page
- `/projects/storage.html` -> storage modeling page

## Frontend Module Boundaries

- `public/assets/js/core/`
  - Shared modules used across pages
  - Includes charting, Supabase client/config, shared cache, models, utility logic
- `public/assets/js/features/`
  - Domain-specific computation helpers
  - Includes generation computations used by multiple pages
- `public/assets/js/pages/`
  - Page entry points and UI orchestration

## Data/Recompute Invalidation

- Shared cache module: `public/assets/js/core/shared-cache.js`
- Revision keys track invalidation domains:
  - `weatherRevision`
  - `assetsRevision`
  - `storageRevision`
- Derived chart series are reused when revisions match.
- Asset edits use debounced recompute (200ms) on generation/storage pages.

