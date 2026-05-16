# MapLibre + OpenFreeMap 3D Weather Map Plan

## Goal

Replace the current Leaflet weather map with a MapLibre-based implementation that keeps the existing 2D street and satellite experiences, adds a no-account/no-key 3D mode, and preserves weather-location selection behavior.

User-facing requirements:

- Keep 2D street view.
- Keep 2D satellite view.
- Add 3D view.
- In 3D view, allow common 3D interactions: pitch, rotate, pan, and zoom.
- When switching back to Street or Satellite, force the map back to flat 2D.
- Persist the selected map mode per project.
- Avoid paid services, accounts, and API keys.
- Include terrain in the initial release.
- Keep 3D controls implicit through native map gestures rather than adding visible 3D control buttons.

## Task Tracker

| # | Task | Status | Tests / Verification |
|---:|---|---|---|
| 1 | Confirm no-account terrain source | Complete | Verify source documentation allows no account/API key; confirm MapLibre supports `raster-dem` with `terrarium` encoding; record final DEM URL and attribution requirements. |
| 2 | Smoke-test OpenFreeMap + AWS terrain in browser | Complete | Created `public/dev/maplibre-openfreemap-terrain-smoke.html`; verified OpenFreeMap style and AWS DEM tiles load over localhost without CORS failures; captured `tmp/maplibre-openfreemap-terrain-smoke.png`. |
| 3 | Inspect OpenFreeMap style layers | Complete | Confirmed source ID `openmaptiles`, existing `building` and `building-3d` layers, `render_height` / `render_min_height` extrusion fields, and label layers above building layers. |
| 4 | Replace Leaflet includes with MapLibre | Complete | Replaced weather page Leaflet CSS/JS with MapLibre GL JS; ran `node --check public/assets/js/pages/weather.js`; verified weather page loads with MapLibre canvas and no Leaflet globals required. |
| 5 | Implement MapLibre map adapter | Complete | Added MapLibre weather map adapter, mode control, marker helpers, map-state serialization helper, and `tests/frontend/weather-map-state.test.js`; manually verified initialization, mode switching, center/zoom restore, and terrain source attribution. |
| 6 | Rebuild 2D Street mode | Complete | Verified Street mode uses OpenFreeMap, remains at actual camera pitch `0` and bearing `0`, disables rotation, supports map rendering, and preserves attribution. |
| 7 | Rebuild 2D Satellite mode | Complete | Verified Satellite mode uses the current Esri imagery with subtle OpenFreeMap label overlays, remains at actual camera pitch `0` and bearing `0`, disables rotation, supports map rendering, and preserves attribution. |
| 8 | Add 3D mode with terrain | Complete | Verified 3D mode switches to MapLibre terrain with AWS terrain attribution; confirmed actual camera pitch, terrain source, and `dragRotate` enabled in 3D; confirmed switching back to Satellite returns actual pitch/bearing to `0` and disables drag rotation. |
| 9 | Add 3D building extrusions | Complete | Verified OpenFreeMap's existing `building-3d` fill-extrusion layer renders in Boulder hillside, Manhattan dense urban, and sparse/suburban checks; labels remain above buildings; no custom fallback heights were added. |
| 10 | Recreate location selection and marker behavior | Complete | Tested with a throwaway Supabase project; verified Select on Map, hover marker creation, click-to-select, marker replacement, location display, reverse geocode city update, and project lat/lng/mapState persistence. |
| 11 | Persist map mode and 3D camera state | Complete | Tested with a throwaway project; verified 3D mode and pitch/bearing persisted across reload; verified Satellite reloads flat at actual pitch `0`, bearing `0`; updated default mode to 3D for projects without a saved mode. |
| 12 | Full regression verification | Complete | Ran `node --check` for edited JS files and `npm run -s test`; manually verified weather page map rendering, weather data restoration, chart rendering, period/interval controls, legend controls, navigation links, mode switching, and map attribution. |
| 13 | Make 3D use satellite terrain by default | Complete | Verified 3D mode displays Esri imagery draped over AWS terrain; confirmed terrain attribution remains visible; confirmed Street/Satellite 2D behavior is unchanged. |
| 14 | Add optional vector overlay layers in 3D | Complete | Verified OpenFreeMap label/building overlay layers sit above satellite terrain while non-overlay vector base layers are hidden. |
| 15 | Tune 3D building overlay behavior | Complete | Verified `building-3d` uses restrained styling in 3D, appears above zoom `15`, and drops out below zoom `15`; Street mode restores the original building extrusion styling. |
| 16 | Add imagery/vector layer transition QA | Complete | Verified switching 3D -> Street -> Satellite does not leave stale layers visible; verified pitch/bearing reset and terrain removal in 2D modes. |

## Original State

- The weather page loads Leaflet from CDN in `public/projects/weather.html`.
- Map logic is implemented directly in `public/assets/js/pages/weather.js`.
- Street layer uses OpenStreetMap raster tiles.
- Satellite layer uses Esri World Imagery raster tiles.
- Current map behavior includes:
  - project location marker,
  - click-to-select mode,
  - hover marker while selecting,
  - draggable marker updates,
  - persisted center, zoom, and bounds in `project.mapState`,
  - reverse geocode city lookup,
  - weather/rates refresh hooks.

## Proposed Stack

- Map engine: MapLibre GL JS.
- No-key vector street/3D basemap: OpenFreeMap.
- Satellite imagery: keep the current Esri World Imagery source unless MapLibre migration exposes a cleaner no-key satellite source with acceptable terms.
- 3D buildings: MapLibre `fill-extrusion` layer using OpenFreeMap/OpenStreetMap-derived building data where available.
- Terrain: MapLibre terrain using a no-account raster DEM source, to be validated during the discovery spike.

## Terrain Source Decision

Use AWS Open Data Terrain Tiles as the initial no-account/no-key DEM source:

```js
{
  id: "terrain-dem",
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  tileSize: 256,
  encoding: "terrarium",
  maxzoom: 15
}
```

MapLibre can consume this as a `raster-dem` source and enable terrain with:

```js
map.setTerrain({ source: "terrain-dem", exaggeration: 1.0 });
```

Why this is acceptable for the first release:

- The dataset is listed as AWS Open Data.
- AWS says the public dataset has no subscription requirement.
- AWS says open data resources are available with or without an AWS account.
- The source is documented as global bare-earth terrain heights.
- The tiles are available in Terrarium PNG format, which MapLibre supports.
- No application account, API key, or paid tile provider is required.

Remaining caveats:

- This is elevation/terrain only. It does not provide buildings or map labels.
- Terrain resolution varies by underlying source. It is not site-survey precision.
- Production reliability is better than random demo tiles, but there is no app-specific SLA.
- Attribution and citation should be preserved in the map attribution or docs.
- We should test CORS/tile loading in-browser before doing the full Leaflet replacement.

Do not use MapLibre's demo terrain tiles for production. They are fine for examples, but AWS Open Data Terrain Tiles are the better no-key candidate for this app.

## Smoke Test Findings

- Served smoke test page: `public/dev/maplibre-openfreemap-terrain-smoke.html`.
- Screenshot artifact: `tmp/maplibre-openfreemap-terrain-smoke.png`.
- OpenFreeMap style URL loaded successfully from `https://tiles.openfreemap.org/styles/liberty`.
- OpenFreeMap vector source ID is `openmaptiles`.
- AWS Terrarium DEM tiles loaded successfully from `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`.
- Browser network inspection showed DEM tile requests returning `200` without CORS failures.
- OpenFreeMap Liberty already includes:
  - `building` fill layer,
  - `building-3d` fill-extrusion layer,
  - `render_height` and `render_min_height` fields for extrusion,
  - label layers above building layers.
- The live weather page now uses MapLibre GL JS in place of Leaflet and defaults to 3D mode when a project has no saved map mode.
- 3D mode enables MapLibre drag rotation and terrain. Browser automation confirmed the handler state; true right-click-drag feel should still get a quick human pass because the available automation surface does not synthesize that exact gesture.
- A throwaway project `codex-maplibre-test-*` was created for location-selection and persistence QA, then deleted after verification.
- Known non-blocking console noise:
  - OpenFreeMap Liberty may warn about missing sprite images for some POI icons.
  - The live project can emit one Supabase `PATCH` 400 during utility/timezone metadata refresh; map, weather, chart, and persistence workflows continue to function.
- Satellite 3D upgrade findings:
  - 3D now uses Esri World Imagery as the visible base layer.
  - AWS terrain remains active in 3D.
  - Non-overlay OpenFreeMap vector layers are hidden in 3D so the view reads as satellite imagery, not street map styling.
  - Label and building overlay layers remain available above imagery.
  - `building-3d` is visible only at zoom `15+` in 3D and uses restrained opacity/color.
  - Street mode restores the original vector style and building extrusion styling.
  - Satellite mode is flat imagery with subtle OpenFreeMap label overlays.

## Current Map Implementation

The current implementation has completed the MapLibre + OpenFreeMap migration for the weather page and keeps the interface to three compact mode buttons:

- `Satellite`
- `Street`
- `3D`

Current mode behavior:

- `Satellite`: flat Esri World Imagery with subtle OpenFreeMap symbol label overlays.
- `Street`: flat OpenFreeMap vector street map.
- `3D`: Esri World Imagery draped over AWS terrain, with subtle OpenFreeMap labels and restrained `building-3d` extrusions above zoom `15`.

Current 3D composition:

```text
3D mode = Esri satellite imagery draped over AWS terrain
        + subtle OpenFreeMap label overlays
        + restrained OpenFreeMap building extrusions above zoom 15
```

This better matches the app's project-siting use case because users can inspect real ground imagery, hillsides, surrounding land uses, access roads, rooftops, and terrain context while still using pitch/rotate interactions.

Layer orchestration:

- Satellite and 3D modes both use the Esri imagery raster source.
- Satellite mode keeps only OpenFreeMap symbol label layers visible above imagery.
- 3D mode keeps label layers and the `building-3d` layer visible above imagery.
- Non-overlay OpenFreeMap vector layers are hidden in Satellite and 3D so the map reads as imagery rather than a street basemap.
- Street mode restores the original OpenFreeMap vector style and building extrusion styling.

Camera and interaction behavior:

- Satellite and Street modes force pitch `0` and bearing `0`.
- 3D mode restores the saved pitch/bearing when available, otherwise uses pitch `55` and bearing `0`.
- Right-click drag rotation and touch rotation are enabled only in 3D.
- Pan and zoom remain available in all modes.

Current defaults:

- First-time/default map mode is `3d`.
- 3D terrain uses AWS Open Data Terrain Tiles with Terrarium encoding and exaggeration `1.1`.
- 3D buildings use the native OpenFreeMap `building-3d` layer and source height fields where available.
- Satellite labels use the same OpenFreeMap symbol overlay filtering as 3D labels.

Tradeoffs:

- OSM-derived building extrusions over satellite imagery can look approximate.
- Labels may need stronger halos or lower opacity to remain readable over imagery.
- Building coverage and height accuracy will vary by location.
- Esri imagery remains the no-key imagery source for now.

## Architecture Approach

Keep the migration local to the weather page first. Do not change API routing, weather provider contracts, shared cache schema, or generation/storage chart behavior unless the map-state shape requires a narrowly scoped compatibility update.

Create a small map adapter inside `public/assets/js/pages/weather.js` or a new page-local helper if the code becomes clearer. The adapter should hide MapLibre-specific details behind operations the weather page already needs:

- initialize map,
- set map mode,
- get map state,
- restore map state,
- add/update/remove marker,
- enable/disable select-on-map hover marker,
- listen for click, marker drag, and moveend events.

This keeps the weather data logic from becoming tangled with map engine details.

## Map Modes

Use three persisted modes:

```js
"street"
"satellite"
"3d"
```

Expected behavior:

- `street`: 2D vector street map, pitch `0`, bearing `0`, drag rotation disabled.
- `satellite`: 2D satellite imagery with subtle labels, pitch `0`, bearing `0`, drag rotation disabled.
- `3d`: satellite imagery draped over terrain, subtle labels, restrained building extrusions above zoom `15`, pitch and bearing restored from saved state, drag rotation enabled.

Mode switching rules:

- Switching from `3d` to `street` or `satellite` animates or snaps to pitch `0` and bearing `0`.
- Switching from `street` or `satellite` to `3d` restores saved 3D pitch/bearing if available; otherwise use a conservative default such as pitch `55` and bearing `0`.
- Pan and zoom remain available in all modes.
- Right-click drag and touch rotation are available only in 3D mode.

## Persisted Map State

Extend `project.mapState` in a backwards-compatible way:

```js
{
  center: { lat, lng },
  zoom,
  bounds: { north, south, east, west },
  city,
  mode: "street" | "satellite" | "3d",
  pitch,
  bearing,
  threeD: {
    pitch,
    bearing,
    zoom
  }
}
```

Notes:

- Existing projects without `mode`, `pitch`, or `bearing` should continue to load.
- `threeD` is optional but useful if we want separate 2D and 3D camera memory.
- The final shape should stay simple. If `pitch` and `bearing` are enough, skip `threeD`.

## Implementation Steps

### 1. Terrain and Style Smoke Test

- Load OpenFreeMap styles and AWS Open Data Terrain Tiles in a small local test page or isolated branch code.
- Inspect source/layer names for streets, buildings, and labels.
- Verify in-browser terrain tile loading, CORS behavior, and terrain rendering.
- Test at least three representative locations:
  - dense urban area with buildings,
  - hillside or mountainous terrain,
  - sparse/suburban project-like area.
- Confirm attributions required for OpenFreeMap, OpenStreetMap, Esri, and AWS/Mapzen terrain.
- Outcome: pick exact style URLs, source IDs, layer IDs, and final DEM configuration.

### 2. Replace Leaflet Includes

- In `public/projects/weather.html`, replace Leaflet CSS/JS with MapLibre GL CSS/JS.
- Keep the existing `#map` container.
- Leave chart, shell, Supabase, and weather scripts unchanged.

### 3. Implement MapLibre Initialization

- Initialize the map with the selected project map mode or fallback mode.
- Default to the current project location if present.
- Otherwise use the current default center `[39.742, -105.1786]`.
- Add WebGL failure/error handling with a clear status message.

### 4. Recreate Street Mode

- Use OpenFreeMap vector style for street mode.
- Disable pitch and rotation.
- Verify labels, roads, and basic visual density fit the app.

### 5. Recreate Satellite Mode

- Migrate the existing Esri World Imagery layer into MapLibre as a raster source/layer.
- Keep attribution visible.
- Disable pitch and rotation.
- Keep subtle OpenFreeMap symbol label overlays visible above imagery.

### 6. Add 3D Mode

- Use Esri World Imagery as the visible base layer.
- Add terrain using AWS Open Data Terrain Tiles.
- Keep only useful OpenFreeMap vector overlays above imagery:
  - subtle labels,
  - `building-3d` extrusions above zoom `15`,
  - future project asset overlays.
- Add sky/fog only if it improves depth without making the app feel decorative.
- Enable pitch, bearing, right-click drag rotation, touch rotation, pan, and zoom.
- Keep controls implicit; avoid adding visible orbit/pitch widgets.

### 6A. Satellite 3D Upgrade

- Use Esri World Imagery as the base layer in 3D mode.
- Keep AWS Open Data Terrain Tiles as the terrain source.
- Hide or de-emphasize the full OpenFreeMap street styling in 3D mode.
- Add only the useful OpenFreeMap vector overlays:
  - labels above imagery,
  - `building-3d` with restrained styling above zoom `15`,
  - future project asset overlays.
- Verify Street and Satellite 2D modes still reset to pitch `0` and bearing `0`.
- Verify 3D mode still restores saved pitch/bearing and keeps drag rotation enabled.

### 7. Add 3D Building Extrusions

- Add a `fill-extrusion` layer above landuse/roads and below labels where possible.
- Prefer source height fields when available.
- Use building levels fallback only if layer data supports it.
- Avoid aggressive fallback heights that make low-detail areas misleading.
- Keep styling quiet and utilitarian so the map remains an input surface, not a visual toy.

For the recommended satellite 3D upgrade, building extrusions should be treated as an overlay, not the visual foundation of the map. Use a restrained neutral color, moderate opacity, and a higher minimum zoom threshold.

### 8. Recreate Location Selection

- Replace Leaflet marker logic with MapLibre marker logic.
- Preserve:
  - Select on Map button behavior,
  - hover marker while selecting,
  - click to set weather location,
  - draggable selected marker,
  - project latitude/longitude update,
  - reverse geocode city update,
  - weather/rates invalidation behavior.

### 9. Recreate Map Persistence

- Replace `getMapState()` with MapLibre equivalents:
  - `map.getCenter()`,
  - `map.getZoom()`,
  - `map.getBounds()`,
  - `map.getPitch()`,
  - `map.getBearing()`.
- Persist `mode`.
- Persist pitch/bearing only from 3D mode, or persist globally while forcing 2D modes to restore as pitch `0`, bearing `0`.

### 10. UI/CSS Cleanup

- Replace Leaflet-specific CSS assumptions with MapLibre-compatible styling.
- Keep the map in the existing layout.
- Avoid adding visible 3D instruction text or explanatory UI.
- If map-mode controls are needed, use a compact segmented control or MapLibre-compatible layer switcher pattern matching the app's existing button style.

### 11. Verification

Run the standard frontend verification after code changes:

```powershell
node --check public/assets/js/pages/weather.js
npm run -s test
```

Manual checks:

- Weather page loads with existing projects.
- Street mode is flat 2D.
- Satellite mode is flat 2D with imagery and labels.
- 3D mode loads satellite imagery, terrain, labels, and zoom-gated buildings.
- 3D mode supports pitch, rotate, pan, and zoom.
- Switching back to Street/Satellite forces pitch `0` and bearing `0`.
- Selected map mode persists per project.
- Location selection still works.
- Dragging marker still saves the project location.
- Weather data loading still works.
- Browser reload restores location and map mode.
- WebGL or tile failures show a useful non-blocking error.
- Mobile gestures do not trap the page in an unusable state.

## Risks and Tradeoffs

- Terrain has a workable no-account path through AWS Open Data Terrain Tiles and has been smoke-tested in browser.
- OpenFreeMap availability is convenient but may not provide commercial-grade support or guarantees.
- Building heights are only as good as OpenStreetMap-derived data. Some areas will have strong coverage; others will be sparse or flat.
- Satellite imagery remains separate from OpenFreeMap and currently uses Esri World Imagery.
- MapLibre introduces WebGL requirements. Most modern browsers are fine, but fallback/error handling matters.
- Map engine selection and persistence have been migrated, so future regression testing should keep focusing on weather location workflows.

## Resolved Implementation Decisions

- OpenFreeMap `liberty` is the current style.
- First-time/default map mode is `3d`.
- The current map state stores one zoom and saved pitch/bearing, rather than a separate 3D zoom.
- AWS Open Data Terrain Tiles are the initial DEM source.
- 3D buildings are enabled above zoom `15`.
- Existing mode labels remain `Satellite`, `Street`, and `3D`.

## Reference Links

- OpenFreeMap: https://openfreemap.org/
- OpenFreeMap styles: https://tiles.openfreemap.org/styles/liberty
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- MapLibre terrain example: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- MapLibre fill extrusion example: https://maplibre.org/maplibre-gl-js/docs/examples/3d-extrusion-floorplan/
- AWS Open Data Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- AWS Marketplace Terrain Tiles: https://aws.amazon.com/marketplace/pp/prodview-x7vtai3hasf26
- Terrarium Elevation MapLibre example: https://madewithmaplibre.com/basemaps/styles/aws-terrarium
- OpenStreetMap Simple 3D Buildings: https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings
- OpenStreetMap tile usage policy: https://operations.osmfoundation.org/policies/tiles/
