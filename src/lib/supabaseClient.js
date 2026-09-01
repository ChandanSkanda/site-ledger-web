import { createClient } from "@supabase/supabase-js";

// These come from your Supabase project (Settings → API) and are set as
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in your .env locally and in
// Vercel's Environment Variables when deployed. The anon key is safe to
// expose in the browser — real protection comes from Row Level Security
// policies in supabase/schema.sql, not from hiding this key.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
