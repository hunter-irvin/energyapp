# CODING_GUIDELINES.md

## General Standards

- Prefer small, composable functions.
- Keep page scripts as orchestrators; move reusable UI into `public/assets/js/components/`.
- Keep domain math in `public/assets/js/features/` or dedicated utility modules.
- Avoid hidden side effects in helpers.

## Frontend Patterns

- Use React bridge components for reusable/stateful UI:
  - project shell
  - control strip
  - legend toggles
  - asset editors
  - timeseries chart wrapper
- Avoid direct DOM template cloning for asset editor cards.
- Keep event handlers declarative and tied to component props/callbacks.

## Charting Patterns

- Use `EnergyTimeSeriesChart.createBridge()` for chart mount/update.
- Pass explicit `scales` when stacking or dual-axis behavior is required.
- Keep labels period/interval aware and consistent across pages.
- If period changes force interval normalization, update control state immediately.

## State and Persistence

- Persist UI state with scoped keys (`buildScopedUiStorageKey`) where available.
- Keep period and interval persisted separately.
- When changing derived series shape, bump schema version in cache key inputs.

## API and Backend Safety

- Preserve existing endpoint contracts unless the task explicitly asks for contract changes.
- Keep unit conversion rules clear (source unit vs display unit).
- For rates, expose finer intervals only when source cadence supports them.

## Testing and Validation

Minimum for each change:

1. `node --check` on edited JS files.
2. `npm run -s test`.
3. Verify page-level behavior in browser for impacted flows.

## Documentation Requirements

When architecture or shared component boundaries change, update:

- `README.md`
- `docs/architecture.md`
- Any domain doc directly impacted (for example `docs/rates.md`)
