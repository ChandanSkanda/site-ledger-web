import { useState, useEffect } from "react";
import { Loader2, Hammer, LogOut } from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { logAudit } from "./lib/audit";
import App from "./App";

const C = { navy: "#16324F", rust: "#B7451F", paper: "#E7E2D3", ink: "#20242A", concrete: "#7C7768", line: "#CFC8B6" };

// Accounts are NOT self-signup — this is deliberately closed. You create
// exactly the two logins you want (you + your brother) from the Supabase
// dashboard (Authentication → Users → Add user), and set each person's
// role in the `profiles` table. See supabase/schema.sql and the README.
function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    logAudit("login", { email });
    onSignedIn(data.user);
  };

  return (
    <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        style={{ background: "#fff", border: `1px solid ${C.line}` }}
        className="w-full max-w-sm rounded-lg p-6"
      >
        <div className="flex items-center gap-2 mb-5">
          <Hammer style={{ color: C.rust }} size={22} />
          <span style={{ color: C.ink, fontWeight: 700 }} className="text-lg uppercase tracking-wide">Site Ledger</span>
        </div>
        <label className="block mb-3">
          <span style={{ color: C.concrete }} className="block text-xs font-semibold uppercase mb-1">Email</span>
          <input
            style={{ border: `1.5px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", width: "100%" }}
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </label>
        <label className="block mb-4">
          <span style={{ color: C.concrete }} className="block text-xs font-semibold uppercase mb-1">Password</span>
          <input
            style={{ border: `1.5px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", width: "100%" }}
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </label>
        {error && <p style={{ color: "#A33A2E" }} className="text-sm mb-3">{error}</p>}
        <button
          type="submit" disabled={loading}
          style={{ background: C.navy, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }}
          className="font-semibold text-sm flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [role, setRole] = useState("member");
  const [name, setName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from("profiles")
      .select("role, name")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setRole(data?.role || "member");
        setName(data?.name || session.user.email);
      });
  }, [session]);

  const signOut = async () => {
    await logAudit("logout", { email: session?.user?.email });
    await supabase.auth.signOut();
  };

  if (session === undefined) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onSignedIn={() => {}} />;
  }

  return <App currentUser={{ email: session.user.email, name, role }} onSignOut={signOut} />;
}
