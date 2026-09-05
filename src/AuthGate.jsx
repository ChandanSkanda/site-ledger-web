import { useState, useEffect } from "react";
import { Loader2, Hammer, Copy } from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { logAudit } from "./lib/audit";
import { setActiveProject } from "./lib/activeProject";
import { SIGNUP_ROLES, PROJECT_TYPES } from "./lib/roles";
import App from "./App";

const C = { navy: "#16324F", rust: "#B7451F", paper: "#E7E2D3", ink: "#20242A", concrete: "#7C7768", line: "#CFC8B6" };
const inputStyle = { border: `1.5px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", width: "100%" };
const labelStyle = { color: C.concrete };

function AuthCard({ children, wide }) {
  return (
    <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center p-4">
      <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className={`w-full ${wide ? "max-w-md" : "max-w-sm"} rounded-lg p-6`}>
        <div className="flex items-center gap-2 mb-5">
          <Hammer style={{ color: C.rust }} size={22} />
          <span style={{ color: C.ink, fontWeight: 700 }} className="text-lg uppercase tracking-wide">Site Ledger</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function genInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/* ---------------- Sign in / sign up (account level, no project yet) ---------------- */

function LoginScreen({ onSwitchToSignUp }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    logAudit("login", { email });
  };

  return (
    <AuthCard>
      <form onSubmit={submit}>
        <label className="block mb-3">
          <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Email</span>
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block mb-4">
          <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Password</span>
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={{ color: "#A33A2E" }} className="text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading} style={{ background: C.navy, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }} className="font-semibold text-sm flex items-center justify-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Sign in"}
        </button>
      </form>
      <button onClick={onSwitchToSignUp} style={{ color: C.rust }} className="text-xs font-semibold mt-4 block mx-auto">
        New here? Create an account
      </button>
    </AuthCard>
  );
}

function SignUpScreen({ onSwitchToSignIn }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    if (data.user) {
      await supabase.from("profiles").insert({ id: data.user.id, email, name });
    }
    setLoading(false);
    if (!data.session) {
      setConfirmMsg("Account created — check your email to confirm it, then sign in.");
    }
  };

  if (confirmMsg) {
    return (
      <AuthCard>
        <p style={{ color: C.ink }} className="text-sm mb-4">{confirmMsg}</p>
        <button onClick={onSwitchToSignIn} style={{ color: C.rust }} className="text-xs font-semibold">Back to sign in</button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form onSubmit={submit}>
        <label className="block mb-3">
          <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Your name</span>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block mb-3">
          <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Email</span>
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block mb-4">
          <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Password</span>
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        {error && <p style={{ color: "#A33A2E" }} className="text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading} style={{ background: C.rust, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }} className="font-semibold text-sm flex items-center justify-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Create account"}
        </button>
      </form>
      <button onClick={onSwitchToSignIn} style={{ color: C.rust }} className="text-xs font-semibold mt-4 block mx-auto">
        Already have an account? Sign in
      </button>
    </AuthCard>
  );
}

/* ---------------- Create or join a project (after account exists) ---------------- */

function ProjectGate({ userId, onReady }) {
  const [mode, setMode] = useState("create"); // "create" | "join"
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [type, setType] = useState(PROJECT_TYPES[0]);
  const [code, setCode] = useState("");
  const [role, setRole] = useState(SIGNUP_ROLES[0].value);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [createdMeta, setCreatedMeta] = useState(null);

  const createProject = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const inviteCode = genInviteCode();
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .insert({ name, place, type, created_by: userId, invite_code: inviteCode })
      .select()
      .single();
    if (pErr) {
      setLoading(false);
      setError(pErr.message);
      return;
    }
    const { error: mErr } = await supabase
      .from("project_members")
      .insert({ project_id: project.id, user_id: userId, role: "owner" });
    setLoading(false);
    if (mErr) {
      setError(mErr.message);
      return;
    }
    await logAudit("project_created", { name, project_id: project.id });
    setActiveProject(project.id, { name: project.name, place: project.place, type: project.type });
    setCreatedMeta({ name: project.name, place: project.place, type: project.type });
    setCreatedCode(inviteCode);
    // Small pause so the owner can see and copy the invite code before entering the app.
  };

  const joinProject = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data: project, error: findErr } = await supabase
      .from("projects")
      .select("*")
      .eq("invite_code", code.trim().toUpperCase())
      .maybeSingle();
    if (findErr || !project) {
      setLoading(false);
      setError("No project found with that code — double check it with the project owner.");
      return;
    }
    const { error: mErr } = await supabase
      .from("project_members")
      .insert({ project_id: project.id, user_id: userId, role });
    setLoading(false);
    if (mErr) {
      setError(mErr.message);
      return;
    }
    await logAudit("project_joined", { project_id: project.id, role });
    onReady(project.id, role, { name: project.name, place: project.place, type: project.type });
  };

  if (createdCode) {
    return (
      <AuthCard>
        <p style={{ color: C.ink }} className="text-sm mb-2">Project created. Share this code with anyone you want to join:</p>
        <div style={{ background: C.paper, border: `1px solid ${C.line}` }} className="rounded-md px-4 py-3 flex items-center justify-between mb-4">
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.15em" }} className="text-xl font-semibold">{createdCode}</span>
          <button onClick={() => navigator.clipboard?.writeText(createdCode)} style={{ color: C.rust }}><Copy size={16} /></button>
        </div>
        <p style={{ color: C.concrete }} className="text-xs mb-4">
          They'll enter this on the "Join a project" screen and pick their role. You can promote anyone to owner later from the Team tab.
        </p>
        <button
          onClick={() => onReady(null, "owner", createdMeta, true)}
          style={{ background: C.navy, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }}
          className="font-semibold text-sm"
        >
          Continue to the app
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard wide>
      <div className="flex gap-2 mb-5">
        <button onClick={() => setMode("create")} style={{ background: mode === "create" ? C.navy : "transparent", color: mode === "create" ? "#fff" : C.concrete, border: `1px solid ${C.line}`, borderRadius: 6 }} className="flex-1 py-2 text-sm font-semibold">Create a project</button>
        <button onClick={() => setMode("join")} style={{ background: mode === "join" ? C.navy : "transparent", color: mode === "join" ? "#fff" : C.concrete, border: `1px solid ${C.line}`, borderRadius: 6 }} className="flex-1 py-2 text-sm font-semibold">Join a project</button>
      </div>

      {mode === "create" ? (
        <form onSubmit={createProject}>
          <label className="block mb-3">
            <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Project name</span>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Whitefield house" required />
          </label>
          <label className="block mb-3">
            <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Place</span>
            <input style={inputStyle} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Bangalore" />
          </label>
          <label className="block mb-4">
            <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Type</span>
            <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {error && <p style={{ color: "#A33A2E" }} className="text-sm mb-3">{error}</p>}
          <button type="submit" disabled={loading} style={{ background: C.rust, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }} className="font-semibold text-sm flex items-center justify-center gap-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : "Create project — I'm the owner"}
          </button>
        </form>
      ) : (
        <form onSubmit={joinProject}>
          <label className="block mb-3">
            <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Invite code</span>
            <input style={{ ...inputStyle, textTransform: "uppercase", letterSpacing: "0.1em" }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AB12CD" required />
          </label>
          <label className="block mb-4">
            <span style={labelStyle} className="block text-xs font-semibold uppercase mb-1">Your role on this project</span>
            <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
              {SIGNUP_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          {error && <p style={{ color: "#A33A2E" }} className="text-sm mb-3">{error}</p>}
          <button type="submit" disabled={loading} style={{ background: C.navy, color: "#fff", borderRadius: 6, padding: "10px 0", width: "100%" }} className="font-semibold text-sm flex items-center justify-center gap-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : "Join project"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

/* ---------------- Choose between multiple projects ---------------- */

function ProjectSelector({ memberships, onSelect, onCreateOrJoinAnother }) {
  return (
    <AuthCard wide>
      <p style={{ color: C.ink }} className="text-sm font-semibold mb-3">Choose a project</p>
      <div className="space-y-2 mb-4">
        {memberships.map((m) => (
          <button
            key={m.project_id}
            onClick={() => onSelect(m)}
            style={{ background: C.paper, border: `1px solid ${C.line}`, textAlign: "left" }}
            className="w-full rounded-md px-4 py-3 flex items-center justify-between hover:opacity-80"
          >
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold text-sm">{m.projects?.name}</div>
              <div style={{ color: C.concrete }} className="text-xs">
                {[m.projects?.type, m.projects?.place].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span style={{ color: C.rust }} className="text-xs font-semibold uppercase">{m.role}</span>
          </button>
        ))}
      </div>
      <button onClick={onCreateOrJoinAnother} style={{ color: C.rust }} className="text-xs font-semibold block mx-auto">
        + Create or join another project
      </button>
    </AuthCard>
  );
}

/* ---------------- Top-level gate ---------------- */

export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [mode, setMode] = useState("signin");
  const [memberships, setMemberships] = useState(undefined); // undefined = loading, [] = none yet
  const [activeMembership, setActiveMembership] = useState(null);
  const [showSelector, setShowSelector] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchMemberships = async (userId) => {
    const { data: rows } = await supabase
      .from("project_members")
      .select("project_id, role, projects(name, place, type)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true });
    setMemberships(rows || []);
    return rows || [];
  };

  useEffect(() => {
    if (!session?.user) return;
    (async () => {
      const { data: profile } = await supabase.from("profiles").select("name").eq("id", session.user.id).maybeSingle();
      setName(profile?.name || session.user.email);
      const rows = await fetchMemberships(session.user.id);
      if (rows.length === 1) {
        setActiveProject(rows[0].project_id, rows[0].projects);
        setActiveMembership(rows[0]);
      }
    })();
  }, [session]);

  useEffect(() => {
    if (activeMembership) {
      setActiveProject(activeMembership.project_id, activeMembership.projects);
    }
  }, [activeMembership]);

  const signOut = async () => {
    await logAudit("logout", { email: session?.user?.email });
    await supabase.auth.signOut();
    setMemberships(undefined);
    setActiveMembership(null);
  };

  const switchProject = () => setShowSelector(true);

  if (session === undefined) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  if (!session) {
    return mode === "signin"
      ? <LoginScreen onSwitchToSignUp={() => setMode("signup")} />
      : <SignUpScreen onSwitchToSignIn={() => setMode("signin")} />;
  }

  if (memberships === undefined) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  const needsProjectGate = memberships.length === 0;
  const needsSelector = showSelector || (!activeMembership && memberships.length > 1);

  if (needsProjectGate) {
    return (
      <ProjectGate
        userId={session.user.id}
        onReady={async (projectId, role, meta) => {
          const rows = await fetchMemberships(session.user.id);
          const picked = projectId ? rows.find((r) => r.project_id === projectId) : rows[rows.length - 1];
          const finalMembership = picked || { project_id: projectId, role, projects: meta };
          setActiveProject(finalMembership.project_id, finalMembership.projects);
          setActiveMembership(finalMembership);
          setShowSelector(false);
        }}
      />
    );
  }

  if (needsSelector) {
    return (
      <ProjectSelector
        memberships={memberships}
        onSelect={(m) => {
          setActiveProject(m.project_id, m.projects);
          setActiveMembership(m);
          setShowSelector(false);
        }}
        onCreateOrJoinAnother={() => setMemberships([])}
      />
    );
  }

  if (!activeMembership) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  return (
    <App
      key={activeMembership.project_id}
      currentUser={{
        id: session.user.id,
        email: session.user.email,
        name,
        role: activeMembership.role,
        projectName: activeMembership.projects?.name,
        projectPlace: activeMembership.projects?.place,
        projectType: activeMembership.projects?.type,
      }}
      onSignOut={signOut}
      onSwitchProject={switchProject}
    />
  );
}
