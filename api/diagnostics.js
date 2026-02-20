const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

module.exports = (req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        supabase: {
          url: SUPABASE_URL,
          anonKeyPresent: !!SUPABASE_ANON_KEY,
          anonKeyLength: SUPABASE_ANON_KEY?.length || 0,
        },
        server: {
          nodeVersion: process.version,
          env: process.env.NODE_ENV || "development",
        },
      },
      null,
      2
    )
  );
};
