import { supabase } from "./supabaseClient";
import { logAudit } from "./audit";
import { getActiveProjectId } from "./activeProject";

// Same key/value shape as before (loadKey/saveKey) — App.jsx doesn't need
// to change — except every row now also carries which project it belongs
// to, since one Supabase project can now host multiple house projects.

export async function loadKey(key, fallback) {
  const projectId = getActiveProjectId();
  if (!projectId) return fallback;
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("project_id", projectId)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback;
  return data.value;
}

export async function saveKey(key, value) {
  const projectId = getActiveProjectId();
  if (!projectId) {
    console.warn(`[SiteLedger] Save skipped — no active project (key: "${key}")`);
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("kv_store").upsert({
    project_id: projectId,
    key,
    value,
    updated_by: user?.id || null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`[SiteLedger] Save FAILED — "${key}":`, error.message);
    await logAudit("save_failed", { key, error: error.message });
    return false;
  }
  console.log(`[SiteLedger] Saved "${key}" successfully`);
  logAudit("data_saved", { key });
  return true;
}
