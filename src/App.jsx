import { useState, useEffect, useRef, useCallback } from "react";
import {
  Hammer, Camera, Wallet, FileCheck, Users, Package, Search, FileText,
  AlertTriangle, Phone, Plus, X, TrendingUp, Home, ClipboardList, Landmark,
  Trash2, Sparkles, Loader2, CheckCircle2, IndianRupee, CalendarDays,
} from "lucide-react";
import { loadKey, saveKey } from "./lib/storage";
import { askClaude as askClaudeApi } from "./lib/ai";

/* ---------------------------------------------------------------------- */
/*  Design tokens                                                          */
/* ---------------------------------------------------------------------- */
const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
`;
const C = {
  navy: "#16324F",
  navyLight: "#2B5278",
  rust: "#B7451F",
  rustLight: "#D25A2C",
  yellow: "#D99A2B",
  ink: "#20242A",
  concrete: "#7C7768",
  line: "#CFC8B6",
  paper: "#E7E2D3",
  paperDark: "#DAD3BF",
  card: "#F5F2E9",
  green: "#3F6B4A",
  red: "#A33A2E",
};

const STAGES = [
  "Demolition", "Excavation", "Foundation", "Plinth", "Superstructure",
  "Roof / Slab", "Brickwork", "Electrical Rough-in", "Plumbing Rough-in",
  "Plastering", "Flooring", "Painting", "Finishing", "Other",
];

/* ---------------------------------------------------------------------- */
/*  Storage helpers                                                        */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  Claude API helper (vision + web search)                                */
/* ---------------------------------------------------------------------- */
async function askClaude(args) {
  return askClaudeApi(args);
}

function compressImage(file, maxWidth = 640, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fmtINR = (n) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------------- */
/*  Small UI primitives                                                    */
/* ---------------------------------------------------------------------- */
function Stamp({ children, tone = "concrete" }) {
  const colors = {
    concrete: C.concrete, red: C.red, green: C.green, yellow: C.yellow, navy: C.navy,
  };
  return (
    <span
      style={{
        display: "inline-block",
        border: `2px solid ${colors[tone]}`,
        color: colors[tone],
        fontFamily: "'Oswald', sans-serif",
        fontSize: "11px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "2px 8px",
        borderRadius: "3px",
        transform: "rotate(-2deg)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <div
          style={{ background: C.navy, color: C.paper }}
          className="p-2.5 rounded-md"
        >
          <Icon size={20} />
        </div>
        <div>
          <h2
            style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }}
            className="text-xl font-semibold tracking-wide uppercase"
          >
            {title}
          </h2>
          {subtitle && (
            <p style={{ color: C.concrete }} className="text-sm">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

function Btn({ children, onClick, tone = "navy", type = "button", disabled, small }) {
  const bg = tone === "navy" ? C.navy : tone === "rust" ? C.rust : tone === "ghost" ? "transparent" : C.navy;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: tone === "ghost" ? "transparent" : bg,
        color: tone === "ghost" ? C.navy : "#fff",
        border: tone === "ghost" ? `1.5px solid ${C.navy}` : "none",
        opacity: disabled ? 0.55 : 1,
        fontFamily: "'Inter', sans-serif",
      }}
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold ${
        small ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } hover:opacity-90 transition disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span
        style={{ color: C.concrete, fontFamily: "'Inter', sans-serif" }}
        className="block text-xs font-semibold uppercase tracking-wide mb-1"
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: `1.5px solid ${C.line}`,
  background: "#fff",
  borderRadius: "6px",
  padding: "8px 10px",
  fontFamily: "'Inter', sans-serif",
  fontSize: "14px",
  color: C.ink,
};

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 z-50"
      style={{ background: "rgba(22,50,79,0.55)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, maxHeight: "88vh" }}
        className="w-full max-w-lg rounded-lg shadow-2xl overflow-y-auto"
      >
        <div
          style={{ borderBottom: `1px solid ${C.line}`, background: C.card }}
          className="flex items-center justify-between px-5 py-4 sticky top-0"
        >
          <h3
            style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }}
            className="uppercase font-semibold tracking-wide"
          >
            {title}
          </h3>
          <button onClick={onClose} style={{ color: C.concrete }}>
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Generic schema-driven form                                             */
/* ---------------------------------------------------------------------- */
function SchemaForm({ schema, initial, onSubmit, submitLabel = "Save" }) {
  const [vals, setVals] = useState(() => {
    const o = {};
    schema.forEach((f) => (o[f.key] = initial?.[f.key] ?? (f.type === "number" ? "" : "")));
    return o;
  });
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(vals);
      }}
    >
      {schema.map((f) => (
        <Field label={f.label} key={f.key}>
          {f.type === "select" ? (
            <select style={inputStyle} value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
              <option value="">Select…</option>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea style={{ ...inputStyle, minHeight: "70px" }} value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <input
              style={inputStyle}
              type={f.type || "text"}
              value={vals[f.key]}
              required={f.required}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </Field>
      ))}
      <Btn type="submit">{submitLabel}</Btn>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/*  Generic list section (CRUD)                                            */
/* ---------------------------------------------------------------------- */
function ListSection({ icon, title, subtitle, schema, items, setItems, storageKey, onPersist, renderCard, addLabel = "Add entry" }) {
  const [open, setOpen] = useState(false);

  const persist = onPersist || ((next) => saveKey(storageKey, next));

  const add = async (vals) => {
    const next = [{ id: uid(), ...vals }, ...items];
    setItems(next);
    setOpen(false);
    await persist(next);
  };
  const remove = async (id) => {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    await persist(next);
  };

  return (
    <div>
      <SectionHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        action={
          <Btn onClick={() => setOpen(true)}>
            <Plus size={16} /> {addLabel}
          </Btn>
        }
      />
      {items.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">
          Nothing logged yet. Add your first entry.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            style={{ background: C.card, border: `1px solid ${C.line}` }}
            className="rounded-lg p-4 relative"
          >
            <button
              onClick={() => remove(item.id)}
              style={{ color: C.concrete }}
              className="absolute top-3 right-3 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
            {renderCard(item)}
          </div>
        ))}
      </div>
      {open && (
        <Modal title={addLabel} onClose={() => setOpen(false)}>
          <SchemaForm schema={schema} onSubmit={add} />
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dashboard                                                               */
/* ---------------------------------------------------------------------- */
function Dashboard({ data, setTab }) {
  const { progress, expenses, permissions, contacts, products, documents, issues, gallery, meta, loan } = data;

  const spentOnExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const spentOnPermissions = permissions.reduce((s, p) => s + Number(p.cost || 0), 0);
  const totalSpent = spentOnExpenses + spentOnPermissions;
  const allocated = Number(meta.budgetAllocated || 0);
  const remaining = allocated - totalSpent;
  const redFlags = progress.filter((p) => p.flag === "Red Flag").length;
  const openIssues = issues.filter((i) => i.status !== "Resolved").length;
  const latestStage = progress[0]?.stage || "Not started";

  const stageOrder = STAGES.filter((s) => s !== "Other");
  const reachedStages = new Set(progress.map((p) => p.stage));

  const stat = (label, value, tone, Icon) => (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 flex items-center gap-3">
      <div style={{ background: tone, color: "#fff" }} className="p-2 rounded-md shrink-0">
        <Icon size={18} />
      </div>
      <div>
        <div style={{ color: C.concrete }} className="text-xs uppercase tracking-wide font-semibold">{label}</div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }} className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );

  return (
    <div>
      <SectionHeader icon={Home} title={meta.projectName || "Site Ledger"} subtitle="Bengaluru · construction dashboard" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stat("Total spent", fmtINR(totalSpent), C.rust, IndianRupee)}
        {stat("Budget remaining", fmtINR(remaining), remaining < 0 ? C.red : C.green, Wallet)}
        {stat("Current stage", latestStage, C.navy, Hammer)}
        {stat("Open red flags", redFlags, redFlags ? C.red : C.green, AlertTriangle)}
      </div>

      {/* Stage ledger — signature element */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-5 mb-8">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-4">
          Construction sequence
        </h3>
        <div className="relative pl-1 overflow-x-auto">
          <div className="flex items-start" style={{ minWidth: "760px" }}>
            {stageOrder.map((s, i) => {
              const done = reachedStages.has(s);
              return (
                <div key={s} className="flex-1 flex flex-col items-center relative">
                  {i !== 0 && (
                    <div
                      style={{
                        position: "absolute", top: "11px", right: "50%", height: "2px", width: "100%",
                        background: done ? C.rust : C.line,
                        backgroundImage: done ? "none" : `repeating-linear-gradient(90deg, ${C.line} 0 6px, transparent 6px 12px)`,
                      }}
                    />
                  )}
                  <div
                    style={{
                      width: 22, height: 22, borderRadius: "50%", zIndex: 1,
                      background: done ? C.rust : "#fff",
                      border: `2px solid ${done ? C.rust : C.concrete}`,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: done ? C.ink : C.concrete,
                      fontSize: "10.5px",
                      textAlign: "center",
                      marginTop: 6,
                      maxWidth: 78,
                    }}
                  >
                    {s}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stat("Photos logged", gallery.length, C.navyLight, Camera)}
        {stat("Permissions tracked", permissions.length, C.navyLight, FileCheck)}
        {stat("Open hiccups", openIssues, openIssues ? C.yellow : C.green, ClipboardList)}
        {stat("Contacts saved", contacts.length, C.navyLight, Users)}
        {stat("Products logged", products.length, C.navyLight, Package)}
        {stat("Bills / agreements", documents.length, C.navyLight, FileText)}
      </div>

      {loan.enabled && (
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mt-6">
          <div style={{ color: C.concrete }} className="text-xs uppercase tracking-wide font-semibold mb-1">Home loan</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace" }} className="text-sm">
            Sanctioned {fmtINR(loan.sanctioned)} · Disbursed {fmtINR(loan.disbursed)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Progress + Plan tab                                                     */
/* ---------------------------------------------------------------------- */
const progressSchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "stage", label: "Stage", type: "select", options: STAGES, required: true },
  { key: "workersCount", label: "Workers on site", type: "number" },
  { key: "description", label: "What happened today", type: "textarea" },
  { key: "flag", label: "Flag", type: "select", options: ["None", "Watch", "Red Flag"] },
];

function ProgressTab({ progress, setProgress, meta, setMeta }) {
  const [planDraft, setPlanDraft] = useState(meta.planText || "");
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState("");

  const savePlan = async () => {
    const next = { ...meta, planText: planDraft };
    setMeta(next);
    await saveKey("meta", next);
  };

  const crossCheck = async () => {
    if (!planDraft.trim()) return;
    setChecking(true);
    setReview("");
    try {
      const log = progress
        .slice(0, 40)
        .map((p) => `${p.date} — ${p.stage} (${p.workersCount || "?"} workers): ${p.description || ""} [flag: ${p.flag || "None"}]`)
        .join("\n");
      const out = await askClaude({
        text: `You are helping a homeowner in Bangalore who is self-building a house track whether construction is on schedule and matches the approved plan. Here is the building plan / schedule they described:\n\n${planDraft}\n\nHere is the site progress log so far (most recent first):\n\n${log || "(no entries yet)"}\n\nCross-question this like a careful project manager: identify any mismatches with the plan, sequencing problems, stages that seem delayed, or missing information you'd want to ask the homeowner about. End with a clear verdict: ON TRACK, WATCH, or RED FLAG, and why. Be concise and specific.`,
      });
      setReview(out);
    } catch (e) {
      setReview("Could not complete the review — try again in a moment.");
    }
    setChecking(false);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2">
          Building plan &amp; schedule
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-2">
          Paste your approved plan, stage-wise timeline, or key milestones here. Claude will cross-question your day-to-day log against it.
        </p>
        <textarea
          style={{ ...inputStyle, minHeight: "90px" }}
          value={planDraft}
          onChange={(e) => setPlanDraft(e.target.value)}
          onBlur={savePlan}
          placeholder="e.g. Foundation by 15 Sep, Superstructure by 30 Nov, Roof slab by 15 Jan…"
        />
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Btn onClick={crossCheck} disabled={checking || !planDraft.trim()} tone="rust">
            {checking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Cross-check progress vs. plan
          </Btn>
        </div>
        {review && (
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, whiteSpace: "pre-wrap" }} className="mt-4 rounded-md p-3 text-sm">
            {review}
          </div>
        )}
      </div>

      <ListSection
        icon={Hammer}
        title="Daily progress log"
        subtitle="One entry per day / visit"
        schema={progressSchema}
        items={progress}
        setItems={setProgress}
        storageKey="progress"
        addLabel="Log today's progress"
        renderCard={(p) => (
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{p.date}</span>
              {p.flag && p.flag !== "None" && <Stamp tone={p.flag === "Red Flag" ? "red" : "yellow"}>{p.flag}</Stamp>}
            </div>
            <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm mb-1">{p.stage}</div>
            {p.workersCount && <div style={{ color: C.concrete }} className="text-xs mb-1">{p.workersCount} workers on site</div>}
            <p style={{ color: C.ink }} className="text-sm">{p.description}</p>
          </div>
        )}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Gallery tab (AI photo review)                                           */
/* ---------------------------------------------------------------------- */
function GalleryTab({ gallery, setGallery }) {
  const [pending, setPending] = useState(null); // {b64, date}
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef();

  const onPick = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await compressImage(file);
    setPending({ b64, date: today(), note: "" });
    e.target.value = "";
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const out = await askClaude({
        images: [pending.b64],
        text: "This is a daily progress photo from a house construction site in Bangalore, India. Look carefully and: 1) count how many people appear to be working / on-site (laborers, masons, engineers etc.) 2) count how many appear to be bystanders/visitors/not working, 3) categorize the stage of construction visible (e.g. demolition, excavation, foundation, structure, plastering, finishing etc.), 4) note anything that looks like a safety issue or something worth flagging, 5) give one short caption line. Answer in short labeled lines, no long paragraphs.",
      });
      setPending((p) => ({ ...p, note: out }));
    } catch {
      setPending((p) => ({ ...p, note: "AI review failed — you can still save the photo with a manual note." }));
    }
    setAnalyzing(false);
  };

  const save = async () => {
    const next = [{ id: uid(), ...pending }, ...gallery];
    setGallery(next);
    await saveKey("gallery", next);
    setPending(null);
  };

  const remove = async (id) => {
    const next = gallery.filter((g) => g.id !== id);
    setGallery(next);
    await saveKey("gallery", next);
  };

  return (
    <div>
      <SectionHeader
        icon={Camera}
        title="Photo gallery"
        subtitle="Upload the builder's daily photos — Claude reviews people, stage, and red flags"
        action={
          <>
            <input type="file" accept="image/*" ref={fileRef} className="hidden" onChange={onPick} />
            <Btn onClick={() => fileRef.current.click()}>
              <Plus size={16} /> Add photo
            </Btn>
          </>
        }
      />

      {pending && (
        <Modal title="Review photo" onClose={() => setPending(null)}>
          <img src={`data:image/jpeg;base64,${pending.b64}`} className="rounded-md mb-3 w-full object-cover" style={{ maxHeight: 260 }} />
          <Field label="Date">
            <input style={inputStyle} type="date" value={pending.date} onChange={(e) => setPending({ ...pending, date: e.target.value })} />
          </Field>
          <Field label="Notes (AI-assisted, edit as needed)">
            <textarea style={{ ...inputStyle, minHeight: 110 }} value={pending.note} onChange={(e) => setPending({ ...pending, note: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Btn onClick={analyze} disabled={analyzing} tone="rust">
              {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Ask AI to review
            </Btn>
            <Btn onClick={save}>
              <CheckCircle2 size={15} /> Save to gallery
            </Btn>
          </div>
        </Modal>
      )}

      {gallery.length === 0 && <p style={{ color: C.concrete }} className="text-sm italic">No photos yet.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gallery.map((g) => (
          <div key={g.id} style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg overflow-hidden">
            <img src={`data:image/jpeg;base64,${g.b64}`} className="w-full object-cover" style={{ height: 160 }} />
            <div className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{g.date}</span>
                <button onClick={() => remove(g.id)} style={{ color: C.concrete }}><Trash2 size={14} /></button>
              </div>
              <p style={{ color: C.ink, whiteSpace: "pre-wrap" }} className="text-xs">{g.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Budget / expenses / loan tab                                           */
/* ---------------------------------------------------------------------- */
const expenseSchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "category", label: "Category", type: "select", options: ["Material", "Labor", "Builder Payment", "Permission / Govt Fee", "Professional Fee", "Transport", "Other"], required: true },
  { key: "description", label: "Description", type: "text" },
  { key: "amount", label: "Amount (₹)", type: "number", required: true },
  { key: "paidTo", label: "Paid to", type: "text" },
  { key: "mode", label: "Mode", type: "select", options: ["Cash", "UPI", "Bank Transfer", "Cheque", "Card"] },
];
const loanEntrySchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "type", label: "Type", type: "select", options: ["Sanction", "Disbursement", "EMI Paid", "Other"], required: true },
  { key: "amount", label: "Amount (₹)", type: "number", required: true },
  { key: "notes", label: "Notes", type: "textarea" },
];

function BudgetTab({ expenses, setExpenses, permissions, meta, setMeta, loan, setLoan }) {
  const [budgetDraft, setBudgetDraft] = useState(meta.budgetAllocated || "");

  const saveBudget = async () => {
    const next = { ...meta, budgetAllocated: budgetDraft };
    setMeta(next);
    await saveKey("meta", next);
  };

  const spentExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const spentPermissions = permissions.reduce((s, p) => s + Number(p.cost || 0), 0);
  const total = spentExpenses + spentPermissions;
  const allocated = Number(meta.budgetAllocated || 0);

  // monthly breakdown
  const byMonth = {};
  expenses.forEach((e) => {
    const m = (e.date || "").slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + Number(e.amount || 0);
  });
  const months = Object.keys(byMonth).sort().reverse();
  const thisMonth = today().slice(0, 7);

  const toggleLoan = async () => {
    const next = { ...loan, enabled: !loan.enabled };
    setLoan(next);
    await saveKey("loan", next);
  };
  const updateLoanField = async (field, val) => {
    const next = { ...loan, [field]: val };
    setLoan(next);
    await saveKey("loan", next);
  };
  const addLoanEntry = async (vals) => {
    const next = { ...loan, entries: [{ id: uid(), ...vals }, ...(loan.entries || [])] };
    setLoan(next);
    await saveKey("loan", next);
  };

  return (
    <div>
      <SectionHeader icon={Wallet} title="Budget &amp; expenses" subtitle="Every rupee, from demolition to handover" />

      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6 grid gap-4 sm:grid-cols-3 items-end">
        <Field label="Total budget allocated (₹)">
          <input style={inputStyle} type="number" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} onBlur={saveBudget} />
        </Field>
        <div>
          <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide">Spent so far</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }} className="text-xl font-semibold">{fmtINR(total)}</div>
        </div>
        <div>
          <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide">Remaining</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: allocated - total < 0 ? C.red : C.green }} className="text-xl font-semibold">
            {fmtINR(allocated - total)}
          </div>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-3">
          Monthly report
        </h3>
        {months.length === 0 && <p style={{ color: C.concrete }} className="text-sm italic">No expenses logged yet.</p>}
        <div className="space-y-2">
          {months.map((m) => (
            <div key={m} className="flex items-center justify-between text-sm">
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: m === thisMonth ? C.rust : C.ink, fontWeight: m === thisMonth ? 600 : 400 }}>
                {m} {m === thisMonth && "(current)"}
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtINR(byMonth[m])}</span>
            </div>
          ))}
        </div>
      </div>

      <ListSection
        icon={IndianRupee}
        title="Expense log"
        schema={expenseSchema}
        items={expenses}
        setItems={setExpenses}
        storageKey="expenses"
        addLabel="Add expense"
        renderCard={(e) => (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{e.date}</span>
              <Stamp tone="navy">{e.category}</Stamp>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(e.amount)}</div>
            <p style={{ color: C.ink }} className="text-sm">{e.description}</p>
            {e.paidTo && <p style={{ color: C.concrete }} className="text-xs mt-1">Paid to {e.paidTo} · {e.mode}</p>}
          </div>
        )}
      />

      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mt-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Landmark size={18} style={{ color: C.navy }} />
            <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide">Home loan tracking</h3>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: C.concrete }}>
            <input type="checkbox" checked={!!loan.enabled} onChange={toggleLoan} /> Applicable
          </label>
        </div>
        {loan.enabled && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2 mb-4">
              <Field label="Sanctioned amount (₹)">
                <input style={inputStyle} type="number" defaultValue={loan.sanctioned} onBlur={(e) => updateLoanField("sanctioned", e.target.value)} />
              </Field>
              <Field label="Disbursed so far (₹)">
                <input style={inputStyle} type="number" defaultValue={loan.disbursed} onBlur={(e) => updateLoanField("disbursed", e.target.value)} />
              </Field>
            </div>
            <ListSection
              icon={Landmark}
              title="Loan entries"
              schema={loanEntrySchema}
              items={loan.entries || []}
              setItems={(items) => setLoan({ ...loan, entries: items })}
              onPersist={(items) => saveKey("loan", { ...loan, entries: items })}
              addLabel="Add loan entry"
              renderCard={(l) => (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{l.date}</span>
                    <Stamp tone="navy">{l.type}</Stamp>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(l.amount)}</div>
                  <p style={{ color: C.ink }} className="text-sm">{l.notes}</p>
                </div>
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Permissions tab                                                         */
/* ---------------------------------------------------------------------- */
const permissionSchema = [
  { key: "name", label: "Permission / approval", type: "text", required: true },
  { key: "status", label: "Status", type: "select", options: ["Not Started", "Applied", "In Review", "Payment Pending", "Approved", "Rejected"], required: true },
  { key: "appliedDate", label: "Applied on", type: "date" },
  { key: "completedDate", label: "Completed on", type: "date" },
  { key: "cost", label: "Cost / fee (₹)", type: "number" },
  { key: "notes", label: "Notes", type: "textarea" },
];
const statusTone = { "Approved": "green", "Rejected": "red", "Payment Pending": "yellow", "In Review": "yellow", "Applied": "navy", "Not Started": "concrete" };

function PermissionsTab({ permissions, setPermissions }) {
  return (
    <ListSection
      icon={FileCheck}
      title="Permissions &amp; approvals"
      subtitle="A-Khata, plan approval, BBMP, and everything in between"
      schema={permissionSchema}
      items={permissions}
      setItems={setPermissions}
      storageKey="permissions"
      addLabel="Add permission"
      renderCard={(p) => (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm">{p.name}</span>
            <Stamp tone={statusTone[p.status] || "concrete"}>{p.status}</Stamp>
          </div>
          <div style={{ color: C.concrete }} className="text-xs mb-1">
            {p.appliedDate && `Applied ${p.appliedDate}`} {p.completedDate && ` · Done ${p.completedDate}`}
          </div>
          {p.cost ? <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">{fmtINR(p.cost)}</div> : null}
          <p style={{ color: C.ink }} className="text-sm mt-1">{p.notes}</p>
        </div>
      )}
    />
  );
}

/* ---------------------------------------------------------------------- */
/*  People / contacts tab                                                   */
/* ---------------------------------------------------------------------- */
const contactSchema = [
  { key: "role", label: "Role", type: "select", options: ["Builder", "Civil Engineer", "Architect", "Electrician", "Plumber", "Painter", "Carpenter", "BBMP / Govt Contact", "Other"], required: true },
  { key: "name", label: "Name", type: "text", required: true },
  { key: "phone", label: "Phone number", type: "tel", required: true },
  { key: "notes", label: "Notes", type: "textarea" },
];

function PeopleTab({ contacts, setContacts }) {
  return (
    <ListSection
      icon={Users}
      title="People on the project"
      subtitle="Builder, engineer, electrician, plumber — one tap to call"
      schema={contactSchema}
      items={contacts}
      setItems={setContacts}
      storageKey="contacts"
      addLabel="Add contact"
      renderCard={(c) => (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Stamp tone="navy">{c.role}</Stamp>
          </div>
          <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold text-sm mt-1">{c.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-sm">{c.phone}</span>
            <a href={`tel:${c.phone}`} style={{ color: C.rust }} className="inline-flex items-center gap-1 text-xs font-semibold">
              <Phone size={13} /> Call
            </a>
          </div>
          {c.notes && <p style={{ color: C.ink }} className="text-sm mt-1">{c.notes}</p>}
        </div>
      )}
    />
  );
}

/* ---------------------------------------------------------------------- */
/*  Products tab + price checker                                           */
/* ---------------------------------------------------------------------- */
const productSchema = [
  { key: "item", label: "Item", type: "text", required: true },
  { key: "room", label: "Room / area", type: "text" },
  { key: "brand", label: "Brand / model", type: "text" },
  { key: "price", label: "Price paid (₹)", type: "number" },
  { key: "claimedPrice", label: "Builder's quoted price (₹)", type: "number" },
  { key: "vendor", label: "Vendor / shop", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];

function ProductsTab({ products, setProducts }) {
  const [checkItem, setCheckItem] = useState("");
  const [checkPrice, setCheckPrice] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState("");

  const runCheck = async () => {
    if (!checkItem.trim()) return;
    setChecking(true);
    setResult("");
    try {
      const out = await askClaude({
        useSearch: true,
        text: `A construction builder in Bangalore, India quoted this item: "${checkItem}"${checkPrice ? ` at ₹${checkPrice}` : ""}. Search the web for typical current market prices for this item in India (Bangalore where relevant). Tell me: 1) whether the quoted price seems fair, overpriced, or a good deal, with a rough price range you found, 2) 2-3 specific alternative brands/models at a similar or better price, 3) a one-line verdict. Keep it short and practical.`,
      });
      setResult(out);
    } catch {
      setResult("Could not complete the price check — try again in a moment.");
    }
    setChecking(false);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2 flex items-center gap-2">
          <Search size={16} /> Check a builder's quote
        </h3>
        <div className="grid gap-3 sm:grid-cols-3 items-end">
          <Field label="Item the builder quoted">
            <input style={inputStyle} value={checkItem} onChange={(e) => setCheckItem(e.target.value)} placeholder="e.g. Kajaria vitrified tile 2x2" />
          </Field>
          <Field label="Their quoted price (₹, optional)">
            <input style={inputStyle} type="number" value={checkPrice} onChange={(e) => setCheckPrice(e.target.value)} />
          </Field>
          <Btn onClick={runCheck} disabled={checking} tone="rust">
            {checking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Check price
          </Btn>
        </div>
        {result && <div style={{ background: "#fff", border: `1px solid ${C.line}`, whiteSpace: "pre-wrap" }} className="mt-4 rounded-md p-3 text-sm">{result}</div>}
      </div>

      <ListSection
        icon={Package}
        title="Products used"
        subtitle="Everything that went into the house, with what you paid"
        schema={productSchema}
        items={products}
        setItems={setProducts}
        storageKey="products"
        addLabel="Add product"
        renderCard={(p) => (
          <div>
            <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm">{p.item}</div>
            <div style={{ color: C.concrete }} className="text-xs mb-1">{p.room} {p.brand && `· ${p.brand}`}</div>
            <div className="flex items-center gap-3">
              {p.price && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">Paid {fmtINR(p.price)}</span>}
              {p.claimedPrice && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">Quoted {fmtINR(p.claimedPrice)}</span>}
            </div>
            {p.vendor && <div style={{ color: C.concrete }} className="text-xs mt-1">From {p.vendor}</div>}
            {p.notes && <p style={{ color: C.ink }} className="text-sm mt-1">{p.notes}</p>}
          </div>
        )}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Documents tab (bills & agreements)                                     */
/* ---------------------------------------------------------------------- */
const documentSchema = [
  { key: "title", label: "Title", type: "text", required: true },
  { key: "type", label: "Type", type: "select", options: ["Bill", "Agreement", "Receipt", "Other"], required: true },
  { key: "date", label: "Date", type: "date" },
  { key: "amount", label: "Amount (₹)", type: "number" },
  { key: "vendor", label: "Vendor / party", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];

function DocumentsTab({ documents, setDocuments }) {
  return (
    <ListSection
      icon={FileText}
      title="Bills &amp; agreements"
      subtitle="Keep a record for future reference and disputes"
      schema={documentSchema}
      items={documents}
      setItems={setDocuments}
      storageKey="documents"
      addLabel="Add document"
      renderCard={(d) => (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm">{d.title}</span>
            <Stamp tone="navy">{d.type}</Stamp>
          </div>
          <div style={{ color: C.concrete }} className="text-xs mb-1">{d.date} {d.vendor && `· ${d.vendor}`}</div>
          {d.amount ? <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">{fmtINR(d.amount)}</div> : null}
          <p style={{ color: C.ink }} className="text-sm mt-1">{d.notes}</p>
        </div>
      )}
    />
  );
}

/* ---------------------------------------------------------------------- */
/*  Issues / hiccups tab                                                    */
/* ---------------------------------------------------------------------- */
const issueSchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "issue", label: "What went wrong", type: "textarea", required: true },
  { key: "stepsTaken", label: "Steps taken to resolve", type: "textarea" },
  { key: "status", label: "Status", type: "select", options: ["Open", "Resolved"] },
];

function IssuesTab({ issues, setIssues }) {
  return (
    <ListSection
      icon={AlertTriangle}
      title="Hiccups &amp; resolutions"
      subtitle="Every problem, and what fixed it"
      schema={issueSchema}
      items={issues}
      setItems={setIssues}
      storageKey="issues"
      addLabel="Log a hiccup"
      renderCard={(i) => (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{i.date}</span>
            <Stamp tone={i.status === "Resolved" ? "green" : "yellow"}>{i.status || "Open"}</Stamp>
          </div>
          <p style={{ color: C.ink }} className="text-sm font-semibold">{i.issue}</p>
          {i.stepsTaken && <p style={{ color: C.concrete }} className="text-sm mt-1">→ {i.stepsTaken}</p>}
        </div>
      )}
    />
  );
}

/* ---------------------------------------------------------------------- */
/*  App shell                                                               */
/* ---------------------------------------------------------------------- */
const TABS = [
  { key: "dashboard", label: "Dashboard", icon: Home },
  { key: "progress", label: "Progress", icon: Hammer },
  { key: "gallery", label: "Gallery", icon: Camera },
  { key: "budget", label: "Budget", icon: Wallet },
  { key: "permissions", label: "Permissions", icon: FileCheck },
  { key: "people", label: "People", icon: Users },
  { key: "products", label: "Products", icon: Package },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "issues", label: "Issues", icon: AlertTriangle },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);

  const [meta, setMeta] = useState({ projectName: "Site Ledger", budgetAllocated: "", planText: "" });
  const [progress, setProgress] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loan, setLoan] = useState({ enabled: false, sanctioned: "", disbursed: "", entries: [] });

  useEffect(() => {
    (async () => {
      const [m, p, g, e, perm, c, prod, doc, iss, l] = await Promise.all([
        loadKey("meta", { projectName: "Site Ledger", budgetAllocated: "", planText: "" }),
        loadKey("progress", []),
        loadKey("gallery", []),
        loadKey("expenses", []),
        loadKey("permissions", []),
        loadKey("contacts", []),
        loadKey("products", []),
        loadKey("documents", []),
        loadKey("issues", []),
        loadKey("loan", { enabled: false, sanctioned: "", disbursed: "", entries: [] }),
      ]);
      setMeta(m); setProgress(p); setGallery(g); setExpenses(e); setPermissions(perm);
      setContacts(c); setProducts(prod); setDocuments(doc); setIssues(iss); setLoan(l);
      setLoaded(true);
    })();
  }, []);

  if (!loaded) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  const data = { progress, expenses, permissions, contacts, products, documents, issues, gallery, meta, loan };

  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      <style>{FONTS}</style>
      <header style={{ background: C.navy }} className="text-white sticky top-0 z-40 shadow-md">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <Hammer size={22} style={{ color: C.yellow }} />
            <span style={{ fontFamily: "'Oswald', sans-serif" }} className="text-lg font-semibold tracking-wide uppercase">
              {meta.projectName || "Site Ledger"}
            </span>
            <span style={{ color: "#9FB4C7" }} className="text-xs ml-1">Bengaluru build tracker</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-0 -mb-px">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    borderBottom: active ? `3px solid ${C.rust}` : "3px solid transparent",
                    color: active ? "#fff" : "#B9C7D4",
                    fontFamily: "'Inter', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold"
                >
                  <Icon size={15} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "dashboard" && <Dashboard data={data} setTab={setTab} />}
        {tab === "progress" && <ProgressTab progress={progress} setProgress={setProgress} meta={meta} setMeta={setMeta} />}
        {tab === "gallery" && <GalleryTab gallery={gallery} setGallery={setGallery} />}
        {tab === "budget" && (
          <BudgetTab
            expenses={expenses} setExpenses={setExpenses}
            permissions={permissions} meta={meta} setMeta={setMeta}
            loan={loan} setLoan={setLoan}
          />
        )}
        {tab === "permissions" && <PermissionsTab permissions={permissions} setPermissions={setPermissions} />}
        {tab === "people" && <PeopleTab contacts={contacts} setContacts={setContacts} />}
        {tab === "products" && <ProductsTab products={products} setProducts={setProducts} />}
        {tab === "documents" && <DocumentsTab documents={documents} setDocuments={setDocuments} />}
        {tab === "issues" && <IssuesTab issues={issues} setIssues={setIssues} />}
      </main>

      <footer style={{ color: C.concrete }} className="text-center text-xs py-6">
        Everything is saved privately to your account, on this device's app storage.
      </footer>
    </div>
  );
}
