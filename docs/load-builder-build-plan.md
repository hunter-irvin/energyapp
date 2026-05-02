# Load Builder Build Plan

## Task Summary

| Step | Area | Build Task | Tests / Verification |
| --- | --- | --- | --- |
| 1 | Product decisions | Finalize MVP behavior for named profiles, profile switching, locked rows, and drag/drop-only Library adds. | Review this plan against PRD and accepted answers before implementation begins. |
| 2 | Data model | Add `load_profiles` persistence for multiple saved profiles per project. | Schema test confirms table, FK cascade, required columns, and Supabase helpers. |
| 3 | Core logic | Add pure Load Builder helpers for rows, templates, aggregate, stats, validation, duplicate/delete/lock, and reorder. | Unit tests cover every helper and max-row/96-point constraints. |
| 4 | Static page | Add `/projects/load-builder.html` using the existing project shell. | Static test confirms required roots/scripts and no legacy template editor rendering. |
| 5 | Navigation | Add Load Builder to every project sidebar. | Static test confirms each project page links to `/projects/load-builder.html` with `projectId`. |
| 6 | React bridge UI | Convert the TSX preview into the repo's UMD React bridge style. | `node --check`; browser smoke verifies layout, empty state, selection, menus, and alignment. |
| 7 | Library drag/drop | Implement hardcoded Library templates and drag/drop-only row creation. | Unit tests for template scaling; browser smoke verifies drag into empty list and between rows. |
| 8 | Profile switching | Add New Profile flow and saved profile switch modal. | Unit tests for profile creation/open model; browser smoke verifies create, autosave, switch, empty new profile. |
| 9 | Autosave | Persist edits as the user works; remove Save Profile and replace with New Profile. | Mock service/unit tests for debounced upsert; browser smoke verifies status pill states. |
| 10 | Charts | Render aggregate stacked area and aligned individual mini-area rows. | Unit tests for aggregate/stack data; browser smoke verifies shared axis and legend/info width alignment. |
| 11 | Docs | Update architecture docs for the new page and persistence table. | Static docs review confirms route/module/table list includes Load Builder. |
| 12 | Final verification | Run full project checks. | `node --check` on edited JS files, `npm run -s test`, and manual page behavior pass. |

## Confirmed MVP Decisions

- Load Builder supports multiple saved load profiles per project.
- A new project starts with no load rows.
- Library templates are hardcoded defaults for now.
- Users add Library templates to a profile by drag/drop only.
- The upper-right `SAVE PROFILE` action becomes `NEW PROFILE`.
- Saving happens automatically while the user edits an existing named profile.
- New profiles are named through the New Profile flow.
- Load Builder is isolated for now and does not feed Storage or Rates.
- MVP row overflow actions are delete, duplicate, and lock/unlock.
- Locked rows are protected from delete and duplicate.
- The profile switch modal supports open/switch only in MVP.
- Spline/profile editing is intentionally deferred.

## Implementation Plan

### 1. Persistence And Schema

Add a new Supabase table for saved load profiles instead of overloading the existing `assets` table.

Recommended table:

```sql
create table if not exists public.load_profiles (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  model jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add RLS policy consistent with the current no-auth app mode. Add indexes for `project_id` and `updated_at` if profile lists are sorted by last edit.

Add Supabase service helpers in `public/assets/js/core/supabase-client.js`:

- `listLoadProfiles(projectId)`
- `getLoadProfile(profileId)`
- `upsertLoadProfile({ id, projectId, name, model })`
- `deleteLoadProfile(profileId)` only if profile deletion is included in MVP

Tests:

- Add a DB/static migration test that asserts `load_profiles` exists with `project_id`, `name`, `model`, timestamps, FK cascade, and anon RLS policy.
- Add Supabase client tests that verify the helper names are exported.
- Add a service mapping test for row-to-domain conversion if the helper has local row mappers.

### 2. Core Load Builder Feature Module

Create `public/assets/js/features/load-builder.js` as a pure browser/CommonJS module.

Core constants:

```js
const INTERVAL_MINUTES = 15;
const INTERVALS_PER_DAY = 96;
const INTERVAL_HOURS = 0.25;
const MAX_LOAD_ROWS = 25;
```

Core helpers:

- `normalizeValues(values)`
- `calculateAggregate(rows)`
- `calculateDailyEnergyKwh(values)`
- `getAggregateStats(rows)`
- `getIndividualAxisMax(rows)`
- `createRowFromTemplate(template, options)`
- `duplicateRow(rows, rowId)`
- `deleteRow(rows, rowId)`
- `toggleRowLocked(rows, rowId)`
- `reorderRows(rows, sourceId, targetIndex)`
- `validateProfileModel(model)`
- `createEmptyProfileModel(name)`

Tests:

- Aggregates always return 96 values.
- Aggregate ignores invalid/missing values by treating them as zero after normalization.
- Daily energy equals `sum(values) * 0.25`.
- Values are non-negative after normalization.
- Template scaling returns absolute kW values, not normalized values.
- Duplicate produces a distinct ID and copied values.
- Delete removes unlocked rows and refuses locked rows.
- Duplicate refuses locked rows.
- Lock/unlock toggles the target row.
- Reorder preserves row identity and length.
- Max row count is enforced at 25.
- Empty profile has zero rows and valid interval metadata.

### 3. Static Page And Shell

Create `public/projects/load-builder.html`.

The page should follow the existing static-page pattern:

- `project-header-root`
- `project-sidebar-root`
- one React mount root for the Load Builder UI
- include `config.local.js`, React, ReactDOM, Supabase, `supabase-config.js`, `supabase-client.js`, `project-shell.js`, the Load Builder component bridge, feature module, and page script

Use `EnergyProjectShell.mount` for header/sidebar. The sidebar item for Load Builder should be active on this page.

Tests:

- Static test confirms `load-builder.html` exists.
- Static test confirms it mounts `EnergyProjectShell`.
- Static test confirms it loads `features/load-builder.js`, `components/load-builder-ui.js`, and `pages/load-builder.js`.
- Static test confirms no generation/storage `<template>` editor rendering has been introduced.
- `node --check public/assets/js/pages/load-builder.js`

### 4. Project Navigation

Update sidebars in:

- `public/projects/weather.html`
- `public/projects/generation.html`
- `public/projects/storage.html`
- `public/projects/rates-v4.html`
- `public/projects/load-builder.html`

Add `Load Builder` between Generation and Storage to match the PRD navigation order.

Each page controller should keep the `projectId` query parameter in the Load Builder link, just like existing cross-page links.

Tests:

- Static test scans all project HTML files for `/projects/load-builder.html`.
- Static test scans page scripts for setting Load Builder hrefs with `encodeURIComponent(currentProject.id)` or equivalent.
- Manual browser smoke: navigate Weather -> Generation -> Load Builder -> Storage -> Rates and confirm project name persists.

### 5. React Bridge UI

Create `public/assets/js/components/load-builder-ui.js`.

Convert the preview into the repo's current no-build React style:

- Use `window.React` and `window.ReactDOM`.
- Use `React.createElement`.
- Export `window.EnergyLoadBuilderUI.createBridge()`.
- Keep the visual structure and layout from the preview.
- Use existing CSS classes where they help, and add Load Builder-specific classes in `styles.css`.
- Keep `INFO_PANEL_WIDTH = 224` and use it for both aggregate legend and row info panel.

Props from page controller should include:

- `profiles`
- `currentProfile`
- `templates`
- `autosaveStatus`
- `selectedRowId`
- callbacks for `onNewProfile`, `onOpenProfile`, `onSelectRow`, `onDropTemplate`, `onReorderRow`, `onDuplicateRow`, `onDeleteRow`, `onToggleLock`

Tests:

- `node --check public/assets/js/components/load-builder-ui.js`
- Browser smoke verifies empty state renders with Library present.
- Browser smoke verifies aggregate and individual chart columns align.
- Browser smoke verifies selected row styling.
- Browser smoke verifies locked row state disables duplicate/delete actions.
- Browser smoke verifies no text overflow in row headers and Library cards.

### 6. Page Controller

Create `public/assets/js/pages/load-builder.js`.

Responsibilities:

- Validate `projectId`.
- Load project metadata.
- Mount shell and page links.
- Load saved load profiles for the project.
- If none exist, show an empty unsaved/new profile state.
- Handle New Profile flow.
- Maintain active profile state.
- Wire UI callbacks to pure helper functions.
- Debounce autosave after edits once a named profile exists.
- Update autosave pill: `Saving...`, `Autosaved`, `Error saving`.

Tests:

- `node --check public/assets/js/pages/load-builder.js`
- Unit or static test confirms debounce constant exists and upsert helper is called through a single persistence path.
- Browser smoke verifies a new profile can be named and created.
- Browser smoke verifies changes persist after refresh.
- Browser smoke verifies switching profiles replaces rows and aggregate.
- Browser smoke verifies an empty project does not auto-create sample rows.

### 7. Library Templates And Drag/Drop

Hardcode the initial Library templates in the Load Builder feature or page module. Keep the preview's default set as the MVP seed:

- Office Lighting
- HVAC Cooling
- EV Charging
- Base Load
- Kitchen Equipment
- Server Room

Each template should include:

- `id`
- `name`
- `category`
- `normalizedValues`
- `defaultPeakKw`
- `color`

The Library panel can show normalized previews, but rows created from templates must store absolute kW values.

Drag/drop behavior:

- Drop into empty rows area appends.
- Drop between rows inserts.
- Newly created row becomes selected.
- If current profile already has 25 rows, reject the drop and show a non-blocking UI message.

Tests:

- Unit tests verify each built-in template has 96 normalized values from 0 to 1.
- Unit tests verify dropping a template produces 96 absolute non-negative values.
- Unit tests verify row insertion index is respected.
- Browser smoke verifies drag/drop into empty state.
- Browser smoke verifies drag/drop between two rows.
- Browser smoke verifies a 26th row is rejected.

### 8. New Profile And Profile Switch Modal

Replace the preview's `SAVE PROFILE` button with `NEW PROFILE`.

New Profile flow:

- User clicks `NEW PROFILE`.
- Modal prompts for profile name.
- Creating the profile starts empty.
- Current profile is autosaved before switching if there are pending edits.
- Newly created profile becomes active.

Profile switch flow:

- Keep the `SCENARIOS` button label for now, or rename it to `PROFILES` if desired during implementation.
- Modal lists saved load profiles for the project.
- Opening a profile replaces the active profile state.
- Rename and delete profile actions are deferred.

Tests:

- Unit test validates profile names are trimmed and non-empty.
- Unit test confirms new profile model starts empty.
- Browser smoke verifies creating a new named profile.
- Browser smoke verifies switching from profile A to profile B and back.
- Browser smoke verifies profile list refreshes after creating a profile.

### 9. Row Overflow Actions

MVP row actions:

- Delete
- Duplicate
- Lock/unlock

Locked row behavior:

- Locked rows cannot be deleted.
- Locked rows cannot be duplicated.
- Locked rows can be unlocked.
- Future curve/profile editing should also respect locked state.

Tests:

- Unit tests verify locked delete/duplicate return unchanged rows.
- Unit tests verify unlocked delete/duplicate work.
- Browser smoke verifies menu actions update the row list.
- Browser smoke verifies aggregate updates after delete/duplicate.
- Browser smoke verifies locked rows show disabled delete/duplicate controls.

### 10. Aggregate And Row Charting

Aggregate chart:

- Read-only stacked area chart.
- Shows active rows stacked by row color.
- Metrics above chart: Peak, Daily Energy, Loads count.
- Legend width matches row info panel width.

Individual rows:

- Mini-area SVG charts using absolute kW values.
- Shared individual y-axis max.
- Same x-axis labels as aggregate chart.
- X-axis rendered only in chart column.

Tests:

- Unit tests verify aggregate stacked inputs have one layer per row.
- Unit tests verify aggregate peak and daily energy match the rows.
- Unit tests verify shared individual axis uses max row peak.
- Browser smoke verifies legend/info panel alignment.
- Browser smoke verifies x-axis does not drift under the legend column.
- Browser smoke verifies aggregate changes after add/delete/duplicate.

### 11. Styling

Add Load Builder styles to `public/assets/css/styles.css`.

Style goals:

- Match the preview closely while using the current Energy App shell.
- Keep controls dense, engineering-oriented, and readable.
- Avoid adding a Tailwind dependency or build step.
- Preserve responsive behavior down to narrower desktop widths.

Tests:

- Manual browser smoke in dark and light theme if supported.
- Manual viewport check around desktop, laptop, and narrow widths.
- Verify text does not overflow buttons, chips, row titles, or metric areas.

### 12. Documentation

Update:

- `README.md`
- `docs/architecture.md`

Document:

- New `/projects/load-builder.html` route.
- New `load_profiles` table.
- New frontend modules.
- Load Builder is currently isolated from Storage/Rates.

Tests:

- Static docs review confirms route map includes Load Builder.
- Static docs review confirms Supabase table list includes `load_profiles`.

### 13. Final Verification Checklist

Run:

```powershell
node --check public\assets\js\features\load-builder.js
node --check public\assets\js\components\load-builder-ui.js
node --check public\assets\js\pages\load-builder.js
npm run -s test
```

Manual browser verification:

- Load Builder opens from every project page.
- Empty state appears for a project with no saved profiles.
- New Profile creates a named empty profile.
- Library drag/drop creates rows.
- Row selection works.
- Row reorder works.
- Delete works for unlocked rows.
- Duplicate works for unlocked rows.
- Lock/unlock works.
- Locked rows cannot be deleted or duplicated.
- Aggregate updates after add/delete/duplicate/reorder.
- Autosave status changes from `Saving...` to `Autosaved`.
- Profile switch modal opens another saved profile.
- Refresh keeps the selected saved profile data.
- Theme toggle still works.
