const { URL } = require("url");
const { backfillV3FromLegacy } = require("../lib/v3/backfill-migration");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1` : "";

if (!REST_BASE || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error("Missing Supabase config. Set ENERGYAPP_SUPABASE_URL and ENERGYAPP_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const defaultHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

const rest = async ({ method = "GET", table, searchParams = null, body = null, headers = {} }) => {
  const url = new URL(`${REST_BASE}/${table}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  const response = await fetch(url.toString(), {
    method,
    headers: { ...defaultHeaders(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.message || payload?.error_description || `Supabase REST ${response.status}`;
    throw new Error(detail);
  }
  return payload;
};

const run = async () => {
  const summary = await backfillV3FromLegacy({ rest });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});
