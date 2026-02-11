# Supabase Integration Summary

## Overview
The EnergyApp has been fully wired up with Supabase for persistent storage of projects and weather data. All API communication has been configured to use the database-first approach with appropriate caching strategies.

## What Was Configured

### 1. Server-Side Supabase Credential Injection (`server.js`)
**Status:** ✅ Complete

The development server now automatically injects Supabase credentials into all HTML files before serving them to the browser:
- `window.ENERGYAPP_SUPABASE_URL` - Project URL (https://wdsvqjbqftoxzlovyuzk.supabase.co)
- `window.ENERGYAPP_SUPABASE_ANON_KEY` - Anon API key for anonymous access

**How it works:**
- When an HTML file is requested, the server reads the file and injects a `<script>` block with the credentials
- This script is inserted before any other scripts load, ensuring `supabase-client.js` has access to the credentials
- Credentials can be overridden via environment variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY`

### 2. Database Tables (Already Configured via Migrations)

#### `projects` table
Stores facility/project metadata:
- `id` (text, primary key) - Unique project identifier
- `name` (text) - Project/facility name
- `location_lat`, `location_lng` (double precision) - GPS coordinates
- `selected_date` (text) - Currently selected date for the project
- `map_state` (jsonb) - Saved map view state (center, zoom, bounds)
- `created_at`, `updated_at` (timestamptz) - Timestamps

#### `assets` table
Stores solar and wind asset configurations:
- `id` (text, primary key) - Unique asset identifier
- `project_id` (text, FK) - Reference to parent project (CASCADE delete)
- `asset_type` (text) - Either 'solar' or 'wind' (enforced by CHECK constraint)
- `name` (text) - Asset display name
- `model` (jsonb) - Complete asset configuration (capacity, efficiency, etc.)
- `created_at`, `updated_at` (timestamptz) - Timestamps

#### `nrel_cache` table
Stores cached weather data from NREL API:
- `id` (bigint, identity, primary key) - Internal ID
- `project_id` (text, FK) - Reference to parent project (CASCADE delete)
- `dataset` (text) - Either 'solar' or 'wind' (enforced by CHECK constraint)
- `date_key` (text) - Date identifier for cache key
- `source_year`, `interval_minutes` (integer) - Weather data metadata
- `wkt` (text) - Well-Known Text geometry for the location
- `timezone` (text) - Timezone of the location
- `source` (text) - Data source ('nrel_proxy')
- `fetched_at` (timestamptz) - When the data was cached
- `payload` (jsonb) - Actual weather records (15-minute intervals)
- `created_at`, `updated_at` (timestamptz) - Timestamps

**Unique Constraint:** `(project_id, dataset, date_key, source_year, interval_minutes)`
- Ensures only one cached record per project/dataset/date combination
- Used for efficient upsert operations

**Indexes:**
- `nrel_cache_project_dataset_idx` - For fast lookups by project and dataset
- `nrel_cache_payload_gin_idx` - For efficient JSONB pattern matching

### 3. Row-Level Security (RLS) Policies

All tables have RLS enabled with intentionally permissive policies for the `anon` role:
- **projects_anon_all:** Full CRUD access for anonymous users
- **assets_anon_all:** Full CRUD access for anonymous users  
- **nrel_cache_anon_all:** Full CRUD access for anonymous users

**Security Note:** 
- This configuration supports a no-login experience
- Data is public-editable (any user can read/write all rows)
- Future enhancement: Add user authentication and owner-based RLS policies

## Data Flow Architecture

### Project Loading Flow
```
1. User navigates to app → gets project ID from URL
2. app.js calls supabaseService.getProject(projectId)
3. Project metadata loaded from `projects` table (via Supabase or fallback to localStorage)
4. Project location is applied to the map
5. loadProjectWeather() is called
```

### Weather Data Loading Flow
```
1. fetchDataset({ lat, lng }) is called with project location
2. Check cache first: supabaseService.getNrelCache(projectId, dataset, ...)
3. If cache exists AND is fresh (< 24h old):
   → Use cached payload immediately via hydrateDataStore()
   → User sees data instantly
4. If cache missing or stale:
   → Fetch fresh data from /api/nrel-proxy (NREL API)
   → Parse CSV response into typed records
   → Store in database via supabaseService.upsertNrelCache()
   → Use fresh data via hydrateDataStore()
5. UI displays loaded data with success message showing record counts
```

### Asset Management Flow
```
1. User configures solar/wind assets on assets.html
2. Each asset modification calls supabaseService.upsertAsset()
3. Asset stored in `assets` table with project FK
4. Next load: supabaseService.listAssets(projectId) retrieves all project assets
5. App filters and displays assets for computation
```

## Persistence Guarantees

### When Supabase is Configured (Production)
- **Projects:** Stored immediately in database, available across devices/sessions
- **Assets:** Stored immediately in database, loaded with project
- **Weather Data:** Cached for 24 hours; stale data triggers automatic refresh from NREL

### Fallback Behavior (No Supabase)
- All data stored in browser localStorage under keys:
  - `energyapp.db.projects`
  - `energyapp.db.assets`
  - `energyapp.db.nrelCache`
- Limited to browser storage quota (~5-10MB)
- Data lost if browser storage is cleared

## Weather Data Caching Strategy

**Cache Lookup Key:** `(project_id, dataset, date_key, source_year, interval_minutes)`
- `project_id` - Links cache to specific project
- `dataset` - 'solar' or 'wind'
- `date_key` - Set to 'all' for annual data
- `source_year` - 2014 (year of NREL data)
- `interval_minutes` - 15 (15-minute intervals)

**TTL (Time To Live):** 24 hours
- Databases evolve; cached data older than 24h is considered stale
- Users can manually refresh via "Refresh Weather Data" button to force immediate NREL fetch

**Upsert Behavior:**
- Uses PostgreSQL `ON CONFLICT` clause to update existing cache
- Maintains only latest fetch per project/dataset
- Older fetches are replaced, not kept

## Testing & Verification

### Verification Checklist
- [x] Server injects Supabase credentials into HTML
- [x] Database tables created with correct schema
- [x] Unique constraint on nrel_cache prevents duplicates
- [x] RLS policies allow anon CRUD access
- [x] supabase-client.js has full CRUD methods for all tables
- [x] app.js checks cache before calling NREL API
- [x] Weather payloads stored in nrel_cache.payload (JSONB)
- [x] All npm tests pass

### To Test End-to-End
1. Start the server: `node server.js`
2. Navigate to http://localhost:8000/projects.html
3. Create a new project
4. Select a location on the map
5. Observe weather data loading (via database cache or NREL API)
6. Close browser and reopen
7. Navigate back to same project
8. Verify weather data loads from cache (faster, no NREL call)

## Configuration

### Environment Variables (Optional)
Set these to override default credentials:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### Browser Console Debugging
```javascript
// Check if Supabase is configured
window.ENERGYAPP_SUPABASE_URL  // Should show project URL
window.ENERGYAPP_SUPABASE_ANON_KEY  // Should show API key

// Check current Supabase service
window.EnergySupabaseService  // Exposes all persistence methods
```

## Next Steps / Recommendations

### Immediate (Working, No Changes Needed)
- ✅ Projects are stored persistently in Supabase
- ✅ Weather data is cached in Supabase with 24h TTL
- ✅ Cache is checked first before calling NREL API
- ✅ Manual refresh functionality works

### Future Enhancements

1. **User Authentication**
   - Add Supabase Auth
   - Update RLS policies to enforce user ownership
   - Allow users to share projects with team members

2. **Enhanced Caching**
   - Update cache TTL based on dataset availability
   - Add cache statistics/monitoring dashboard
   - Allow users to view cache hit/miss rates

3. **Data Export**
   - Export weather data as CSV
   - Export project configuration as JSON
   - Historical analysis of cached data

4. **Performance**
   - Add pagination to large datasets
   - Implement batch operations for asset management
   - Cache project list with last-modified tracking

## Troubleshooting

### "Unable to load projects" Error
- Check browser console for Supabase connection errors
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected
- Check network tab for failed Supabase API calls
- Ensure database hasn't exceeded quota

### Weather Data Won't Load
- Check if Supabase cache has data: `SELECT COUNT(*) FROM nrel_cache`
- Verify NREL API key in server.js is valid
- Check if NREL API is responding: `curl https://developer.nrel.gov/...`
- Monitor localStorage quota (cache might fail silently if full)

### Stale Weather Data
- Click "Refresh Weather Data" button to force NREL fetch
- Cache TTL is 24 hours - manually refresh if older data needed
- Check `fetched_at` timestamp in nrel_cache table

