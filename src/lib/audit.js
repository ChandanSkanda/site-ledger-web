import { supabase } from "./supabaseClient";
import { getActiveProjectId } from "./activeProject";

// Writes one row to audit_log for every action worth being able to answer
// "who did this, and when" about later — signups, joins, logins, logouts,
// and every data change. Called automatically by storage.js on every
// save, and manually from AuthGate.jsx for the account/project events.
export async function logAudit(action, details = {}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      project_id: getActiveProjectId(),
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      details,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
