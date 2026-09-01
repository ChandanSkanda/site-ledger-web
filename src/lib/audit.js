import { supabase } from "./supabaseClient";

// Writes one row to audit_log for every action worth being able to answer
// "who did this, and when" about later — logins, logouts, and every data
// change. Called automatically by storage.js on every save, and manually
// for login/logout from AuthGate.jsx.
export async function logAudit(action, details = {}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      details,
    });
  } catch (e) {
    // Never let audit logging break the app — just note it in the console.
    console.error("audit log failed", e);
  }
}
