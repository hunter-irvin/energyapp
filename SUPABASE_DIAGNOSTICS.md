# Supabase Integration - Diagnostic & Fix Guide

## Issue Summary

The app is running but **no data is being written to Supabase**. The database tables are completely empty (0 projects, 0 assets, 0 nrel_cache records).

### What We've Confirmed

✅ **Server Configuration:** Correct
- Supabase URL is configured: `https://wdsvqjbqftoxzlovyuzk.supabase.co`
- Supabase ANON key is present (208 characters)
- Server is successfully injecting credentials into HTML

✅ **Database Schema:** Correct
- `projects` table exists with correct columns
- `assets` table exists with correct constraints
- `nrel_cache` table exists with unique constraints
- RLS policies allow anonymous access

❌ **App-to-Supabase Communication:** NOT WORKING
- **Zero requests** from the app to Supabase REST API in last 24 hours
- All data operations still work (app functions correctly)
- But data is only stored in browser localStorage, not Supabase

## Root Cause Analysis

The most likely causes (in order of probability):

1. **Supabase JS SDK failed to load from CDN**
   - `window.supabase` is undefined
   - App silently falls back to localStorage
   - No error is shown to user

2. **Corporate firewall/proxy blocking CDN**
   - CDN request fails (404, 403, timeout)
   - SDK doesn't load
   - Browser may hide error in console

3. **Browser extension blocking CDN**
   - Some ad blockers block JS libraries
   - uBlock Origin, Ghostery, etc. can block jsdelivr.net

4. **DNS resolution failure**
   - Can't resolve cdn.jsdelivr.net
   - Request never reaches Supabase

## Diagnostic Steps

### Step 1: Check Diagnostic Page

The app now includes a diagnostic page that tests Supabase integration:

1. **Start the server:** `node server.js`
2. **Open in browser:** `http://localhost:8000/diagnostics.html`
3. **Check results:**
   - Section 1: Do you see✅ **Credentials successfully injected**?
   - Section 2: Do you see ✅ **Supabase JS SDK loaded successfully**?
   - Section 3: Do you see ✅ **REST API is reachable**?
   - Section 4: Do you see ✅ **Supabase client created**?
   - Section 5: Do you see ✅ **Successfully queried projects table**?

### Step 2: Check Browser Console

Press **F12** to open Developer Tools and go to **Console**:

Look for these messages:

If you see this, Supabase is working:
```
[Supabase Client Init] Starting initialization
  hasSupabase: true
  hasURL: true
  hasKey: true
```

If Supabase SDK didn't load, you'll see:
```
[Supabase Client Init] Starting initialization
  hasSupabase: false
  hasURL: true
  hasKey: true
```

### Step 3: Check Network Tab

Press **F12** > **Network** tab, then reload the page:

1. Look for requests to `cdn.jsdelivr.net`
   - Should see: `@supabase/supabase-js@2`
   - If **404** or **failed**, the SDK can't load
   
2. Look for requests to Supabase REST API:
   - Should see requests to `wdsvqjbqftoxzlovyuzk.supabase.co`
   - If missing, the app isn't trying to connect to database
   
3. Check those requests' Response Headers:
   - Look for any error messages about CORS, authentication, or RLS

## Solutions

### If SDK fails to load from CDN

**Option A: Disable Browser Extensions** (Quick test)
1. Open browser in incognito/private mode
2. Open http://localhost:8000/diagnostics.html
3. Check if Supabase SDK loads
4. If it works: A browser extension was blocking it

**Option B: Check Firewall/Proxy**
1. Try connecting to CDN directly: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
2. If it shows 404 or can't connect: Firewall/proxy is blocking
3. Ask IT to whitelist: `cdn.jsdelivr.net`

**Option C: Bundle SDK Locally** (Longer term)
- Install Supabase JS locally: `npm install @supabase/supabase-js`
- Modify server to serve it locally
- Edit `index.html` to load from `/lib/supabase-js.js` instead of CDN

### If REST API isn't reachable

1. Check if you can access Supabase from your machine:
   ```
   curl https://wdsvqjbqftoxzlovyuzk.supabase.co/rest/v1/projects
   ```
   
2. If 404 or timeout: 
   - Network is blocked
   - Firewall isn't allowing HTTPS to Supabase
   - DNS can't resolve `wdsvqjbqftoxzlovyuzk.supabase.co`

### If SDK loads but still no data in Supabase

1. Check browser console for errors like:
   - `[EnergySupabaseService] Error creating project: ...`
   - `[Supabase Client] Error ...`
   
2. Check Supabase Dashboard for failed requests:
   - Go to your Supabase project
   - Check "Database" > Logs for authorization errors
   - Check "Authentication" > Logs for permission issues
   
3. RLS policies might be blocking writes:
   - Go to Supabase Dashboard > Authentication > Policies
   - Verify `anon` role has INSERT, UPDATE, DELETE permissions

## Temporary Workarounds

While troubleshooting,  the app **still works fully** with localStorage fallback:

1. **Keep using the app** - all functionality works
2. **Data is persisted locally** in browser's localStorage
3. **When Supabase is fixed, just load the app again** - it will sync

## Error Messages to Share

If you still can't get it working, enable full error reporting:

1. Go to http://localhost:8000/projects.html
2. Open browser console (F12)
3. Copy all messages that contain "ERROR" or red text
4. Share those error messages for debugging

## Testing After Fix

Once you confirm Supabase is working:

1. Create a new project at http://localhost:8000/projects.html
2. Set a location on the map
3. Load weather data
4. Go to Supabase Dashboard > Database > projects table
5. ✅ You should see your project record

## Additional Debug Commands

You can check the database directly from your terminal:

```bash
# Check if projects table has data
curl -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  "https://wdsvqjbqftoxzlovyuzk.supabase.co/rest/v1/projects"

# Check it using Supabase CLI (if installed)
supabase db pull
supabase db list-postgres-tables
```

## Next Steps

1. **Visit the diagnostic page** at http://localhost:8000/diagnostics.html
2. **Share which section fails** (1-5)
3. **Check browser console** for error messages
4. **Try in incognito mode** to rule out browser extensions
5. **Test from a different network** to rule out firewall

Once we identify where it fails, we can apply a targeted fix!

