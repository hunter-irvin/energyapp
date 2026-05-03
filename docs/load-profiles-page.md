# Load Profiles Page

## Task Summary

| Task # | Status | Area | Current State | Tests / Verification |
| --- | --- | --- | --- |
| 1 | Completed | Product decisions | MVP supports multiple named profiles per project, empty-start creation, autosave, hardcoded Library templates, drag/drop row adds, row delete/copy, hidden lock controls, and isolated persistence. | Plan reconciled against implemented page behavior and updated PRD below. |
| 2 | Completed | Persistence | `load_profiles` table and Supabase client helpers support per-project profile list/get/upsert/delete flows. | Migration/service tests plus browser persistence checks. |
| 3 | Completed | Core logic | Pure Load Builder helpers exist for templates, rows, aggregate math, stats, validation, locking, duplication, deletion, reorder, and hover index math. | Unit tests cover helper behavior and 96-point / 25-row constraints. |
| 4 | Completed | Static page | `/projects/load-builder.html` exists and mounts through the shared project shell. | Static test plus `node --check`. |
| 5 | Completed | Navigation | Project nav now links to `Load Profiles` across the app, with `projectId` preserved. | Static test plus browser navigation smoke. |
| 6 | Completed | React bridge UI | The TSX preview has been translated into the repo's UMD React bridge architecture. | `node --check`; browser checks for layout, menus, charts, and alignment. |
| 7 | Completed | Landing workflow | Users first land on a `Load Profiles` table with `New Profile`, then open an editor view for a selected profile. | Browser smoke verifies create/open/switch flows. |
| 8 | Completed | Library drag/drop | Library templates are hardcoded and can be dropped anywhere in the Layers workspace with nearest-slot insertion. | Unit tests and browser drag/drop smoke. |
| 9 | Completed | Autosave | Edits persist automatically and the manual save button has been removed from the MVP workflow. | Status pill and reload persistence verified in browser. |
| 10 | Completed | Charts | Aggregate and layer charts render with aligned plot areas, shared axes behavior, zero-line treatment for layers, and hover tooltips. | Unit tests, syntax checks, and browser hover/alignment checks. |
| 11 | Completed | Docs | Architecture docs and README were updated for the new page and persistence model. | Static doc review completed earlier in the implementation. |
| 12 | Completed | Edit mode foundation | Single-row edit mode is live with selected-row `Edit`, double-click entry, row-level `Done` / `Cancel`, lock protection, and transient edit-session state. | Unit tests plus browser smoke for button and double-click entry, single active editor, and `Cancel` restore behavior. |
| 13 | Completed | Adaptive smooth-curve editing | Control points are derived from the current row shape, constrained to `2..24`, and simplified aggressively so clean curves stay legible. | Unit tests cover flat, sinusoidal, and irregular curve extraction, min/max guardrails, and simplification of noisy rows. |
| 14 | Completed | Point editing and live preview | Point dragging now snaps to 15-minute intervals, clamps at zero, and updates the aggregate preview live during editing. | Unit tests for point-drag math, clamping, and 96-sample resampling; browser smoke verifies live aggregate updates. |
| 15 | Completed | Whole-shape transform | Dragging the chart body now shifts the whole shape horizontally with wrap-around and scales it vertically while preserving zero-valued samples. | Unit tests cover wrap-around shift, proportional scaling, zero preservation, and non-negative output. |
| 16 | Completed | Multi-point selection | `Shift+click` multi-select, grouped point dragging, point add-on-double-click, and keyboard delete for selected points are now supported for the extracted control points. | Unit tests cover additive selection state, grouped movement, point insertion, near-duplicate rejection, and delete guardrails. |
| 17 | Future work | Advanced handles | True design-tool bezier-style handles remain deferred until the extracted-point workflow proves usable. | Keep deferred until the next product pass. |
| 18 | Completed | Stable point insertion | Adding a control point now preserves the current 96-sample curve until the user moves that point; insertion adds a handle on the existing curve instead of resampling the whole profile from sparse points. | Unit tests prove add-point is visually no-op for `draftValues`, creates one selected point at the snapped interval, rejects near-duplicates without changing values, and still commits 96 non-negative samples. Browser smoke verifies double-click add does not shift the curve. |
| 19 | Completed | Stable point identity and deletion | Existing edit points are protected from disappearing because of collision, normalization, transform, or endpoint deletion. Point movement stops before colliding with neighbors, endpoints remain protected, and delete removes only explicitly selected interior points. | Unit tests cover collision-bounded single and grouped movement, endpoint delete protection, selected-only delete behavior, and transform preserving point ids/count where possible. Browser smoke verifies moving/adding/deleting points does not silently remove unrelated points. |
| 20 | Completed | Denser curve-aware extraction | Initial edit mode now exposes more points for multi-curve profiles: endpoints, active segment boundaries, local peaks/troughs, and meaningful slope/curvature changes, while still honoring the `2..24` guardrail. | Unit tests use representative load shapes with multiple ramps/plateaus/peaks and assert expected interior control points are present. Regression tests cover flat, sinusoidal, noisy, and screenshot-like lighting curves. Browser smoke verifies the shown point set matches visible bends. |
| 21 | Completed | Persistent layer edit points | Layer rows now persist their edit-point handles inside the profile JSON so re-entering edit mode restores user-authored point structure instead of re-deriving points from values every time. | Unit tests verify edit sessions restore saved `editPoints`, `Done` persists current handles with committed 96-value samples, and legacy rows without points still derive handles on first edit. Browser smoke verifies points survive `Done` and edit re-entry. |
| 22 | Completed | Editor visual polish | The editor now uses a flush two-panel layout, page-shell dark blue backgrounds, standard divider lines, thinner styled scrollbars, and no rounded outer editor containers. | Browser checks verified left rail/background colors, divider parity, page scrolling, and template-library scrolling after 8 cards. |
| 23 | Completed | Layer selection layout | Layer rows now collapse when unselected, hide metrics/actions, and expand selected charts with a dedicated x-axis matching the aggregate chart. | Browser checks verified selected-row expansion, unselected-row collapse, chart/info height matching, and selected-only x-axis labels. |
| 24 | Completed | Layer actions and labels | Layer titles wrap to two lines, selected rows show discrete edit/copy/delete icon buttons, rename is triggered by clicking the layer name, and lock controls are hidden. | Static tests and browser smoke verified no overflow menu, selected-only controls, icon actions, and long-name wrapping. |
| 25 | Completed | Selection/deselect interaction | Selected rows remain selected after `Done`; single-click deselect waits 200 ms so double-click chart editing still works. | Static test checks the delay/cancel plumbing; browser smoke verified double-click edit and single-click collapse behavior. |
| 26 | Completed | Page navigation and metrics polish | The editor no longer shows a redundant `Load Builder` title, the primary nav order places Load Profiles between Storage and Rates, the Profiles button is aligned with the Library title, and aggregate metrics now show larger `Peak`, `Daily Energy`, and `Load Layers: N` stats. | Static tests and browser checks verified nav order, button alignment, and updated metrics text. |

## Merged MVP State

- The nav label is `Load Profiles`, not `Load Builder`.
- The first view is a profile landing page with:
  - page title `Load Profiles`
  - `New Profile` button left-aligned below the header divider
  - profile table with `Name`, `Updated`, and aggregate preview
- Opening or creating a profile transitions to the editor view.
- The editor does not show a redundant `Load Builder` title.
- The editor left rail contains:
  - `Profiles` back button aligned with the Library title column
  - `Library`
- The editor workspace contains:
  - profile name
  - autosave status pill
  - larger `Peak / Daily Energy / Load Layers` metrics in the header
  - `Aggregate Load`
  - `Layers`
- New profiles start empty.
- Library templates are hardcoded defaults for now.
- Adding Library loads is drag/drop only.
- Saving is automatic while editing an existing named profile.
- Selected row actions are discrete icon buttons for edit, copy, and delete.
- Layer rename is triggered by clicking the layer name.
- Lock controls are hidden while the product direction is reconsidered.
- Load Builder is isolated for now and does not yet feed other product areas.

## Completed Build Areas

### Persistence and data model

- `load_profiles` persists multiple saved profiles per project.
- Profile payloads store the editor model as JSON.
- Supabase helpers support list/get/upsert/delete.
- URL state supports `profileId` so the selected profile can be reopened directly.

### Core editor behavior

- Profiles use 15-minute intervals and 96 values per day.
- Rows are created from normalized templates and scaled into absolute `kW` values.
- Aggregate math, daily energy math, selection, duplication, delete, lock/unlock, and reorder all flow through pure helper functions.
- Drag/drop now supports dropping anywhere inside the Layers list, with insertion based on the nearest slot above or below the hovered row.

### UI and workflow

- The original top-level builder header was removed from the editor in favor of a cleaner two-panel layout.
- Editor panels are flush against the shell with divider lines rather than rounded buffered containers.
- The editor and left navigation backgrounds match the app's dark blue page-shell treatment.
- The template Library scrolls internally after eight preview cards; Layers use the page scrollbar.
- Scrollbars are thinner, light blue, and arrowless, with dark blue tracks.
- Aggregate and layer chart columns are aligned.
- Aggregate and shell dividers use the same standard border treatment.
- The aggregate legend aligns with the plot area, not the x-axis label row.
- Individual layer fills stop at the true zero baseline.
- Hover tooltips exist for aggregate and individual layer charts.
- The aggregate chart always keeps its x-axis.
- Unselected layer charts hide x-axis labels and collapse to the height of their compact info panels.
- A selected layer expands vertically, shows an x-axis matching the aggregate chart, and pushes nearby layers down.
- Selected layer info panels match the chart plot area height, excluding the x-axis label row.
- Unselected layers hide Peak/Total stats and action buttons.
- Layer titles can wrap to two lines.
- Individual layer edit mode now includes:
  - selected-row icon-button `Edit`
  - double-click entry on the mini chart
  - adaptive extracted control points
  - `Done` / `Cancel`
  - point dragging with live aggregate preview
  - chart-body transform for wrap-around shift and proportional scaling
  - `Shift+click` multi-select with grouped dragging
  - double-click add for new points snapped to the 15-minute grid
  - `Backspace` / `Delete` removal of selected points, respecting the 2-point minimum

### Tooltip behavior

- Aggregate tooltip shows:
  - time
  - total value
  - each visible layer name and value at that point
- Layer tooltip shows:
  - time
  - layer name
  - layer value at that point
- Tooltip units are `kW`.
  - This is intentional because the tooltip reports an instantaneous load value at a time sample.
  - `kWh` remains correct for total daily energy metrics, not point hover values.

## Future Work To Preserve

- Spline/profile editing
- Numeric interval editing
- Rename profile from the switcher/landing workflow
- Delete profile from the switcher/landing workflow
- Editable peak scaling controls
- Mute/unmute row actions
- Change row color
- Reset row to template
- Scenario management beyond simple open/switch
- Seasonal or weekday/weekend assignment workflows
- CSV import
- Measured-load overlay
- Direct aggregate editing
- Copy/paste interval segments

## Current Verification Standard

Run after meaningful editor changes:

```powershell
node --check public\assets\js\features\load-builder.js
node --check public\assets\js\components\load-builder-ui.js
node --check public\assets\js\pages\load-builder.js
npm run -s test
```

Manual browser checks should continue to cover:

- landing page open/create/open-switch flows
- autosave and refresh persistence
- drag/drop into empty and populated Layers states
- row select/deselect, selected-only actions, and edit/copy/delete behavior
- aggregate/layer chart alignment
- selected-layer x-axis and expansion behavior
- tooltip rendering
- left-nav and `projectId` preservation

---

## Appendix A: Updated PRD

# Energy App Load Profiles PRD

## 1. Overview

The Load Profiles feature is a new Energy App workflow for creating a generic 24-hour aggregate load profile for a site. It is intended for energy modelers who need to compose a site-level daily demand curve from multiple individual load profiles.

The core metaphor is still a layered timeline. Each individual load is represented as a row aligned to the same 24-hour x-axis. The aggregate chart above the rows shows the sum of all active individual loads at each time interval.

This PRD has been updated to reflect the implementation we merged, while preserving explicit future-work items.

## 2. Current Scope

### In scope for the current implementation

- Project-level `Load Profiles` landing page.
- Multiple saved named profiles per project.
- Empty-start profile creation.
- Generic 24-hour daily profile.
- Default interval resolution: 15 minutes.
- 96 values per profile: 24 hours x 4 intervals per hour.
- Absolute `kW` values for individual load rows.
- Normalized shape previews in the Library.
- Read-only aggregate load chart.
- Stacked aggregate area chart showing contribution from each individual load.
- Individual load rows with mini-area charts.
- Shared x-axis scale between aggregate chart and individual load charts.
- Aggregate chart always displays x-axis tick marks and labels.
- Individual layer x-axis tick marks and labels appear only on the selected layer.
- Shared absolute y-axis max across individual load rows.
- Autosave model, with visible status.
- Up to 25 individual load rows.
- Group/category metadata for loads.
- Row selection state.
- Row info panel with grabber, title, category/group, selected-only peak/total values, and selected-only edit/copy/delete actions.
- Hardcoded Library templates.
- Drag/drop row creation from Library templates.
- Row reordering.
- Selected-row icon actions for edit, copy, and delete.
- Hover tooltips for aggregate and layer charts.
- Point authoring in row edit mode:
  - double-click adds a point at the nearest 15-minute interval
  - add is ignored when too close to an existing control point
  - new points become the current selection
  - `Backspace` and `Delete` remove the selected point set
  - delete respects the 2-point minimum

### Explicitly out of scope for this implementation

- CSV import.
- Measured-load overlay.
- Direct editing of the aggregate chart.
- Calendar/date-specific profiles.
- Full scenario management.
- Advanced spline manipulation UI.
- Copy/paste interval segments.
- Multi-profile seasonal assignment workflow.
- Profile rename/delete from the modal or landing workflow.
- Undo/Redo controls.

## 3. Product Goals

1. Let modelers quickly build a site-level load shape from reusable load templates.
2. Preserve visibility into how each individual load contributes to the aggregate curve.
3. Make time alignment obvious across all charts.
4. Prioritize precision and engineering clarity over playful chart manipulation.
5. Provide a foundation for future assignment of profiles to weekday/weekend/summer/winter and other qualitative attributes.

## 4. Page Placement

The feature lives inside the existing Energy App shell.

Expected app frame:

- Existing top header with project name and theme controls.
- Existing left app navigation rail.
- Navigation item: `LOAD PROFILES`.
- Main page content rendered to the right of the navigation rail.

## 5. Workflow Structure

The feature now has two views:

1. **Profiles landing view**
2. **Profile editor view**

### Profiles landing view

Contains:

- Page title: `Load Profiles`
- `New Profile` button
- Table of existing profiles

Current table columns:

- `Name`
- `Updated`
- `Aggregate Preview`

### Editor view

Contains two primary columns:

1. **Library panel** on the left
2. **Profile workspace** on the right

Recommended column widths:

- Library: 320 px
- Workspace: flexible remaining width

## 6. Library Panel

### Purpose

The Library contains reusable load templates. These templates are previewed as normalized shapes, even though loads added to the workspace become absolute `kW` profiles.

### Contents

- `Profiles` back button above the panel, aligned with the Library title
- `Library` title
- Add button placeholder
- Search field
- Filter chips:
  - All
  - Residential
  - Commercial
  - Industrial
- Load cards

Seed library starts with 30 hardcoded templates, split evenly across the three primary categories. Templates remain normalized 96-point shapes with a single-device/default-system `defaultPeakKw` magnitude that scales the row into absolute `kW` values when added to a profile.

### Load card design

Each card contains:

- Grabber icon
- Load name
- Category label
- Small normalized curve preview

### Current interaction

Users can drag a Library card into the Layers workspace.

Behavior:

- Drop into empty area: create the first row
- Drop into populated list: insert into the closest slot
- Newly created row becomes selected
- Aggregate chart updates immediately
- If the list already has 25 rows, the drop is rejected with a non-blocking message

## 7. Profile Workspace Header

The editor workspace header includes:

- Active profile name
- Autosave status pill
- Compact metrics in the same header area:
  - Peak
  - Daily Energy
  - Load Layers

The previous page-level `SAVE PROFILE` button is no longer part of the MVP flow. Creation is handled with `New Profile` on the landing page, and edits autosave while the user works.

## 8. Aggregate Load Chart

### Purpose

Shows the sum of all unmuted individual load rows at each 15-minute interval.

### Behavior

- Aggregate chart is read-only.
- Direct manipulation of aggregate is not supported in MVP.
- Aggregate updates whenever rows are added, removed, reordered, duplicated, or locked/unlocked in ways that affect the active stack.

### Visual design

- Title centered: `Aggregate Load`
- Legend on the left side of the chart
- Legend width matches the individual row info panel width
- Legend height aligns with the aggregate plot area
- Chart on the right is a stacked area chart
- Divider below aggregate uses the same standard line treatment as the page shell

### Metrics

Metrics are now shown in the profile header rather than in a separate strip above aggregate. The current count label is `Load Layers: N`.

### Hover tooltip

Aggregate hover tooltip shows:

- Time
- Total load value at that interval
- Each visible layer name and value at that interval

Tooltip values use `kW`, not `kWh`, because they represent instantaneous sampled load values.

### Aggregate calculation

For each interval `i`:

```ts
aggregate[i] = rows.reduce((sum, row) => {
  return sum + (row.muted ? 0 : row.values[i] || 0);
}, 0);
```

At 15-minute resolution, daily energy is:

```ts
dailyEnergyKwh = aggregate.reduce((sum, value) => sum + value, 0) * 0.25;
```

## 9. Layers

### Purpose

The Layers list is the main editing surface. It shows each individual load as a horizontal track aligned with the aggregate chart.

### Section title

Current merged label: `Layers`

### Row structure

Each row has two major units:

1. Info panel
2. Chart panel

The info panel width matches the aggregate legend width.

### Info panel contents

- Grabber icon
- Color indicator
- Load title
- Group/category label
- Peak value, shown only when selected
- Total `kWh`, shown only when selected
- Edit, copy, and delete icon buttons, shown only when selected

### Chart panel

Each load row chart:

- Uses a mini-area chart
- Uses absolute `kW` values
- Uses the same x-axis scale as the aggregate chart
- Displays x-axis tick marks and labels only when selected
- Shares a common y-axis max with all individual load rows
- Has a y-axis overlay showing max and 0
- Includes a thin zero baseline
- Only shows fill above the zero baseline
- Expands vertically when selected and collapses when unselected

### Hover tooltip

Each layer chart shows:

- Time
- Layer name
- Value at that interval in `kW`

### Shared individual y-axis

All individual load rows share one y-axis max so their magnitudes are visually comparable.

Current logic:

```ts
individualAxisMax = Math.ceil(Math.max(...rows.map((row) => row.peak), 1));
```

## 10. Editing Model

### Implemented MVP interactions

- Select row by clicking it
- Deselect a selected row with a single click after a 200 ms delay
- Drag rows to reorder
- Double-click the chart area to enter edit mode without triggering the delayed deselect
- Add load from Library by drag/drop
- Update aggregate automatically after changes
- Autosave changes

### Current selected-row actions

- Edit
- Copy
- Delete

### Future row/profile actions

- Lock/unlock
- Change group/category
- Edit peak `kW`
- Mute/unmute
- Change color
- Reset to Library template
- Edit interval values numerically
- Advanced spline handles
- Draw/ramp/flatten selected range

## 11. Time Shift Behavior

Current behavior:

- Shifting past midnight should wrap around the 24-hour boundary
- No clipping at midnight

This is now supported inside row edit mode through chart-body dragging.

## 12. Data Model

Recommended row shape remains:

```ts
type LoadProfile = {
  id: string | number;
  name: string;
  group: string;
  category?: string;
  color: string;
  peak: number;
  kwh: number;
  muted: boolean;
  locked: boolean;
  selected?: boolean;
  values: number[]; // length 96 for 15-minute intervals
  sourceTemplateId?: string;
  editPoints?: Array<{
    id: string;
    index: number; // 0..95, snapped to 15-minute intervals
    valueKw: number;
  }>;
};
```

Recommended Library template shape remains:

```ts
type LoadTemplate = {
  id: string | number;
  name: string;
  category: string;
  normalizedValues: number[]; // values from 0 to 1
  defaultPeakKw?: number;
  color?: string;
};
```

## 13. Constraints and Validation

- Maximum rows: 25
- Each row has exactly 96 interval values in MVP
- Values are non-negative
- Lock controls are currently hidden in the UI while product direction is reconsidered.
- Aggregate is not directly editable
- Individual y-axis is shared across rows
- X-axis extents remain consistent across aggregate and individual chart areas

## 14. Autosave

Autosave is the active persistence model.

Behavior:

- Status pill near profile title
- States include:
  - `Saving...`
  - `Autosaved`
  - `Error saving`
- No explicit save action is required for normal editing

## 15. Implementation Notes

- The preview file was a layout mockup, not a production architecture target.
- Production implementation now uses the repo's UMD React bridge pattern.
- Alignment contract remains important: aggregate legend width equals individual row info panel width.
- Hover tooltip units were corrected to `kW` for sampled point values.
- Row editing now uses an extracted-point smooth-curve session that resamples back into the persisted 96-value profile.

## 16. Open Questions For Later

- How should profiles be assigned to weekday/weekend/summer/winter attributes?
- Should profile attributes be manually assigned, inferred, or both?
- Should Library templates be organization-level, project-level, or user-specific?
- Should scenario management be part of this page or a separate workflow?
- Should row groups support collapse/expand and group-level aggregate subtotals?
- Should future edits be interval-table-first, chart-first, or both?

---

## Appendix B: Next Phase Plan For Layer Shape Editing

## Goal

Add direct curve editing for individual load layers so users can shape a load profile visually, using interaction patterns inspired by design tools, while preserving the current 96-point / 15-minute data model and autosave workflow.

## Confirmed Product Decisions

- We will start with a simpler smooth-curve editor first, not full bezier-handle editing on day one.
- Users can enter edit mode by:
  - choosing `Edit` from the selected row's icon buttons
  - double-clicking the row's mini-area chart
- In edit mode, the row shows:
  - editable points on the curve
  - a `Done` button
  - a `Cancel` button
- Users can add points by double-clicking the line or chart area while editing.
- Added points snap to the nearest 15-minute interval.
- Point insertion is ignored if the requested location is too close to an existing control point.
- Users can delete the current point selection with `Backspace` or `Delete`.
- If multiple points are selected, delete removes all selected points together.
- Point deletion should do nothing if it would reduce the row below the 2-point minimum.
- Whole-shape vertical drag should scale the shape proportionally.
- Any values already at `0` should remain `0` during proportional scaling.
- Horizontal movement should snap to 15-minute intervals.
- Whole-shape horizontal shifting should wrap around the 24-hour boundary.
- `Done` commits the edit and flows into autosave.
- `Cancel` discards the active edit session and restores the row's pre-edit state.
- Aggregate should preview live while the user edits.
- `Cancel` should restore the edited row and its aggregate effect, while leaving unrelated page state alone.
- For noisy curves, the extraction heuristic should bias toward fewer points for a cleaner editing experience.
- The control-point extraction heuristic should never produce fewer than `2` points or more than `24` points.

## Control Point Strategy

The preferred direction is to make editable points depend on the existing curve shape rather than forcing every row to expose a fixed number of points.

Examples:

- A flat base-load row should likely expose only the minimum needed control points, such as two endpoints.
- A sinusoidal or cyclical row should expose points around peaks and troughs.
- A more irregular custom row should expose a denser set of points based on meaningful bends in the sampled curve.

Recommended implementation approach:

- Derive a control-point set from the current 96-sample row when edit mode begins.
- Use curve-analysis heuristics to identify:
  - endpoints
  - local maxima
  - local minima
  - major slope-change or curvature-change locations
- Clamp the extracted control-point set to a minimum of `2` and a maximum of `24` points.
- Let the edit session operate on those derived control points.
- Resample the edited smooth curve back into the existing 96 stored values on `Done`.

Why this is a good fit:

- It matches the visual expectation that simpler shapes should have fewer editable points.
- It keeps the editor cleaner and less noisy.
- It avoids forcing users to manipulate 96 interval points directly in MVP.
- It favors an editor that stays legible even when the underlying sampled row is noisy.

Complexity note:

- This is more complex than exposing a fixed point set.
- It is still practical for MVP if we treat it as a deterministic "point extraction from samples" problem rather than trying to invent a freeform vector editor from scratch.
- The safest first implementation is:
  - derive a reduced control-point set from the curve
  - allow editing of that set
  - resample back to 96 values
- In ambiguous cases, the heuristic should underfit slightly rather than overfit, so users see fewer, more meaningful points.
- The `2..24` guardrail should make the experience more predictable across both extremely simple and very noisy rows.

## Corrective Tasks For Precision Curve Editing

These tasks address observed behavior where adding a point can dramatically reshape the load curve, existing points can disappear while editing, and multi-curve profiles can enter edit mode with too few interior control points.

### Task 18: Stable point insertion

Implementation status:

- Completed in the current build.

- Treat `draftValues` as the edit-session source of truth during point insertion.
- Adding a point should sample the current curve/value at the snapped 15-minute interval and insert a handle there.
- Adding a point should not immediately regenerate the whole curve from the sparse control-point set.
- The curve should visually remain unchanged until the user moves the new point.
- Near-duplicate insertion should be rejected without changing `points`, `selectedPointIds`, or `draftValues`.
- The newly inserted point becomes the only selected point when insertion succeeds.

Tests / verification:

- Unit test: adding a point to a representative curve keeps `draftValues` byte-for-byte or numerically equivalent before movement.
- Unit test: added point index snaps to the nearest 15-minute interval and `valueKw` matches the current curve at that index.
- Unit test: near-duplicate add returns the original session unchanged.
- Unit test: `Done` after point insertion still commits exactly 96 non-negative samples.
- Browser smoke: double-click add on a visible curve does not shift the rendered profile or aggregate preview.

### Task 19: Stable point identity and deletion

Implementation status:

- Completed in the current build.

- Stop silently deleting points during normalization when a move/add collides with an existing point.
- Clamp point movement before the selected point or selected group reaches neighboring unselected points.
- Preserve point ids and selection state across point movement and whole-shape transforms where possible.
- Keep endpoints non-deletable so the edit-session boundary remains stable.
- Delete should remove only explicitly selected interior points.
- Whole-shape transform should transform existing points with the shape rather than re-derive a replacement point set from the transformed values.

Tests / verification:

- Unit test: moving a point into a neighbor clamps before collision and preserves both points.
- Unit test: grouped movement clamps before colliding with unselected neighbors.
- Unit test: endpoint delete requests are ignored while selected interior points can still be deleted.
- Unit test: delete does not remove unselected points.
- Unit test: transform preserves point ids/count unless a documented wrap boundary rule requires otherwise.
- Browser smoke: add, move, transform, and delete operations do not make unrelated points disappear.

### Task 20: Denser curve-aware extraction

Implementation status:

- Completed in the current build.

- Improve initial point extraction so visible curve structure is represented by editable points.
- Include endpoints, active segment starts/ends, local peaks/troughs, and meaningful slope or curvature changes.
- Raise or remove the current practical preference for very sparse point sets when the row has multiple visible curve events.
- Keep the hard maximum of `24` points and the minimum of `2` points.
- Continue to simplify genuinely noisy input, but do not collapse multi-ramp or multi-plateau shapes into a single middle point.

Tests / verification:

- Unit test: flat/base-load rows still produce the minimum useful point set.
- Unit test: sinusoidal rows include peak/trough control points.
- Unit test: multi-ramp lighting-like rows include points around each visible ramp, plateau, and drop.
- Unit test: noisy rows still simplify under the `24` point maximum without producing visually useless density.
- Unit test: extraction never returns fewer than `2` or more than `24` points.
- Browser smoke: entering edit mode on a multi-curve layer shows handles at the visible bends shown in the chart.

## Recommended MVP Editing Scope

### Phase 1: Foundational edit mode

- Only one row can be in edit mode at a time.
- Locked rows cannot enter edit mode if legacy data contains locked rows.
- Reorder drag/drop is disabled for the row being edited.
- Selected rows expose an `Edit` icon button.
- Double-clicking the mini-area chart enters edit mode.
- Edit mode shows a stronger curve outline, anchor points, and `Done` / `Cancel` controls in the chart area.

Tests / verification:

- Browser smoke verifies entering edit mode from the selected-row button and double-click.
- Browser smoke verifies legacy locked rows cannot enter edit mode.
- Static/UI checks confirm only one row can be edited at once.

### Phase 2: Smooth curve point editing

- Introduce a temporary edit-session model for the active row.
- Represent the editable row using anchor points over a smooth interpolated curve.
- Derive the initial anchor points from the existing row shape, rather than always using a fixed number of points.
- Dragging a point updates the shape.
- Point movement snaps horizontally to the 15-minute grid.
- Point movement clamps vertically at `0`.
- The visual area fill continues to stop at the zero baseline.
- Aggregate preview updates live while the user edits.

Recommended implementation note:

- Keep persisted row data as 96 absolute `kW` samples.
- Use the edit-session model only while the row is being edited.
- Generate the draft control-point set when edit mode starts.
- On `Done`, resample the edited curve back into the 96 stored values.

Tests / verification:

- Unit tests for point-drag math and 15-minute snapping.
- Unit tests for zero-floor clamping.
- Unit tests confirm edited output still returns exactly 96 non-negative values.
- Unit tests for control-point extraction from representative curve types:
  - flat/base load
  - sinusoidal/peak-trough load
  - irregular custom load
- Unit tests verify noisy sampled inputs simplify toward fewer points rather than exposing a dense point set.
- Browser smoke verifies point dragging changes the shape and aggregate updates after commit.
- Browser smoke verifies aggregate previews live during drag.

### Phase 3: Whole-shape transform

- Clicking and dragging the chart body, rather than a point, enters whole-shape transform behavior.
- Horizontal drag shifts the shape left/right with wrap-around.
- Vertical drag scales the shape proportionally.
- Samples already equal to `0` remain `0` under proportional scaling.
- Transform behavior should preserve the row's general shape while changing timing or amplitude.

Implementation status:

- Completed in the current build.

Tests / verification:

- Unit tests for wrap-around shifting.
- Unit tests for proportional scaling while preserving zeros.
- Unit tests for non-negative output after transforms.
- Browser inspection confirms the chart body exposes a distinct transform affordance during edit mode.

### Phase 4: Multi-point selection

- `Shift+click` selects multiple points.
- Dragging one selected point moves the selected set together.
- Group movement still snaps to 15-minute intervals.
- Group movement still clamps at `0`.
- `Backspace` and `Delete` remove the active point selection.
- Deleting selected points respects the 2-point minimum.
- Double-clicking the edited chart adds a new point at the nearest 15-minute interval.
- New point insertion is ignored when too close to an existing control point.
- A newly added point becomes the only selected point.

Implementation status:

- Completed in the current build.

Tests / verification:

- Unit tests for additive selection state.
- Unit tests for grouped point movement.
- Unit tests for point insertion, duplicate-proximity rejection, and delete floor behavior.
- Browser inspection confirms multi-select visual state for edit points.

### Phase 5: Future advanced handles

- Add in/out handles on points for true design-tool-style curve shaping.
- Support direct handle dragging for curvature control.
- Preserve current snapping/clamping/wrap-around constraints where relevant.

Tests / verification:

- Unit tests for handle geometry and curve sampling stability.
- Browser smoke verifies handle drag updates the curve without invalid geometry.

## Proposed UI Structure

### Row display states

1. Default state
- Current mini-area chart
- Selected-row edit/copy/delete icon buttons

2. Selected state
- Existing selected styling

3. Edit state
- Stronger curve emphasis
- Anchor points visible
- Optional grid emphasis
- `Done` and `Cancel` controls inside the chart frame, top-right
- Non-edit interactions on that row suppressed while editing

### Edit controls

- `Done`: commits sampled values into the row model, updates aggregate, and triggers autosave
- `Cancel`: exits edit mode and restores the original row values from the start of the edit session

## State Model Recommendation

Add a transient page-controller edit session, separate from persisted row state.

Recommended shape:

```ts
type LoadLayerEditSession = {
  rowId: string;
  originalValues: number[];
  draftValues: number[];
  points: Array<{
    id: string;
    index: number; // 0..95, snapped to 15-minute intervals
    valueKw: number;
  }>;
  selectedPointIds: string[];
  mode: "point" | "transform";
};
```

Notes:

- `originalValues` powers `Cancel`.
- `draftValues` powers live aggregate preview during editing.
- `points` supports smooth-curve manipulation during editing.
- On `Done`, the current points are persisted back to the row as `editPoints` alongside the committed 96-sample `values`.
- On re-entering edit mode, saved `editPoints` are restored first; rows without saved points still derive handles from their current values.
- `points.length` should always stay within the `2..24` extraction guardrail in MVP.

## Interaction Rules

- Curves can never go below `0`.
- All edited output must remain 96 samples long.
- Horizontal edits snap to the current 15-minute cadence.
- Whole-shape horizontal shift wraps around 24 hours.
- Scaling preserves zero-valued samples as zero.
- Only one row can be edited at a time in MVP.
- Editing a locked row is not allowed if legacy data contains locked rows.

## Implementation Risks To Watch

- Smooth interpolation can overshoot below zero even when anchor points do not.
- Resampling a smooth curve back to 96 stored samples can introduce visual mismatch if the curve renderer and sampler do not share the same interpolation logic.
- Whole-shape scaling needs to feel predictable near zero-heavy shapes.
- Multi-point dragging can become noisy if selection affordances are not visually explicit.

## Suggested Build Order

1. Edit session state and entry/exit controls
2. Single-point smooth-curve editing
3. `Done` / `Cancel` commit-revert behavior
4. Whole-shape horizontal wrap shift
5. Whole-shape proportional vertical scaling
6. Multi-point selection and grouped drag
7. Later: true handle-based curve shaping

## Remaining Clarifying Questions

- None at the planning level right now. Chart-body drag remains the whole-shape transform gesture.
