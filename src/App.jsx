import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Hammer, Camera, Wallet, FileCheck, Users, Package, Search, FileText,
  AlertTriangle, Phone, Plus, X, TrendingUp, Home, ClipboardList, Landmark,
  Trash2, Sparkles, Loader2, CheckCircle2, IndianRupee, CalendarDays, ShieldCheck, LogOut, UserCog, Repeat,
  Upload, Download, Paperclip,
} from "lucide-react";
import { loadKey, saveKey } from "./lib/storage";
import { askClaude as askClaudeApi } from "./lib/ai";
import { ROLE_LABELS, ROLE_TAB_ACCESS, ALL_ROLES } from "./lib/roles";
import { getActiveProjectId } from "./lib/activeProject";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

/* ---------------------------------------------------------------------- */
/*  Design tokens                                                          */
/* ---------------------------------------------------------------------- */
const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

* { box-sizing: border-box; }

::selection { background: #B7451F; color: #fff; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #CFC8B6; border-radius: 999px; border: 2px solid #E7E2D3; }
::-webkit-scrollbar-thumb:hover { background: #B7451F; }

input, select, textarea {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: #16324F !important;
  box-shadow: 0 0 0 3px rgba(22, 50, 79, 0.14);
}

button { transition: transform 0.12s ease, box-shadow 0.15s ease, background-color 0.15s ease, opacity 0.15s ease; }
button:active:not(:disabled) { transform: scale(0.97); }

@keyframes ledgerModalIn {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ledgerOverlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.ledger-modal-overlay { animation: ledgerOverlayIn 0.15s ease; }
.ledger-modal-panel { animation: ledgerModalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1); }

@keyframes ledgerFadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.ledger-fade-up { animation: ledgerFadeUp 0.25s ease both; }
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

// Default builder payment schedule — pre-filled from the construction
// agreement. Editable: amounts, milestone names, and rows can all be
// changed from the Budget tab if the actual contract differs later.
const DEFAULT_AGREEMENT = {
  builderName: "Adigallu Pvt Ltd",
  totalValue: 6700000,
  milestones: [
    { id: "m1", milestone: "Design Development & Construction Advance", percent: 25, agreedAmount: 1675000, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m2", milestone: "Plinth beam", percent: 12, agreedAmount: 804000, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m3", milestone: "Ground floor roof slab", percent: 15, agreedAmount: 1005000, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m4", milestone: "First floor roof slab", percent: 13.5, agreedAmount: 904500, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m5", milestone: "Second floor roof slab", percent: 13.5, agreedAmount: 904500, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m6", milestone: "Third floor roof slab", percent: 13.5, agreedAmount: 904500, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m7", milestone: "Staircase & Lift room roof slab", percent: 6, agreedAmount: 402000, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
    { id: "m8", milestone: "Final hand over", percent: 1.5, agreedAmount: 100500, status: "Pending", paidDate: "", paidAmount: "", notes: "" },
  ],
};

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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fmtINR = (n) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// Local date (not UTC), so evening entries don't jump to tomorrow.
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

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
        boxShadow: "1px 2px 3px rgba(0,0,0,0.1)",
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
          style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyLight})`, color: C.paper, boxShadow: "0 2px 6px rgba(22,50,79,0.35)" }}
          className="p-2.5 rounded-xl"
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
        boxShadow: tone === "ghost" ? "none" : "0 1px 2px rgba(32,36,42,0.15)",
      }}
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold ${
        small ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } hover:opacity-90 hover:-translate-y-px transition disabled:cursor-not-allowed disabled:translate-y-0`}
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
  borderRadius: "7px",
  padding: "9px 11px",
  fontFamily: "'Inter', sans-serif",
  fontSize: "14px",
  color: C.ink,
};

function Modal({ title, onClose, children, size }) {
  return (
    <div
      className="ledger-modal-overlay fixed inset-0 flex items-center justify-center p-4 z-50"
      style={{ background: "rgba(22,50,79,0.6)", backdropFilter: "blur(1px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, maxHeight: "94vh" }}
        className={`ledger-modal-panel w-full ${size === "large" ? "max-w-5xl" : "max-w-lg"} rounded-lg shadow-2xl overflow-y-auto`}
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

// Shows an uploaded image or PDF inline (in-page), rather than making the
// browser download it — used anywhere a { name, mimeType, data } file is
// attached (documents, the plan file, etc).
function FilePreview({ file, onClose }) {
  // Build a blob: URL from the stored base64. Browsers (Chrome/Safari)
  // often refuse to render large data: URLs inside an iframe, which is why
  // PDFs and bigger scans showed up blank.
  const blobUrl = useMemo(() => {
    if (!file?.data) return null;
    try {
      const bin = atob(file.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: file.mimeType || "application/octet-stream" }));
    } catch (e) {
      console.error("[SiteLedger] Could not read attached file", e);
      return null;
    }
  }, [file]);
  useEffect(() => () => blobUrl && URL.revokeObjectURL(blobUrl), [blobUrl]);

  if (!file) return null;
  const isImage = file.mimeType?.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name || "");
  const dataUrl = blobUrl || `data:${file.mimeType};base64,${file.data}`;
  return (
    <Modal title={file.name} onClose={onClose} size="large">
      {isImage && <img src={dataUrl} alt={file.name} style={{ maxWidth: "100%", maxHeight: "82vh", display: "block", margin: "0 auto", borderRadius: 6 }} />}
      {isPdf && <iframe src={dataUrl} title={file.name} style={{ width: "100%", height: "82vh", border: "none" }} />}
      {!isImage && !isPdf && (
        <p style={{ color: C.concrete }} className="text-sm mb-3">
          This file type can't be previewed here — download it to open it.
        </p>
      )}
      <div className="mt-3 flex gap-4">
        <a href={dataUrl} target="_blank" rel="noreferrer" style={{ color: C.navy }} className="text-xs underline">
          Open in new tab
        </a>
        <a href={dataUrl} download={file.name} style={{ color: C.navy }} className="text-xs underline">
          Download {file.name}
        </a>
      </div>
    </Modal>
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
          ) : f.type === "file" ? (
            <div>
              <input
                type="file"
                accept={f.accept || "*/*"}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  e.target.value = "";
                  if (!file) return;
                  const isImage = file.type.startsWith("image/");
                  const data = isImage ? await compressImage(file, 1400, 0.8) : await fileToBase64(file);
                  set(f.key, { name: file.name, mimeType: isImage ? "image/jpeg" : (file.type || "application/octet-stream"), data });
                }}
              />
              {vals[f.key] && (
                <div style={{ color: C.concrete }} className="text-xs mt-1 flex items-center gap-2">
                  <span>{vals[f.key].name}</span>
                  <button type="button" onClick={() => set(f.key, null)} style={{ color: C.concrete }} className="hover:text-red-600">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
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
/*  CSV import / export helpers                                            */
/* ---------------------------------------------------------------------- */
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(schema, items) {
  const header = schema.map((f) => csvEscape(f.label)).join(",");
  const rows = items.map((item) => schema.map((f) => csvEscape(item[f.key])).join(","));
  return [header, ...rows].join("\r\n");
}

function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField();
      pushRow();
    } else if (c === "\r") {
      // ignore — paired \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function rowsToItems(schema, rows) {
  if (!rows.length) return { items: [], skipped: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colForField = schema.map((f) => {
    let idx = header.indexOf(f.label.toLowerCase());
    if (idx === -1) idx = header.indexOf(f.key.toLowerCase());
    return idx;
  });
  const items = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (raw.every((c) => !c || !c.trim())) continue;
    const obj = { id: uid() };
    schema.forEach((f, i) => {
      const idx = colForField[i];
      obj[f.key] = idx >= 0 && raw[idx] !== undefined ? raw[idx] : "";
    });
    const missingRequired = schema.some((f) => f.required && !String(obj[f.key] || "").trim());
    if (missingRequired) { skipped++; continue; }
    items.push(obj);
  }
  return { items, skipped };
}

/* ---------------------------------------------------------------------- */
/*  Generic list section (CRUD)                                            */
/* ---------------------------------------------------------------------- */
function ListSection({ icon, title, subtitle, schema, items, setItems, storageKey, onPersist, renderCard, addLabel = "Add entry", enableImportExport = false, exportFileName, renderForm, onRemoveItem }) {
  const [open, setOpen] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const importRef = useRef();

  const persist = onPersist || ((next) => saveKey(storageKey, next));

  const add = async (vals) => {
    const next = [{ id: uid(), ...vals }, ...items];
    setItems(next);
    setOpen(false);
    await persist(next);
  };
  // Used by custom forms (renderForm): they build the full item themselves.
  const addItem = async (item) => {
    const next = [item, ...items];
    setItems(next);
    setOpen(false);
    await persist(next);
    return next;
  };
  const remove = async (id) => {
    const removed = items.find((i) => i.id === id);
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    await persist(next);
    if (removed && onRemoveItem) onRemoveItem(removed);
  };

  const exportCSV = () => {
    const csv = toCSV(schema, items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFileName || storageKey}-${today()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importCSV = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCSVText(text);
      const { items: parsed, skipped } = rowsToItems(schema, rows);
      if (!parsed.length) {
        setImportMsg(skipped ? `No rows imported — ${skipped} skipped (missing required fields).` : "No rows found in that file.");
        return;
      }
      const next = [...parsed, ...items];
      setItems(next);
      await persist(next);
      setImportMsg(`Imported ${parsed.length} ${parsed.length === 1 ? "entry" : "entries"}${skipped ? ` — ${skipped} skipped` : ""}.`);
    } catch {
      setImportMsg("Could not read that file — make sure it's a CSV exported from here.");
    }
  };

  return (
    <div>
      <SectionHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {enableImportExport && (
              <>
                <input type="file" accept=".csv,text/csv" ref={importRef} className="hidden" onChange={importCSV} />
                <Btn onClick={() => importRef.current.click()} tone="ghost" small>
                  <Upload size={14} /> Import CSV
                </Btn>
                <Btn onClick={exportCSV} tone="ghost" small disabled={!items.length}>
                  <Download size={14} /> Export CSV
                </Btn>
              </>
            )}
            <Btn onClick={() => setOpen(true)}>
              <Plus size={16} /> {addLabel}
            </Btn>
          </div>
        }
      />
      {enableImportExport && importMsg && (
        <p style={{ color: C.concrete }} className="text-xs mb-3">{importMsg}</p>
      )}
      {items.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">
          Nothing logged yet. Add your first entry.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)", transition: "box-shadow 150ms, transform 150ms" }}
            className="rounded-lg p-4 relative hover:shadow-md hover:-translate-y-0.5"
          >
            <button
              onClick={() => remove(item.id)}
              style={{ color: C.concrete, background: "rgba(245,242,233,0.9)" }}
              className="absolute top-2.5 right-2.5 z-10 rounded-full p-1 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
            {renderCard(item)}
          </div>
        ))}
      </div>
      {open && (
        <Modal title={addLabel} onClose={() => setOpen(false)}>
          {renderForm ? renderForm({ addItem, close: () => setOpen(false) }) : <SchemaForm schema={schema} onSubmit={add} />}
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dashboard                                                               */
/* ---------------------------------------------------------------------- */
function Dashboard({ data, setTab, currentUser }) {
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
  const completedStages = new Set(meta.completedStages || []);
  const loggedStages = new Set(progress.map((p) => p.stage));

  // Monthly spend (expenses only — permission fees aren't dated per month in a useful way here)
  const monthTotals = {};
  expenses.forEach((e) => {
    const m = (e.date || "").slice(0, 7);
    if (!m) return;
    monthTotals[m] = (monthTotals[m] || 0) + Number(e.amount || 0);
  });
  const monthlyChartData = Object.keys(monthTotals)
    .sort()
    .slice(-6)
    .map((m) => ({ month: m.slice(2), amount: monthTotals[m] }));

  // Spend by category, across expenses
  const categoryTotals = {};
  expenses.forEach((e) => {
    const cat = e.category || "Other";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(e.amount || 0);
  });
  const categoryChartData = Object.keys(categoryTotals).map((cat) => ({ name: cat, value: categoryTotals[cat] }));
  const PIE_COLORS = [C.rust, C.navy, C.green, C.yellow, C.navyLight, C.concrete, "#8A5A44"];

  const stat = (label, value, tone, Icon) => (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 flex items-center gap-3">
      <div style={{ background: tone, color: "#fff", boxShadow: `0 2px 6px ${tone}55` }} className="p-2.5 rounded-xl shrink-0">
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
      <SectionHeader
        icon={Home}
        title={currentUser?.projectName || meta.projectName || "Site Ledger"}
        subtitle={[currentUser?.projectType, currentUser?.projectPlace].filter(Boolean).join(" · ") || "Construction dashboard"}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stat("Total spent", fmtINR(totalSpent), C.rust, IndianRupee)}
        {stat("Budget remaining", fmtINR(remaining), remaining < 0 ? C.red : C.green, Wallet)}
        {stat("Current stage", latestStage, C.navy, Hammer)}
        {stat("Open red flags", redFlags, redFlags ? C.red : C.green, AlertTriangle)}
      </div>

      {expenses.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 mb-8">
          <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4">
            <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-3">
              Monthly spend
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyChartData}>
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.concrete, fontFamily: "IBM Plex Mono, monospace" }} axisLine={{ stroke: C.line }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.concrete, fontFamily: "IBM Plex Mono, monospace" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `₹${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ fontFamily: "Inter, sans-serif", fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                <Bar dataKey="amount" fill={C.rust} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4">
            <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-3">
              Spend by category
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {categoryChartData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [fmtINR(v), n]} contentStyle={{ fontFamily: "Inter, sans-serif", fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
              {categoryChartData.map((c, i) => (
                <span key={c.name} style={{ color: C.concrete }} className="text-xs flex items-center gap-1">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block" }} />
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stage ledger — signature element */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-5 mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide">
            Construction sequence
          </h3>
          <div className="flex items-center gap-3 text-xs" style={{ color: C.concrete }}>
            <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block" }} /> Completed</span>
            <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: "50%", border: `2px solid ${C.rust}`, display: "inline-block" }} /> In progress</span>
          </div>
        </div>
        <div className="relative pl-1 overflow-x-auto">
          <div className="flex items-start" style={{ minWidth: "760px" }}>
            {stageOrder.map((s, i) => {
              const done = completedStages.has(s);
              const inProgress = !done && loggedStages.has(s);
              const lineActive = done; // the connecting line only fills once a stage is actually marked complete
              return (
                <div key={s} className="flex-1 flex flex-col items-center relative">
                  {i !== 0 && (
                    <div
                      style={{
                        position: "absolute", top: "11px", right: "50%", height: "2px", width: "100%",
                        background: lineActive ? C.green : C.line,
                        backgroundImage: lineActive ? "none" : `repeating-linear-gradient(90deg, ${C.line} 0 6px, transparent 6px 12px)`,
                      }}
                    />
                  )}
                  <div
                    style={{
                      width: 22, height: 22, borderRadius: "50%", zIndex: 1,
                      background: done ? C.green : "#fff",
                      border: `2px solid ${done ? C.green : inProgress ? C.rust : C.concrete}`,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: done || inProgress ? C.ink : C.concrete,
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
        <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mt-6">
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
  { key: "flag", label: "Flag (set by AI)", type: "text" },
  { key: "flagReason", label: "AI flag reason", type: "text" },
];

// Photos are stored under their own key per entry (not inside the progress
// list) so the daily log stays small and fast to load as photos pile up.
const progressPhotoKey = (id) => `progress-photos-${id}`;
const PHOTO_SLOTS = [
  { key: "start", label: "Start of day" },
  { key: "end", label: "End of day" },
];

// Ask the AI to watch the entry and decide the flag. Returns { flag, reason }.
async function reviewProgressEntry(entry, photos, { recent = [], planText = "", completedStages = [] } = {}) {
  const imgs = PHOTO_SLOTS.filter((s) => photos?.[s.key]).map((s) => ({ data: photos[s.key], mimeType: "image/jpeg" }));
  const history = recent
    .slice(0, 10)
    .map((p) => `${p.date} — ${p.stage} (${p.workersCount || "?"} workers): ${p.description || ""}`)
    .join("\n");
  const photoNote = imgs.length === 2
    ? "Two site photos are attached: the first from the START of the day, the second from the END of the day. Compare them — did visible work actually happen?"
    : imgs.length === 1
    ? "One site photo is attached."
    : "No photos were attached.";
  const text = `You are watching a house construction site in Bangalore, India on behalf of the homeowner, who is not on site. Review today's log entry and decide if anything needs the homeowner's attention.

Today's entry:
Date: ${entry.date}
Stage: ${entry.stage}
Workers on site: ${entry.workersCount || "not given"}
What happened: ${entry.description || "(nothing written)"}

${photoNote}

Stages already marked complete: ${completedStages.join(", ") || "none"}
Approved plan / schedule: ${planText || "(not provided)"}
Recent log (most recent first):
${history || "(no earlier entries)"}

Look for: safety problems (no helmets, unsafe scaffolding, exposed rebar, open trenches), poor workmanship or material issues visible in photos, work out of sequence (e.g. a stage started before an earlier one is done), very few workers or little visible progress between start and end photos, the description not matching the photos, or falling behind the plan.

Reply in exactly this format and nothing else:
FLAG: NONE or WATCH or RED FLAG
REASON: one or two short sentences a homeowner can understand. If NONE, say briefly what looks fine.`;
  const out = await askClaude({ text, images: imgs });
  const m = out.match(/FLAG:\s*(RED\s*FLAG|WATCH|NONE)/i);
  const r = out.match(/REASON:\s*([\s\S]+)/i);
  const word = m ? m[1].toUpperCase().replace(/\s+/g, " ") : "WATCH";
  const flag = word === "RED FLAG" ? "Red Flag" : word === "WATCH" ? "Watch" : "None";
  return { flag, reason: (r ? r[1] : out).trim().slice(0, 400) };
}

function PhotoPicker({ label, value, onChange }) {
  const ref = useRef();
  return (
    <div>
      <input
        type="file"
        accept="image/*"
        ref={ref}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files[0];
          e.target.value = "";
          if (!file) return;
          onChange(await compressImage(file, 1200, 0.72));
        }}
      />
      {value ? (
        <div className="relative">
          <img src={`data:image/jpeg;base64,${value}`} alt={label} className="w-full rounded-md object-cover" style={{ height: 120 }} />
          <button
            type="button"
            onClick={() => onChange(null)}
            style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
            className="absolute top-1.5 right-1.5 rounded-full p-1"
          >
            <X size={12} />
          </button>
          <div style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }} className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded">{label}</div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current.click()}
          style={{ border: `1.5px dashed ${C.line}`, color: C.concrete, background: "#fff", height: 120 }}
          className="w-full rounded-md flex flex-col items-center justify-center gap-1 text-xs font-semibold hover:opacity-80"
        >
          <Camera size={18} />
          {label}
        </button>
      )}
    </div>
  );
}

function ProgressEntryForm({ onSave }) {
  const [vals, setVals] = useState({ date: today(), stage: "", workersCount: "", description: "" });
  const [photos, setPhotos] = useState({ start: null, end: null });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave(vals, photos);
        setSaving(false);
      }}
    >
      <Field label="Date">
        <input style={inputStyle} type="date" value={vals.date} required onChange={(e) => set("date", e.target.value)} />
      </Field>
      <Field label="Stage">
        <select style={inputStyle} value={vals.stage} required onChange={(e) => set("stage", e.target.value)}>
          <option value="">Select…</option>
          {STAGES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Workers on site">
        <input style={inputStyle} type="number" min="0" value={vals.workersCount} onChange={(e) => set("workersCount", e.target.value)} />
      </Field>
      <Field label="What happened today">
        <textarea style={{ ...inputStyle, minHeight: "70px" }} value={vals.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Site photos (optional)">
        <div className="grid grid-cols-2 gap-2">
          {PHOTO_SLOTS.map((slot) => (
            <PhotoPicker key={slot.key} label={slot.label} value={photos[slot.key]} onChange={(v) => setPhotos((p) => ({ ...p, [slot.key]: v }))} />
          ))}
        </div>
      </Field>
      <p style={{ color: C.concrete }} className="text-xs mb-3 flex items-center gap-1.5">
        <Sparkles size={12} /> After you save, AI reviews the entry and photos and flags anything worth your attention.
      </p>
      <Btn type="submit" disabled={saving}>
        {saving && <Loader2 size={15} className="animate-spin" />} Save
      </Btn>
    </form>
  );
}

const FLAG_STYLE = {
  "Red Flag": { tone: "red", label: "Red flag", color: C.red },
  Watch: { tone: "yellow", label: "Watch", color: C.yellow },
  None: { tone: "green", label: "Looks OK", color: C.green },
};

function ProgressCard({ entry, onRecheck }) {
  const [photos, setPhotos] = useState(null);
  const [preview, setPreview] = useState(null);
  const hasPhotos = entry.photoSlots && entry.photoSlots.length > 0;

  useEffect(() => {
    let alive = true;
    if (hasPhotos) loadKey(progressPhotoKey(entry.id), null).then((p) => alive && setPhotos(p));
    return () => { alive = false; };
  }, [entry.id, hasPhotos]);

  const slots = PHOTO_SLOTS.filter((s) => entry.photoSlots?.includes(s.key));
  const fs = FLAG_STYLE[entry.flag];

  return (
    <div>
      {hasPhotos && (
        <div className="relative -mx-4 -mt-4 mb-3 rounded-t-lg overflow-hidden" style={{ background: C.paperDark }}>
          <div className={`grid ${slots.length === 2 ? "grid-cols-2 gap-0.5" : "grid-cols-1"}`}>
            {slots.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => photos?.[s.key] && setPreview({ name: `${entry.date} — ${entry.stage} — ${s.label}`, mimeType: "image/jpeg", data: photos[s.key] })}
                className="relative block"
                style={{ height: 190 }}
              >
                {photos?.[s.key] ? (
                  <img src={`data:image/jpeg;base64,${photos[s.key]}`} alt={s.label} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Loader2 size={18} className="animate-spin" style={{ color: C.concrete }} /></div>
                )}
                <span style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }} className="absolute bottom-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded">{s.label}</span>
              </button>
            ))}
          </div>
          {/* Stage + what happened, laid over the top of the photos */}
          <div
            style={{ background: "linear-gradient(180deg, rgba(10,20,32,0.85) 0%, rgba(10,20,32,0.55) 65%, transparent 100%)", pointerEvents: "none" }}
            className="absolute top-0 left-0 right-0 px-3 pt-2.5 pb-6 text-white"
          >
            <div style={{ fontFamily: "'Oswald', sans-serif" }} className="font-semibold uppercase text-sm tracking-wide pr-6">{entry.stage}</div>
            {entry.description && (
              <p className="text-xs leading-snug" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {entry.description}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-1 pr-6">
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{entry.date}</span>
        {entry.flag === "Checking" && (
          <span style={{ color: C.concrete }} className="text-xs inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> AI is reviewing…</span>
        )}
        {fs && (entry.flag !== "None" || entry.flagReason) && <Stamp tone={fs.tone}>{fs.label}</Stamp>}
      </div>
      {!hasPhotos && (
        <>
          <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm mb-1">{entry.stage}</div>
          <p style={{ color: C.ink }} className="text-sm">{entry.description}</p>
        </>
      )}
      {entry.workersCount && <div style={{ color: C.concrete }} className="text-xs mt-1">{entry.workersCount} workers on site</div>}
      {entry.flagReason && (
        <div style={{ borderLeft: `3px solid ${fs?.color || C.concrete}`, background: "#fff", color: C.ink }} className="mt-2 text-xs px-2.5 py-1.5 rounded-r">
          <span className="font-semibold inline-flex items-center gap-1"><Sparkles size={11} /> AI:</span> {entry.flagReason}
        </div>
      )}
      {entry.flag !== "Checking" && (
        <button onClick={() => onRecheck(entry, photos)} style={{ color: C.navy }} className="text-xs underline mt-2">
          {entry.flagReason ? "Re-check with AI" : "Check with AI"}
        </button>
      )}
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ProgressTab({ progress, setProgress, meta, setMeta }) {
  const [planDraft, setPlanDraft] = useState(meta.planText || "");
  const [planFile, setPlanFile] = useState(meta.planFile || null);
  const [planFilePreview, setPlanFilePreview] = useState(false);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState("");
  const planFileRef = useRef();
  const completedStages = new Set(meta.completedStages || []);
  const loggedStages = new Set(progress.map((p) => p.stage));

  // Always points at the latest list, so an AI review that finishes later
  // doesn't overwrite entries added or removed in the meantime.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const patchEntry = async (id, patch) => {
    const next = progressRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p));
    progressRef.current = next;
    setProgress(next);
    await saveKey("progress", next);
  };

  const runReview = async (entry, photos) => {
    await patchEntry(entry.id, { flag: "Checking" });
    try {
      const pics = photos || (entry.photoSlots?.length ? await loadKey(progressPhotoKey(entry.id), null) : null);
      const { flag, reason } = await reviewProgressEntry(entry, pics, {
        recent: progressRef.current.filter((p) => p.id !== entry.id),
        planText: meta.planText,
        completedStages: meta.completedStages || [],
      });
      await patchEntry(entry.id, { flag, flagReason: reason });
    } catch (e) {
      console.error("[SiteLedger] AI review failed", e);
      await patchEntry(entry.id, { flag: entry.flag === "Checking" ? "" : entry.flag || "", flagReason: entry.flagReason || "" });
    }
  };

  const saveEntry = (addItem) => async (vals, photos) => {
    const id = uid();
    const photoSlots = PHOTO_SLOTS.filter((s) => photos[s.key]).map((s) => s.key);
    if (photoSlots.length) await saveKey(progressPhotoKey(id), photos);
    const entry = { id, ...vals, photoSlots, flag: "Checking", flagReason: "" };
    const next = await addItem(entry);
    progressRef.current = next;
    runReview(entry, photos);
  };

  const savePlan = async () => {
    const next = { ...meta, planText: planDraft };
    setMeta(next);
    await saveKey("meta", next);
  };

  const onPickPlanFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const b64 = isImage ? await compressImage(file, 1000, 0.75) : await fileToBase64(file);
    const nextFile = { name: file.name, type: isImage ? "image/jpeg" : (file.type || "application/octet-stream"), b64 };
    setPlanFile(nextFile);
    const next = { ...meta, planFile: nextFile };
    setMeta(next);
    await saveKey("meta", next);
  };

  const removePlanFile = async () => {
    setPlanFile(null);
    const next = { ...meta, planFile: null };
    setMeta(next);
    await saveKey("meta", next);
  };

  const toggleStageComplete = async (stage) => {
    const current = new Set(meta.completedStages || []);
    if (current.has(stage)) current.delete(stage);
    else current.add(stage);
    const next = { ...meta, completedStages: Array.from(current) };
    setMeta(next);
    await saveKey("meta", next);
  };

  const crossCheck = async () => {
    if (!planDraft.trim() && !planFile) return;
    setChecking(true);
    setReview("");
    try {
      const log = progress
        .slice(0, 40)
        .map((p) => `${p.date} — ${p.stage} (${p.workersCount || "?"} workers): ${p.description || ""} [flag: ${p.flag || "None"}]`)
        .join("\n");
      const out = await askClaude({
        text: `You are helping a homeowner in Bangalore who is self-building a house track whether construction is on schedule and matches the approved plan. Here is the building plan / schedule they described:\n\n${planDraft || "(see attached plan file)"}\n\nHere is the site progress log so far (most recent first):\n\n${log || "(no entries yet)"}\n\nCross-question this like a careful project manager: identify any mismatches with the plan, sequencing problems, stages that seem delayed, or missing information you'd want to ask the homeowner about. End with a clear verdict: ON TRACK, WATCH, or RED FLAG, and why. Be concise and specific.`,
        ...(planFile && (planFile.type.startsWith("image/") || planFile.type === "application/pdf")
          ? { images: [{ data: planFile.b64, mimeType: planFile.type }] }
          : {}),
      });
      setReview(out);
    } catch (e) {
      setReview("Could not complete the review — try again in a moment.");
    }
    setChecking(false);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2">
          Stage completion
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-3">
          Logging progress on a stage doesn't mark it done by itself — a stage can take several visits. Tick it off here once it's actually finished; that's what fills in green on the dashboard.
        </p>
        <div className="flex flex-wrap gap-2">
          {STAGES.filter((s) => s !== "Other").map((s) => {
            const done = completedStages.has(s);
            const inProgress = !done && loggedStages.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStageComplete(s)}
                style={{
                  border: `1.5px solid ${done ? C.green : inProgress ? C.rust : C.line}`,
                  background: done ? C.green : "#fff",
                  color: done ? "#fff" : C.ink,
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5"
              >
                {done && <CheckCircle2 size={13} />}
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2">
          Building plan &amp; schedule
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-2">
          Paste your approved plan, stage-wise timeline, or key milestones here, or upload the plan/schedule file itself. Claude will cross-question your day-to-day log against it.
        </p>
        <textarea
          style={{ ...inputStyle, minHeight: "90px" }}
          value={planDraft}
          onChange={(e) => setPlanDraft(e.target.value)}
          onBlur={savePlan}
          placeholder="e.g. Foundation by 15 Sep, Superstructure by 30 Nov, Roof slab by 15 Jan…"
        />
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" ref={planFileRef} className="hidden" onChange={onPickPlanFile} />
          <Btn onClick={() => planFileRef.current.click()} tone="ghost" small>
            <Paperclip size={14} /> {planFile ? "Replace file" : "Upload plan / schedule file"}
          </Btn>
          {planFile && (
            <span style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md">
              <button
                onClick={() => setPlanFilePreview(true)}
                style={{ color: C.navy, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                className="underline"
              >
                {planFile.name}
              </button>
              <button onClick={removePlanFile} style={{ color: C.concrete }} className="hover:text-red-600">
                <X size={13} />
              </button>
            </span>
          )}
        </div>
        {planFilePreview && (
          <FilePreview file={{ name: planFile.name, mimeType: planFile.type, data: planFile.b64 }} onClose={() => setPlanFilePreview(false)} />
        )}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Btn onClick={crossCheck} disabled={checking || (!planDraft.trim() && !planFile)} tone="rust">
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
        enableImportExport
        exportFileName="daily-progress-log"
        renderForm={({ addItem }) => <ProgressEntryForm onSave={saveEntry(addItem)} />}
        onRemoveItem={(item) => item.photoSlots?.length && saveKey(progressPhotoKey(item.id), null)}
        renderCard={(p) => <ProgressCard entry={p} onRecheck={runReview} />}
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
        images: [{ data: pending.b64, mimeType: "image/jpeg" }],
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
          <div key={g.id} style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg overflow-hidden">
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

function BudgetTab({ expenses, setExpenses, permissions, meta, setMeta, loan, setLoan, agreement, setAgreement }) {
  const [budgetDraft, setBudgetDraft] = useState(meta.budgetAllocated || "");
  const [markingId, setMarkingId] = useState(null); // milestone id currently being marked paid
  const [markDraft, setMarkDraft] = useState({ paidDate: today(), paidAmount: "", notes: "" });

  const agreementPaid = (agreement?.milestones || []).reduce(
    (s, m) => s + (m.status === "Paid" ? Number(m.paidAmount || m.agreedAmount || 0) : 0), 0
  );
  const agreementRemaining = Number(agreement?.totalValue || 0) - agreementPaid;

  const openMarkPaid = (milestone) => {
    setMarkingId(milestone.id);
    setMarkDraft({ paidDate: today(), paidAmount: milestone.agreedAmount, notes: "" });
  };

  const saveMarkPaid = async () => {
    const next = {
      ...agreement,
      milestones: agreement.milestones.map((m) =>
        m.id === markingId ? { ...m, status: "Paid", paidDate: markDraft.paidDate, paidAmount: markDraft.paidAmount, notes: markDraft.notes } : m
      ),
    };
    setAgreement(next);
    await saveKey("agreement", next);
    setMarkingId(null);
  };

  const undoPaid = async (id) => {
    const next = {
      ...agreement,
      milestones: agreement.milestones.map((m) => (m.id === id ? { ...m, status: "Pending", paidDate: "", paidAmount: "" } : m)),
    };
    setAgreement(next);
    await saveKey("agreement", next);
  };

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

      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6 grid gap-4 sm:grid-cols-3 items-end">
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

      {/* Builder payment as per construction agreement */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide">
              Builder payment — per agreement
            </h3>
            <p style={{ color: C.concrete }} className="text-xs">
              {agreement?.builderName} · contract value {fmtINR(agreement?.totalValue)} · milestone-based, not fixed dates
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-right">
              <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold">Paid</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.green }} className="text-lg font-semibold">{fmtINR(agreementPaid)}</div>
            </div>
            <div className="text-right">
              <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold">Remaining</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(agreementRemaining)}</div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {(agreement?.milestones || []).map((m) => (
            <div key={m.id} style={{ border: `1px solid ${C.line}`, background: m.status === "Paid" ? "#fff" : "rgba(0,0,0,0.015)" }} className="rounded-md px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
              <div>
                <div style={{ color: C.ink }} className="text-sm font-semibold">{m.milestone}</div>
                <div style={{ color: C.concrete }} className="text-xs">
                  {m.percent}% · agreed {fmtINR(m.agreedAmount)}
                  {m.status === "Paid" && ` · paid ${fmtINR(m.paidAmount || m.agreedAmount)} on ${m.paidDate}`}
                </div>
              </div>
              {m.status === "Paid" ? (
                <div className="flex items-center gap-2">
                  <Stamp tone="green">Paid</Stamp>
                  <button onClick={() => undoPaid(m.id)} style={{ color: C.concrete }} className="text-xs underline">undo</button>
                </div>
              ) : (
                <Btn small onClick={() => openMarkPaid(m)}>Mark paid</Btn>
              )}
            </div>
          ))}
        </div>
      </div>

      {markingId && (
        <Modal title="Mark milestone paid" onClose={() => setMarkingId(null)}>
          <Field label="Date paid">
            <input style={inputStyle} type="date" value={markDraft.paidDate} onChange={(e) => setMarkDraft({ ...markDraft, paidDate: e.target.value })} />
          </Field>
          <Field label="Amount paid (₹)">
            <input style={inputStyle} type="number" value={markDraft.paidAmount} onChange={(e) => setMarkDraft({ ...markDraft, paidAmount: e.target.value })} />
          </Field>
          <Field label="Notes (optional)">
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={markDraft.notes} onChange={(e) => setMarkDraft({ ...markDraft, notes: e.target.value })} />
          </Field>
          <Btn onClick={saveMarkPaid}>Save</Btn>
        </Modal>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
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

      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mt-8">
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
  { key: "productId", label: "Product ID / material no. (optional)", type: "text" },
  { key: "price", label: "Price paid (₹)", type: "number" },
  { key: "claimedPrice", label: "Builder's quoted price (₹)", type: "number" },
  { key: "vendor", label: "Vendor / shop", type: "text" },
  { key: "image", label: "Photo (helps you identify the exact product later)", type: "file", accept: "image/*" },
  { key: "notes", label: "Notes", type: "textarea" },
];

function ProductsTab({ products, setProducts }) {
  const [checkItem, setCheckItem] = useState("");
  const [checkId, setCheckId] = useState("");
  const [checkPrice, setCheckPrice] = useState("");
  const [checkImage, setCheckImage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState("");
  const [preview, setPreview] = useState(null);
  const checkImageRef = useRef();

  const onPickCheckImage = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const data = await compressImage(file, 1000, 0.75);
    setCheckImage({ name: file.name, mimeType: "image/jpeg", data });
  };

  const runCheck = async () => {
    if (!checkItem.trim() && !checkImage) return;
    setChecking(true);
    setResult("");
    try {
      const idPart = checkId.trim() ? ` (product ID / model number: "${checkId.trim()}")` : "";
      const pricePart = checkPrice ? ` at ₹${checkPrice}` : "";
      const text = checkImage
        ? `A construction builder in Bangalore, India quoted this item${checkItem.trim() ? `: "${checkItem}"` : ""}${idPart}${pricePart}. A photo of the item is attached — use it to identify the exact product (brand, type, likely model) if that isn't already clear from the description. Then search the web for typical current market prices for this item in India (Bangalore where relevant). Tell me: 1) what you think the product is, 2) whether the quoted price seems fair, overpriced, or a good deal, with a rough price range you found, 3) 2-3 specific alternative brands/models at a similar or better price, 4) a one-line verdict. Keep it short and practical.`
        : `A construction builder in Bangalore, India quoted this item: "${checkItem}"${idPart}${pricePart}. Search the web for typical current market prices for this item in India (Bangalore where relevant). Tell me: 1) whether the quoted price seems fair, overpriced, or a good deal, with a rough price range you found, 2) 2-3 specific alternative brands/models at a similar or better price, 3) a one-line verdict. Keep it short and practical.`;
      const out = await askClaude({
        useSearch: true,
        text,
        ...(checkImage ? { images: [{ data: checkImage.data, mimeType: checkImage.mimeType }] } : {}),
      });
      setResult(out);
    } catch {
      setResult("Could not complete the price check — try again in a moment.");
    }
    setChecking(false);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2 flex items-center gap-2">
          <Search size={16} /> Check a builder's quote
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-3">
          Describe the item, or attach a photo and let AI identify it — either way you'll get a market price check.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item the builder quoted">
            <input style={inputStyle} value={checkItem} onChange={(e) => setCheckItem(e.target.value)} placeholder="e.g. Kajaria vitrified tile 2x2" />
          </Field>
          <Field label="Product ID / model number (optional)">
            <input style={inputStyle} value={checkId} onChange={(e) => setCheckId(e.target.value)} placeholder="e.g. SKU, batch or model code" />
          </Field>
          <Field label="Their quoted price (₹, optional)">
            <input style={inputStyle} type="number" value={checkPrice} onChange={(e) => setCheckPrice(e.target.value)} />
          </Field>
          <Field label="Photo (optional)">
            <div className="flex items-center gap-2 flex-wrap">
              <input type="file" accept="image/*" ref={checkImageRef} className="hidden" onChange={onPickCheckImage} />
              <Btn onClick={() => checkImageRef.current.click()} tone="ghost" small>
                <Paperclip size={14} /> {checkImage ? "Replace photo" : "Attach photo"}
              </Btn>
              {checkImage && (
                <span style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md">
                  <button type="button" onClick={() => setPreview(checkImage)} style={{ color: C.navy }} className="underline">
                    {checkImage.name}
                  </button>
                  <button type="button" onClick={() => setCheckImage(null)} style={{ color: C.concrete }} className="hover:text-red-600">
                    <X size={13} />
                  </button>
                </span>
              )}
            </div>
          </Field>
        </div>
        <Btn onClick={runCheck} disabled={checking || (!checkItem.trim() && !checkImage)} tone="rust">
          {checking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Check price
        </Btn>
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
          <div className="flex items-start gap-3">
            {p.image && (
              <button type="button" onClick={() => setPreview(p.image)} className="shrink-0">
                <img
                  src={`data:${p.image.mimeType};base64,${p.image.data}`}
                  alt={p.item}
                  style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.line}` }}
                />
              </button>
            )}
            <div className="min-w-0">
              <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm">{p.item}</div>
              <div style={{ color: C.concrete }} className="text-xs mb-1">{p.room} {p.brand && `· ${p.brand}`}</div>
              {p.productId && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs mb-1">ID: {p.productId}</div>
              )}
              <div className="flex items-center gap-3">
                {p.price && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">Paid {fmtINR(p.price)}</span>}
                {p.claimedPrice && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">Quoted {fmtINR(p.claimedPrice)}</span>}
              </div>
              {p.vendor && <div style={{ color: C.concrete }} className="text-xs mt-1">From {p.vendor}</div>}
              {p.notes && <p style={{ color: C.ink }} className="text-sm mt-1">{p.notes}</p>}
            </div>
          </div>
        )}
      />
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Documents tab (bills & agreements)                                     */
/* ---------------------------------------------------------------------- */
const DOCUMENT_TYPES = ["Bill", "Agreement", "Receipt", "Design", "Other"];

const documentSchema = [
  { key: "title", label: "Title", type: "text", required: true },
  { key: "type", label: "Type", type: "select", options: DOCUMENT_TYPES, required: true },
  { key: "date", label: "Date", type: "date" },
  { key: "amount", label: "Amount (₹)", type: "number" },
  { key: "attachment", label: "Attach file (photo, PDF, scan)", type: "file", accept: ".pdf,.doc,.docx,image/*" },
  { key: "notes", label: "Notes", type: "textarea" },
];

function DocumentsTab({ documents, setDocuments, currentUser }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const isOwner = currentUser?.role === "owner";

  const [typeFilter, setTypeFilter] = useState("All");

  // Bills, receipts, and "other" are private to whoever uploaded them
  // (plus the owner, who sees everything). Agreements are shared between
  // the builder and the owner only. Designs (drawings, plans, elevations)
  // are shared with everyone on the project, since the whole site team
  // needs to build from them.
  const canSee = (d) => {
    if (isOwner) return true;
    if (d.type === "Design") return true;
    if (d.type === "Agreement") return currentUser?.role === "builder";
    return !!d.uploadedBy && d.uploadedBy === currentUser?.id;
  };
  const visible = documents.filter(canSee);
  const countFor = (t) => (t === "All" ? visible.length : visible.filter((d) => d.type === t).length);
  const shown = typeFilter === "All" ? visible : visible.filter((d) => d.type === typeFilter);

  // Deliberately operate on the FULL `documents` array here, not
  // `visible` — persisting a filtered subset would silently drop every
  // document this viewer can't see.
  const add = async (vals) => {
    const doc = { id: uid(), uploadedBy: currentUser?.id || null, uploadedByName: currentUser?.name || currentUser?.email || "", ...vals };
    const next = [doc, ...documents];
    setDocuments(next);
    setOpen(false);
    const ok = await saveKey("documents", next);
    console.log(ok ? `[SiteLedger] Document uploaded: "${doc.title}" (${doc.type})` : `[SiteLedger] Document upload FAILED: "${doc.title}"`);
  };
  const remove = async (id) => {
    const next = documents.filter((d) => d.id !== id);
    setDocuments(next);
    await saveKey("documents", next);
  };

  return (
    <div>
      <SectionHeader
        icon={FileText}
        title="Bills &amp; agreements"
        subtitle={
          isOwner
            ? "Keep a record for future reference and disputes"
            : "Your bills/receipts are private to you and the owner; agreements are shared with the builder and owner; designs are shared with the whole team"
        }
        action={
          <Btn onClick={() => setOpen(true)}>
            <Plus size={16} /> Add document
          </Btn>
        }
      />
      {visible.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {["All", ...DOCUMENT_TYPES].map((t) => {
            const active = typeFilter === t;
            const n = countFor(t);
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  background: active ? C.navy : C.card,
                  color: active ? "#fff" : C.ink,
                  border: `1px solid ${active ? C.navy : C.line}`,
                  opacity: n === 0 && !active ? 0.55 : 1,
                  transition: "background 150ms, color 150ms",
                }}
                className="rounded-full px-3 py-1 text-xs font-semibold"
              >
                {t} <span style={{ fontFamily: "'IBM Plex Mono', monospace", opacity: 0.75 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {visible.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">Nothing here yet.</p>
      )}
      {visible.length > 0 && shown.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">No {typeFilter.toLowerCase()} documents yet.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((d) => (
          <div key={d.id} style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)", transition: "box-shadow 150ms, transform 150ms" }} className="rounded-lg p-4 relative hover:shadow-md hover:-translate-y-0.5">
            <button
              onClick={() => remove(d.id)}
              style={{ color: C.concrete }}
              className="absolute top-3 right-3 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold uppercase text-sm">{d.title}</span>
              <Stamp tone="navy">{d.type}</Stamp>
            </div>
            <div style={{ color: C.concrete }} className="text-xs mb-1">
              {d.date}{isOwner && d.uploadedByName ? ` · ${d.uploadedByName}` : ""}
            </div>
            {d.amount ? <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">{fmtINR(d.amount)}</div> : null}
            <p style={{ color: C.ink }} className="text-sm mt-1">{d.notes}</p>
            {d.attachment && (
              <button
                onClick={() => setPreview(d.attachment)}
                style={{ color: C.navy, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                className="text-xs underline mt-2 inline-flex items-center gap-1"
              >
                <Paperclip size={12} /> {d.attachment.name}
              </button>
            )}
          </div>
        ))}
      </div>
      {open && (
        <Modal title="Add document" onClose={() => setOpen(false)}>
          <SchemaForm schema={documentSchema} onSubmit={add} />
        </Modal>
      )}
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
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
/*  Team tab (owner only) — add members, promote to owner                  */
/* ---------------------------------------------------------------------- */
function TeamTab({ currentUserEmail }) {
  const [members, setMembers] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    const { supabase } = await import("./lib/supabaseClient");
    const projectId = getActiveProjectId();
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, joined_at, profiles(name, email)")
      .eq("project_id", projectId)
      .order("joined_at", { ascending: true });
    setMembers(data || []);
  };

  useEffect(() => { load(); }, []);

  const changeRole = async (userId, role) => {
    setSavingId(userId);
    const { supabase } = await import("./lib/supabaseClient");
    const { logAudit } = await import("./lib/audit");
    const projectId = getActiveProjectId();
    await supabase.from("project_members").update({ role }).eq("project_id", projectId).eq("user_id", userId);
    await logAudit("role_changed", { user_id: userId, new_role: role });
    await load();
    setSavingId(null);
  };

  return (
    <div>
      <SectionHeader icon={UserCog} title="Team" subtitle="Everyone on this project — promote anyone to owner here" />
      {members === null && <p style={{ color: C.concrete }} className="text-sm italic">Loading…</p>}
      <div className="space-y-2">
        {members?.map((m) => (
          <div key={m.user_id} style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-md px-4 py-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold text-sm">{m.profiles?.name || m.profiles?.email}</div>
              <div style={{ color: C.concrete }} className="text-xs">{m.profiles?.email}{m.profiles?.email === currentUserEmail && " · you"}</div>
            </div>
            <select
              style={{ ...inputStyle, width: "auto" }}
              value={m.role}
              disabled={savingId === m.user_id}
              onChange={(e) => changeRole(m.user_id, e.target.value)}
            >
              {ALL_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Audit log tab (owner only)                                             */
/* ---------------------------------------------------------------------- */
function AuditLogTab() {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    import("./lib/supabaseClient").then(({ supabase }) => {
      const projectId = getActiveProjectId();
      supabase
        .from("audit_log")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(200)
        .then(({ data }) => setEntries(data || []));
    });
  }, []);

  const actionLabel = {
    login: "Signed in",
    login_failed: "Sign-in failed",
    logout: "Signed out",
    data_saved: "Updated data",
    save_failed: "Save failed",
    project_created: "Created the project",
    project_joined: "Joined the project",
    role_changed: "Changed a role",
  };

  return (
    <div>
      <SectionHeader icon={ShieldCheck} title="Audit log" subtitle="Every login and data change, most recent first — visible to the owner only" />
      {entries === null && <p style={{ color: C.concrete }} className="text-sm italic">Loading…</p>}
      {entries?.length === 0 && <p style={{ color: C.concrete }} className="text-sm italic">Nothing logged yet.</p>}
      <div className="space-y-2">
        {entries?.map((e) => (
          <div key={e.id} style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-md px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
            <div>
              <span style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="text-sm font-semibold uppercase">
                {actionLabel[e.action] || e.action}
              </span>
              <span style={{ color: C.concrete }} className="text-xs ml-2">{e.user_email}</span>
              {e.details?.key && (
                <span style={{ color: C.concrete }} className="text-xs ml-2">· {e.details.key}</span>
              )}
            </div>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">
              {new Date(e.created_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
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
const OWNER_TABS = [
  { key: "team", label: "Team", icon: UserCog },
  { key: "audit", label: "Audit Log", icon: ShieldCheck },
];

export default function App({ currentUser, onSignOut, onSwitchProject }) {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);

  const [meta, setMeta] = useState({ projectName: "Site Ledger", budgetAllocated: "", planText: "", completedStages: [] });
  const [progress, setProgress] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loan, setLoan] = useState({ enabled: false, sanctioned: "", disbursed: "", entries: [] });
  const [agreement, setAgreement] = useState(DEFAULT_AGREEMENT);

  useEffect(() => {
    (async () => {
      const [m, p, g, e, perm, c, prod, doc, iss, l, agr] = await Promise.all([
        loadKey("meta", { projectName: "Site Ledger", budgetAllocated: "", planText: "", completedStages: [] }),
        loadKey("progress", []),
        loadKey("gallery", []),
        loadKey("expenses", []),
        loadKey("permissions", []),
        loadKey("contacts", []),
        loadKey("products", []),
        loadKey("documents", []),
        loadKey("issues", []),
        loadKey("loan", { enabled: false, sanctioned: "", disbursed: "", entries: [] }),
        loadKey("agreement", DEFAULT_AGREEMENT),
      ]);
      setMeta(m); setProgress(p); setGallery(g); setExpenses(e); setPermissions(perm);
      setContacts(c); setProducts(prod); setDocuments(doc); setIssues(iss); setLoan(l);
      setAgreement(agr);
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
  const canSee = (tabKey) => (ROLE_TAB_ACCESS[currentUser?.role] || ROLE_TAB_ACCESS.other).includes(tabKey);

  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      <style>{FONTS}</style>
      <header style={{ background: `linear-gradient(180deg, ${C.navy} 0%, #122841 100%)` }} className="text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <Hammer size={22} style={{ color: C.yellow }} />
            <span style={{ fontFamily: "'Oswald', sans-serif" }} className="text-lg font-semibold tracking-wide uppercase">
              {currentUser?.projectName || "Site Ledger"}
            </span>
            <span style={{ color: "#9FB4C7" }} className="text-xs ml-1">
              {[currentUser?.projectType, currentUser?.projectPlace].filter(Boolean).join(" · ") || "Build tracker"}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {currentUser && (
                <span style={{ color: "#B9C7D4" }} className="text-xs hidden sm:inline">
                  {currentUser.name || currentUser.email}
                  <span style={{ color: C.yellow }} className="ml-1 font-semibold uppercase">
                    · {ROLE_LABELS[currentUser.role] || currentUser.role}
                  </span>
                </span>
              )}
              {onSwitchProject && (
                <button onClick={onSwitchProject} style={{ color: "#B9C7D4" }} className="flex items-center gap-1 text-xs">
                  <Repeat size={14} /> Projects
                </button>
              )}
              {onSignOut && (
                <button onClick={onSignOut} style={{ color: "#B9C7D4" }} className="flex items-center gap-1 text-xs">
                  <LogOut size={14} /> Sign out
                </button>
              )}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-0 -mb-px">
            {[...TABS.filter((t) => (ROLE_TAB_ACCESS[currentUser?.role] || ROLE_TAB_ACCESS.other).includes(t.key)), ...(currentUser?.role === "owner" ? OWNER_TABS : [])].map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    borderBottom: active ? `3px solid ${C.rust}` : "3px solid transparent",
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                    color: active ? "#fff" : "#B9C7D4",
                    fontFamily: "'Inter', sans-serif",
                    whiteSpace: "nowrap",
                    transition: "background 150ms, color 150ms",
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                  }}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold hover:text-white hover:bg-white/5"
                >
                  <Icon size={15} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "dashboard" && <Dashboard data={data} setTab={setTab} currentUser={currentUser} />}
        {tab === "progress" && <ProgressTab progress={progress} setProgress={setProgress} meta={meta} setMeta={setMeta} />}
        {tab === "gallery" && <GalleryTab gallery={gallery} setGallery={setGallery} />}
        {tab === "budget" && canSee("budget") && (
          <BudgetTab
            expenses={expenses} setExpenses={setExpenses}
            permissions={permissions} meta={meta} setMeta={setMeta}
            loan={loan} setLoan={setLoan}
            agreement={agreement} setAgreement={setAgreement}
          />
        )}
        {tab === "permissions" && canSee("permissions") && <PermissionsTab permissions={permissions} setPermissions={setPermissions} />}
        {tab === "people" && canSee("people") && <PeopleTab contacts={contacts} setContacts={setContacts} />}
        {tab === "products" && canSee("products") && <ProductsTab products={products} setProducts={setProducts} />}
        {tab === "documents" && canSee("documents") && <DocumentsTab documents={documents} setDocuments={setDocuments} currentUser={currentUser} />}
        {tab === "issues" && <IssuesTab issues={issues} setIssues={setIssues} />}
        {tab === "team" && currentUser?.role === "owner" && <TeamTab currentUserEmail={currentUser.email} />}
        {tab === "audit" && currentUser?.role === "owner" && <AuditLogTab />}
      </main>

      <footer style={{ color: C.concrete }} className="text-center text-xs py-6">
        Signed in as {currentUser?.email} — data is shared with everyone invited to this project.
      </footer>
    </div>
  );
}
