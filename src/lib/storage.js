import { supabase } from "./supabaseClient";
import { logAudit } from "./audit";

// Same key/value shape as before (loadKey/saveKey), so App.jsx didn't need
// to change at all — only where the data actually lives changed.
//
// Every save is logged to audit_log automatically, tagged with whichever
// key changed (e.g. "expenses", "progress") so the Audit Log tab can show
// a readable trail of who changed what.

export async function loadKey(key, fallback) {
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback;
  return data.value;
}

export async function saveKey(key, value) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("kv_store").upsert({
    key,
    value,
    updated_by: user?.id || null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("storage save failed", key, error);
    return;
  }
  logAudit("data_saved", { key });
}
