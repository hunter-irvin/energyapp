const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runSupabaseRequiredTests = () => {
  const clientPath = path.join(__dirname, "..", "..", "public", "assets", "js", "core", "supabase-client.js");
  const source = fs.readFileSync(clientPath, "utf8");

  assert.ok(
    source.includes("Supabase is required for persistence. Check Supabase credentials and SDK loading."),
    "Expected explicit Supabase-required error message in data service."
  );
  assert.ok(
    /if \(!client\)\s*{[\s\S]*throw new Error\("Supabase is required for persistence\./.test(source),
    "Expected data service to throw when Supabase client is unavailable."
  );
  assert.ok(
    /return supabaseDb\(client\);/.test(source),
    "Expected data service to return Supabase backend directly."
  );
};

module.exports = { runSupabaseRequiredTests };

