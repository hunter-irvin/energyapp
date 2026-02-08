import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

let cachedClient: ReturnType<typeof createClient<Database>> | null = null;

export const getSupabaseClient = () => {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  cachedClient = createClient<Database>(supabaseUrl, supabaseAnonKey);
  return cachedClient;
};
