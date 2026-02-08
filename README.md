# Merchant BESS Arbitrage PoC

This repository scaffolds the Merchant BESS Arbitrage PoC for day-ahead, zonal dispatch planning. The focus is on a single-day (24-hour) horizon, synthetic forecasts, and a MILP-based optimizer.

## Stack
- **Frontend:** Next.js (App Router)
- **Backend:** Supabase (Postgres + API)
- **Client SDK:** `@supabase/supabase-js`

## Quick start
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Update the values if needed:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. **Run the app**
   ```bash
   npm run dev
   ```

## Repository structure
```
app/        # UI routes (Next.js App Router)
lib/        # Shared services (Supabase client, forecasting, optimization)
db/         # SQL migrations and data types
```

## Product scope (v1)
### Core workflows
- **Asset Builder:** Create/edit/delete a hybrid merchant asset (BESS + optional solar/wind).
- **Scenario Builder:** Select asset + date, generate forecasts, optimize schedule.
- **Run Results:** View optimized dispatch, KPIs, and export CSV/JSON.

### Key entities
- **Asset:** Energy capacity, solar/wind capacity, zone/location, constraints.
- **Scenario:** Asset + operating date + forecast configuration.
- **Timeseries:** 24-hour price/renewables forecasts per scenario.
- **OptimizationRun:** Optimized dispatch and KPI summary.

## Environment variables
These are required by the Supabase client in `lib/supabaseClient.ts`.

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

## Next steps
- Implement schema migrations in `db/`.
- Build asset and scenario pages under `app/`.
- Add synthetic forecasting services and the MILP optimizer under `lib/`.
- Create results visualizations and CSV export.

## Supabase schema (step 2)
Run the SQL in `db/schema.sql` inside the Supabase SQL editor to create the core tables for assets, scenarios, timeseries, and optimization runs/results.
