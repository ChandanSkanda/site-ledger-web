import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Hammer, Camera, Wallet, FileCheck, Users, Package, Search, FileText,
  AlertTriangle, Phone, Plus, X, TrendingUp, Home, ClipboardList, Landmark,
  Trash2, Sparkles, Loader2, CheckCircle2, IndianRupee, CalendarDays, ShieldCheck, LogOut, UserCog, Repeat,
  Upload, Download, Paperclip, Pencil, MapPin, RotateCcw, ArrowUp, ArrowDown, ListOrdered,
} from "lucide-react";
import { loadKey, saveKey } from "./lib/storage";
import { askClaude as askClaudeApi } from "./lib/ai";
import { ROLE_LABELS, ROLE_TAB_ACCESS, ALL_ROLES } from "./lib/roles";
import { getActiveProjectId } from "./lib/activeProject";
import { readWhatsAppExport, groupByDay, listDocuments, cleanDocName, deviceTimeZone, SITE_TIME_ZONE } from "./lib/whatsapp";
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

/* Tab bar scrolls sideways on narrow screens, but without a visible bar. */
.no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }

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

// ---- Stages: built-in list + your own stages / mini projects (e.g. "Lift installation").
// A stage counts as DONE when:
//   • you ticked it (manual), or
//   • AI marked it from the log ("Excavation work completed…"), or
//   • a later stage in the main structural chain has already started
//     (e.g. once Foundation work is logged, Excavation must be finished).
// You can always override: tapping a chip forces it on/off, "Reset" hands it back to AI.
const STRUCTURE_CHAIN = ["Demolition", "Excavation", "Foundation", "Plinth", "Superstructure", "Roof / Slab"];

function getStages(meta) {
  const base = STAGES.filter((s) => s !== "Other");
  const custom = (meta?.customStages || []).filter((c) => c && !base.includes(c));
  const all = [...base, ...custom];
  // Your own order (Reorder stages), with any stage not in it kept at the end.
  const order = (meta?.stageOrder || []).filter((x) => all.includes(x));
  const ordered = [...order, ...all.filter((x) => !order.includes(x))];
  return [...ordered, "Other"];
}

function stageState(meta, stage, loggedStages = new Set()) {
  const manualOn = (meta?.completedStages || []).includes(stage);
  const manualOff = (meta?.stageManualOff || []).includes(stage);
  const auto = meta?.stageAuto?.[stage];
  let implied = null;
  const idx = STRUCTURE_CHAIN.indexOf(stage);
  if (idx > -1) {
    const later = STRUCTURE_CHAIN.slice(idx + 1).find((s) => loggedStages.has(s) || (meta?.completedStages || []).includes(s) || meta?.stageAuto?.[s]);
    if (later) implied = later;
  }
  const aiDone = !!auto || !!implied;
  const done = manualOn || (!manualOff && aiDone);
  const how = manualOn ? "manual" : manualOff ? (aiDone ? "manual-off" : null) : auto ? "ai" : implied ? "implied" : null;
  return { done, how, auto, implied, inProgress: !done && loggedStages.has(stage) };
}

function effectiveCompletedStages(meta, progress = []) {
  const logged = new Set(progress.map((p) => p.stage));
  return getStages(meta).filter((s) => s !== "Other" && stageState(meta, s, logged).done);
}

// A plain "2026-10-25" must be shown as that calendar day in any time zone
// (new Date("2026-10-25") is midnight UTC, i.e. the day before in the US).
const localDay = (ymd) => new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
const fmtDay = (ymd, opts = { day: "numeric", month: "short", year: "numeric" }) => (ymd ? localDay(ymd).toLocaleDateString(undefined, opts) : "—");

// "14 months", "420 days", "1.5 years" → number of days
function periodToDays(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mon|mths?|weeks?|wks?|days?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const mult = u.startsWith("y") ? 365 : u.startsWith("mo") || u.startsWith("mt") || u === "mon" ? 30.44 : u.startsWith("w") ? 7 : 1;
  return Math.round(n * mult);
}

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
  // Rendered straight into <body> so a pop-up opened from inside a card
  // isn't trapped by the card's hover animation.
  return createPortal(

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
    </div>,
    document.body

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

// Attachments used to be a single file; fields marked "multiple" now hold a
// list. This reads either shape so older entries keep working.
const asFileList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

// File picker that clearly shows what's attached. (The browser's own
// "Choose File / No file chosen" box resets after we read the file, which
// made it look like nothing was attached.)
function FileField({ accept, value, onChange, multiple, maxWidth = 1400 }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const files = asFileList(value);

  const readFile = async (file) => {
    const isImage = file.type.startsWith("image/");
    const data = isImage ? await compressImage(file, maxWidth, 0.8) : await fileToBase64(file);
    return { name: file.name, mimeType: isImage ? "image/jpeg" : (file.type || "application/octet-stream"), data };
  };

  const removeAt = (idx) => {
    const next = files.filter((_, k) => k !== idx);
    onChange(multiple ? next : null);
  };

  return (
    <div>
      <input
        type="file"
        ref={ref}
        className="hidden"
        multiple={!!multiple}
        accept={accept || "*/*"}
        onChange={async (e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = "";
          if (!picked.length) return;
          setBusy(true);
          const read = await Promise.all(picked.map(readFile));
          onChange(multiple ? [...files, ...read] : read[0]);
          setBusy(false);
        }}
      />
      <div className="space-y-2">
        {files.map((f, idx) => {
          const isImg = (f.mimeType || "").startsWith("image/");
          return (
            <div key={idx} style={{ background: "#fff", border: `1.5px solid ${C.green}` }} className="rounded-md p-2 flex items-center gap-3">
              {isImg ? (
                <img src={`data:${f.mimeType};base64,${f.data}`} alt="" className="rounded object-cover shrink-0" style={{ width: 52, height: 52 }} />
              ) : (
                <div style={{ background: C.paper, color: C.navy, width: 52, height: 52 }} className="rounded flex items-center justify-center shrink-0"><FileText size={22} /></div>
              )}
              <div className="min-w-0 flex-1">
                <div style={{ color: C.green }} className="text-xs font-semibold flex items-center gap-1"><CheckCircle2 size={13} /> Attached</div>
                <div style={{ color: C.ink }} className="text-xs truncate">{f.name}</div>
              </div>
              {!multiple && (
                <button type="button" onClick={() => ref.current.click()} style={{ color: C.navy }} className="text-xs underline shrink-0">Replace</button>
              )}
              <button type="button" onClick={() => removeAt(idx)} title="Remove" style={{ color: C.concrete }} className="shrink-0 hover:text-red-600"><X size={15} /></button>
            </div>
          );
        })}
        {(multiple || files.length === 0) && (
          <button
            type="button"
            onClick={() => ref.current.click()}
            disabled={busy}
            style={{ border: `1.5px dashed ${C.line}`, color: C.concrete, background: "#fff" }}
            className="w-full rounded-md py-3 flex items-center justify-center gap-2 text-sm font-semibold hover:opacity-80"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : files.length ? <Plus size={16} /> : <Paperclip size={16} />}
            {busy ? "Attaching…" : files.length ? "Add another file" : multiple ? "Choose files (you can pick several)" : "Choose file"}
          </button>
        )}
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
          ) : f.type === "file" ? (
            <FileField accept={f.accept} multiple={f.multiple} maxWidth={f.maxWidth} value={vals[f.key]} onChange={(v) => set(f.key, v)} />
          ) : (
            <input
              style={inputStyle}
              type={f.type || "text"}
              value={vals[f.key]}
              required={f.required}
              placeholder={f.placeholder}
              inputMode={f.inputMode}
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

// Edit + delete buttons in the top-right corner of a card. Delete asks
// first, so a mis-tap on a phone doesn't wipe an entry.
function CardActions({ onEdit, onDelete }) {
  const btn = { color: C.concrete, background: "rgba(245,242,233,0.92)" };
  return (
    <div className="absolute top-2.5 right-2.5 z-10 flex gap-1">
      {onEdit && (
        <button onClick={onEdit} title="Edit" style={btn} className="rounded-full p-1 hover:text-blue-800">
          <Pencil size={14} />
        </button>
      )}
      <button
        onClick={() => { if (window.confirm("Delete this entry? This can't be undone.")) onDelete(); }}
        title="Delete"
        style={btn}
        className="rounded-full p-1 hover:text-red-600"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Generic list section (CRUD)                                            */
/* ---------------------------------------------------------------------- */
function ListSection({ icon, title, subtitle, schema, items, setItems, storageKey, onPersist, renderCard, addLabel = "Add entry", enableImportExport = false, exportFileName, renderForm, onRemoveItem, filter, extraFilter, toolbar, filterKey = "", pageSize = 0, emptyFilteredText }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited
  // Optional filter chips, e.g. filter={{ key: "category", options: [...], summary: (shown) => ... }}
  const [filterVal, setFilterVal] = useState("All");
  const baseItems = extraFilter ? items.filter(extraFilter) : items; // e.g. Progress date/stage search
  const shownItems = filter && filterVal !== "All" ? baseItems.filter((i) => i[filter.key] === filterVal) : baseItems;
  // Long lists show a page at a time (keeps phones fast after months of entries).
  const [limit, setLimit] = useState(pageSize || Infinity);
  useEffect(() => { setLimit(pageSize || Infinity); }, [filterKey, pageSize]);
  const pagedItems = shownItems.slice(0, limit);
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
  // Replace one item in place (keeps its id and any fields the form doesn't show).
  const updateItem = async (id, patch) => {
    const next = items.map((i) => (i.id === id ? { ...i, ...patch, id } : i));
    setItems(next);
    setEditing(null);
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
      {filter && items.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex flex-wrap gap-2">
            {["All", ...filter.options].map((opt) => {
              const n = opt === "All" ? items.length : items.filter((i) => i[filter.key] === opt).length;
              if (opt !== "All" && n === 0 && filterVal !== opt) return null;
              const active = filterVal === opt;
              return (
                <button
                  key={opt}
                  onClick={() => setFilterVal(opt)}
                  style={{
                    background: active ? C.navy : C.card,
                    color: active ? "#fff" : C.ink,
                    border: `1px solid ${active ? C.navy : C.line}`,
                    transition: "background 150ms, color 150ms",
                  }}
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                >
                  {opt} <span style={{ fontFamily: "'IBM Plex Mono', monospace", opacity: 0.75 }}>{n}</span>
                </button>
              );
            })}
          </div>
          {filter.summary && <div className="text-sm">{filter.summary(shownItems, filterVal)}</div>}
        </div>
      )}
      {toolbar}
      {items.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">
          Nothing logged yet. Add your first entry.
        </p>
      )}
      {items.length > 0 && shownItems.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">{emptyFilteredText || "Nothing matches this filter."}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {pagedItems.map((item) => (
          <div
            key={item.id}
            style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)", transition: "box-shadow 150ms, transform 150ms" }}
            className="rounded-lg p-4 relative hover:shadow-md hover:-translate-y-0.5"
          >
            <CardActions onEdit={() => setEditing(item)} onDelete={() => remove(item.id)} />
            {renderCard(item)}
          </div>
        ))}
      </div>
      {shownItems.length > pagedItems.length && (
        <div className="mt-4 flex justify-center">
          <Btn tone="ghost" small onClick={() => setLimit((l) => l + (pageSize || 20))}>
            Show more ({shownItems.length - pagedItems.length} older)
          </Btn>
        </div>
      )}
      {open && (
        <Modal title={addLabel} onClose={() => setOpen(false)}>
          {renderForm ? renderForm({ addItem, close: () => setOpen(false) }) : <SchemaForm schema={schema} onSubmit={add} />}
        </Modal>
      )}
      {editing && (
        <Modal title="Edit entry" onClose={() => setEditing(null)}>
          {renderForm
            ? renderForm({ initial: editing, updateItem, close: () => setEditing(null) })
            : <SchemaForm schema={schema} initial={editing} submitLabel="Save changes" onSubmit={(vals) => updateItem(editing.id, vals)} />}
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dashboard                                                               */
/* ---------------------------------------------------------------------- */
// ---- Project timeline: start date, days passed, days worked, agreed duration.
function computeTimeline(meta, progress, agreement) {
  const t = meta?.timeline || {};
  const dated = progress.filter((p) => p.date).map((p) => p.date).sort();
  const demo = progress.filter((p) => p.stage === "Demolition" && p.date).map((p) => p.date).sort();
  const autoStart = demo[0] || dated[0] || "";
  const start = t.startDate || autoStart;
  const startSource = t.startDate ? "set by you" : demo[0] ? "first Demolition entry" : dated[0] ? "first log entry" : "";
  const workedDates = new Set(progress.filter((p) => p.date && (!start || p.date >= start) && p.workersCount !== "0").map((p) => p.date));
  const autoWorked = workedDates.size;
  const worked = t.workingDays !== undefined && t.workingDays !== "" && t.workingDays !== null ? Number(t.workingDays) : autoWorked;
  const agreedText = agreement?.builder?.completionPeriod || "";
  const autoEstimate = periodToDays(agreedText);
  const estimate = t.estimatedDays ? Number(t.estimatedDays) : autoEstimate;
  const estimateSource = t.estimatedDays ? "set by you" : autoEstimate ? `agreement: “${agreedText}”` : "";
  const todayD = localDay(today());
  const startD = start ? localDay(start) : null;
  const passed = startD ? Math.max(0, Math.round((todayD - startD) / 86400000) + 1) : null;
  const due = startD && estimate ? new Date(startD.getTime() + estimate * 86400000) : null;
  const remaining = due ? Math.round((due - todayD) / 86400000) : null;
  return { start, startSource, autoStart, passed, worked, workedAuto: t.workingDays === undefined || t.workingDays === "" || t.workingDays === null, autoWorked, estimate, estimateSource, due, remaining };
}

function TimelineCard({ meta, setMeta, progress, agreement }) {
  const [editing, setEditing] = useState(false);
  const tl = computeTimeline(meta, progress, agreement);
  const t = meta.timeline || {};
  const [draft, setDraft] = useState({});
  const aiPct = meta.planReview?.progressPct;
  const timePct = tl.estimate && tl.passed ? Math.min(100, Math.round((tl.passed / tl.estimate) * 100)) : null;
  const fmt = (d) => (!d ? "—" : typeof d === "string" ? fmtDay(d) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
  const save = async () => {
    const next = { ...meta, timeline: { startDate: draft.startDate || "", estimatedDays: draft.estimatedDays || "", workingDays: draft.workingDays === "" ? "" : draft.workingDays } };
    setMeta(next);
    await saveKey("meta", next);
    setEditing(false);
  };
  const cell = (label, value, sub) => (
    <div>
      <div style={{ color: C.concrete }} className="text-[11px] uppercase font-semibold tracking-wide">{label}</div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }} className="text-xl font-semibold">{value}</div>
      {sub && <div style={{ color: C.concrete }} className="text-[11px]">{sub}</div>}
    </div>
  );
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-8">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide flex items-center gap-2">
          <CalendarDays size={15} /> Project timeline
        </h3>
        <button onClick={() => { setDraft({ startDate: t.startDate || "", estimatedDays: t.estimatedDays || "", workingDays: t.workingDays ?? "" }); setEditing(true); }} style={{ color: C.navy }} className="text-xs underline flex items-center gap-1">
          <Pencil size={12} /> Edit
        </button>
      </div>
      {!tl.start ? (
        <p style={{ color: C.concrete }} className="text-xs">No start date yet — it's picked automatically from the first Demolition log entry (or the first entry), or tap Edit to set it.</p>
      ) : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {cell("Started", fmt(tl.start), tl.startSource)}
          {cell("Days since start", tl.passed ?? "—", "calendar days")}
          {cell("Days worked on site", tl.worked, tl.workedAuto ? "days with a log entry" : "set by you")}
          {cell("Agreed duration", tl.estimate ? `${tl.estimate} d` : "—", tl.estimate ? tl.estimateSource : "tap Edit, or read it from the agreement (Budget → Builder details)")}
        </div>
      )}
      {tl.start && tl.estimate && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1 flex-wrap gap-2" style={{ color: C.concrete }}>
            <span>Expected completion: <b style={{ color: C.ink }}>{fmt(tl.due)}</b> {tl.remaining >= 0 ? `· ${tl.remaining} days left` : `· ${-tl.remaining} days overdue`}</span>
            {timePct !== null && <span>Time used <b style={{ color: C.ink }}>{timePct}%</b>{aiPct !== null && aiPct !== undefined ? <> · work done <b style={{ color: C.ink }}>{aiPct}%</b> (AI)</> : null}</span>}
          </div>
          <div style={{ background: C.paperDark, height: 8 }} className="rounded-full overflow-hidden relative">
            <div style={{ width: `${timePct || 0}%`, background: C.navyLight, height: "100%" }} />
            {aiPct !== null && aiPct !== undefined && <div style={{ position: "absolute", top: 0, left: 0, width: `${aiPct}%`, height: "100%", background: aiPct + 5 < (timePct || 0) ? C.rust : C.green, opacity: 0.85 }} />}
          </div>
          {aiPct !== null && aiPct !== undefined && timePct !== null && (
            <p className="text-xs mt-1" style={{ color: aiPct + 5 < timePct ? C.rust : C.green }}>
              {aiPct + 5 < timePct ? "Work is behind the time used — worth asking the builder about the schedule." : "Work is keeping pace with the time used."}
            </p>
          )}
        </div>
      )}
      {editing && (
        <Modal title="Project timeline" onClose={() => setEditing(false)}>
          <p style={{ color: C.concrete }} className="text-xs mb-3">Leave a box empty to let the app work it out automatically.</p>
          <Field label={`Start date${tl.autoStart ? ` (auto: ${tl.autoStart})` : ""}`}>
            <input style={inputStyle} type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </Field>
          <Field label={`Agreed duration in days${tl.estimateSource && !t.estimatedDays ? ` (auto: ${tl.estimate} from ${tl.estimateSource})` : ""}`}>
            <input style={inputStyle} type="number" min="1" placeholder="e.g. 425 (14 months ≈ 426 days)" value={draft.estimatedDays} onChange={(e) => setDraft({ ...draft, estimatedDays: e.target.value })} />
          </Field>
          <Field label={`Days worked on site (auto: ${tl.autoWorked})`}>
            <input style={inputStyle} type="number" min="0" placeholder="Leave empty to count from the log" value={draft.workingDays} onChange={(e) => setDraft({ ...draft, workingDays: e.target.value })} />
          </Field>
          <Btn onClick={save}><CheckCircle2 size={15} /> Save</Btn>
        </Modal>
      )}
    </div>
  );
}

function Dashboard({ data, setTab, currentUser, autoCheck = "", setMeta }) {
  const { progress, expenses, permissions, contacts, products, documents, issues, gallery, meta, loan, agreement } = data;

  const spentOnExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const spentOnPermissions = permissions.reduce((s, p) => s + Number(p.cost || 0), 0);
  const totalSpent = spentOnExpenses + spentOnPermissions;
  const allocated = Number(meta.budgetAllocated || 0);
  const remaining = allocated - totalSpent;
  const redFlags = progress.filter((p) => p.flag === "Red Flag").length;
  const openIssues = issues.filter((i) => i.status !== "Resolved").length;
  const latestStage = progress[0]?.stage || "Not started";

  const stageOrder = getStages(meta).filter((s) => s !== "Other");
  const loggedStages = new Set(progress.map((p) => p.stage));
  const completedStages = new Set(stageOrder.filter((s) => stageState(meta, s, loggedStages).done));

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
        title={currentUser?.projectName || meta.projectName || "Construction AI Ledger"}
        subtitle={[currentUser?.projectType, currentUser?.projectPlace].filter(Boolean).join(" · ") || "Construction dashboard"}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stat("Total spent", fmtINR(totalSpent), C.rust, IndianRupee)}
        {stat("Budget remaining", fmtINR(remaining), remaining < 0 ? C.red : C.green, Wallet)}
        {stat("Current stage", latestStage, C.navy, Hammer)}
        {stat("Open red flags", redFlags, redFlags ? C.red : C.green, AlertTriangle)}
      </div>

      <TimelineCard meta={meta} setMeta={setMeta} progress={progress} agreement={agreement} />

      {/* AI progress assessment — from the latest plan cross-check (manual or weekly) */}
      {(meta.planReview || autoCheck || meta.planSchedule) && (() => {
        const r = meta.planReview;
        const vs = r ? VERDICT_STYLE[r.verdict] || VERDICT_STYLE.Watch : null;
        return (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `4px solid ${vs ? vs.color : C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-8">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide flex items-center gap-2">
                <Sparkles size={15} /> AI progress assessment
              </h3>
              <div className="flex items-center gap-2">
                {r && <Stamp tone={vs.tone}>{r.verdict}</Stamp>}
                <button onClick={() => setTab("progress")} style={{ color: C.navy }} className="text-xs underline">Full report</button>
              </div>
            </div>
            {autoCheck === "running" && (
              <p style={{ color: C.concrete }} className="text-xs mb-2 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Weekly plan check is running in the background…</p>
            )}
            {autoCheck && autoCheck !== "running" && <p style={{ color: C.yellow }} className="text-xs mb-2">{autoCheck}</p>}
            {r ? (
              <div className="grid gap-4 md:grid-cols-3 items-center">
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }} className="text-3xl font-semibold">
                    {r.progressPct !== null && r.progressPct !== undefined ? `${r.progressPct}%` : "—"}
                  </div>
                  <div style={{ color: C.concrete }} className="text-xs mb-1.5">of the house built · AI estimate</div>
                  <div style={{ background: C.paperDark, height: 8 }} className="rounded-full overflow-hidden">
                    <div style={{ width: `${r.progressPct || 0}%`, background: vs.color, height: "100%" }} />
                  </div>
                </div>
                <div className="md:col-span-2">
                  {(r.currentStage || r.nextMilestone) && (
                    <div className="flex gap-4 flex-wrap text-xs mb-1.5" style={{ color: C.concrete }}>
                      {r.currentStage && <span>Now at: <b style={{ color: C.ink }}>{r.currentStage}</b></span>}
                      {r.nextMilestone && <span>Next: <b style={{ color: C.ink }}>{r.nextMilestone}</b></span>}
                    </div>
                  )}
                  {r.summary && <p style={{ color: C.ink }} className="text-sm">{r.summary}</p>}
                  <p style={{ color: C.concrete }} className="text-xs mt-1.5">
                    Checked {new Date(r.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{r.scheduled ? " (weekly auto-check)" : ""}
                    {meta.planSchedule ? ` · next auto-check: ${nextPlanCheckLabel(meta)}` : ""}
                  </p>
                </div>
              </div>
            ) : (
              !autoCheck && <p style={{ color: C.concrete }} className="text-xs">The first weekly check will appear here once it runs.</p>
            )}
          </div>
        );
      })()}

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
            Sanctioned {fmtINR(loan.sanctioned)} · Disbursed {fmtINR(loanDisbursed(loan))}
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
async function reviewProgressEntry(entry, photos, { recent = [], planText = "", completedStages = [], stages = STAGES } = {}) {
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
REASON: one or two short sentences a homeowner can understand. If NONE, say briefly what looks fine.
COMPLETED: stages this entry clearly says or shows are now FINISHED, comma-separated, chosen only from: ${stages.filter((x) => x !== "Other").join(", ")} — or NONE. Only list a stage if the notes say the WHOLE stage is completed/finished/done or the photos clearly show it finished. Ongoing work, a single activity within a stage (e.g. PCC, marking), or temporary works (labour shed, temporary power) do not count.`;
  const out = await askClaude({ text, images: imgs });
  const m = out.match(/FLAG:\s*(RED\s*FLAG|WATCH|NONE)/i);
  const r = out.match(/REASON:\s*([\s\S]+?)(?:\n\s*COMPLETED:|$)/i);
  const cm = out.match(/COMPLETED:\s*(.+)/i);
  const completed = cm && !/^none/i.test(cm[1].trim())
    ? cm[1].split(/[,;]/).map((x) => x.trim()).map((x) => stages.find((st) => st.toLowerCase() === x.toLowerCase())).filter((x) => x && x !== "Other")
    : [];
  const word = m ? m[1].toUpperCase().replace(/\s+/g, " ") : "WATCH";
  const flag = word === "RED FLAG" ? "Red Flag" : word === "WATCH" ? "Watch" : "None";
  return { flag, reason: (r ? r[1] : out).trim().slice(0, 400), completed };
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

function ProgressEntryForm({ onSave, initial, stages = STAGES }) {
  const [vals, setVals] = useState({
    date: initial?.date || today(),
    stage: initial?.stage || "",
    workersCount: initial?.workersCount || "",
    description: initial?.description || "",
  });
  const [photos, setPhotos] = useState({ start: null, end: null });
  const [loadingPhotos, setLoadingPhotos] = useState(!!initial?.photoSlots?.length);
  useEffect(() => {
    if (!initial?.photoSlots?.length) return;
    loadKey(progressPhotoKey(initial.id), null).then((p) => {
      setPhotos({ start: p?.start || null, end: p?.end || null });
      setLoadingPhotos(false);
    });
  }, [initial?.id]);
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
          {stages.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Workers on site">
        <input style={inputStyle} type="number" min="0" value={vals.workersCount} onChange={(e) => set("workersCount", e.target.value)} />
      </Field>
      <Field label="What happened today">
        <textarea style={{ ...inputStyle, minHeight: "70px" }} value={vals.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Site photos (optional)">
        {loadingPhotos ? (
          <p style={{ color: C.concrete }} className="text-xs flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading photos…</p>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          {PHOTO_SLOTS.map((slot) => (
            <PhotoPicker key={slot.key} label={slot.label} value={photos[slot.key]} onChange={(v) => setPhotos((p) => ({ ...p, [slot.key]: v }))} />
          ))}
        </div>
        )}
      </Field>
      <p style={{ color: C.concrete }} className="text-xs mb-3 flex items-center gap-1.5">
        <Sparkles size={12} /> After you save, AI {initial ? "re-reviews" : "reviews"} the entry and photos and flags anything worth your attention.
      </p>
      <Btn type="submit" disabled={saving || loadingPhotos}>
        {saving && <Loader2 size={15} className="animate-spin" />} {initial ? "Save changes" : "Save"}
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
  const hasPhotos = (entry.photoSlots && entry.photoSlots.length > 0) || entry.extraCount > 0;
  const [showAll, setShowAll] = useState(false);

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
            {slots.length === 0 && entry.extraCount > 0 && (
              <button type="button" onClick={() => setShowAll(true)} className="relative block" style={{ height: 190 }}>
                {photos?.extra?.[0] ? (
                  <img src={`data:image/jpeg;base64,${photos.extra[0]}`} alt="Site photo" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Loader2 size={18} className="animate-spin" style={{ color: C.concrete }} /></div>
                )}
              </button>
            )}
          </div>
          {entry.extraCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
              className="absolute bottom-2 right-2 text-[11px] font-semibold px-2 py-1 rounded flex items-center gap-1"
            >
              <Camera size={12} /> +{entry.extraCount} more
            </button>
          )}
          {/* Stage + what happened, laid over the top of the photos */}
          <div
            style={{ background: "linear-gradient(180deg, rgba(10,20,32,0.85) 0%, rgba(10,20,32,0.55) 65%, transparent 100%)", pointerEvents: "none" }}
            className="absolute top-0 left-0 right-0 px-3 pt-2.5 pb-6 text-white"
          >
            <div style={{ fontFamily: "'Oswald', sans-serif" }} className="font-semibold uppercase text-sm tracking-wide pr-16">{entry.stage}</div>
            {entry.description && (
              <p className="text-xs leading-snug pr-16" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {entry.description}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-1 pr-16">
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{entry.date}</span>
        {entry.source === "whatsapp" && <span style={{ color: C.green, border: `1px solid ${C.green}` }} className="text-[10px] font-semibold rounded px-1.5 py-0.5">via WhatsApp</span>}
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
      {entry.reportedBy && <div style={{ color: C.concrete }} className="text-xs mt-1">Reported by {entry.reportedBy}</div>}
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
      {showAll && (
        <Modal title={`${entry.date} — ${entry.stage}`} onClose={() => setShowAll(false)} size="large">
          <p style={{ color: C.concrete }} className="text-xs mb-3">The photos AI picked as useful for this day. Tap one to open it full size.</p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
            {[
              ...PHOTO_SLOTS.filter((sl) => photos?.[sl.key]).map((sl) => ({ label: sl.label, data: photos[sl.key] })),
              ...(photos?.extra || []).map((d, k) => ({ label: `Photo ${k + 1}`, data: d })),
            ].map((ph, k) => (
              <button key={k} type="button" onClick={() => setPreview({ name: `${entry.date} — ${entry.stage} — ${ph.label}`, mimeType: "image/jpeg", data: ph.data })} className="relative block">
                <img src={`data:image/jpeg;base64,${ph.data}`} alt={ph.label} className="w-full rounded object-cover" style={{ height: 160 }} />
                <span style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }} className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded">{ph.label}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Big PDFs (scanned or high-detail drawings) can be several MB — too large
// to send in one request. Render the first pages to sharp JPEGs instead,
// which the AI reads just as well and are a fraction of the size.
async function pdfToImages(b64, { maxPages = 4, width = 1800, quality = 0.8 } = {}) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
  }
  return { images: out, totalPages: doc.numPages };
}

// Re-compress an already-stored base64 image to a smaller size.
function shrinkBase64Image(b64, maxWidth = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => resolve(b64);
    img.src = `data:image/jpeg;base64,${b64}`;
  });
}

// Turns the AI's fixed-format reply into { verdict, summary, sections[] }.
function parsePlanReport(out) {
  const text = (out || "").replace(/\*\*/g, "");
  const v = text.match(/VERDICT:\s*(RED\s*FLAG|WATCH|ON\s*TRACK)/i);
  const word = v ? v[1].toUpperCase().replace(/\s+/g, " ") : "WATCH";
  const verdict = word === "RED FLAG" ? "Red Flag" : word === "ON TRACK" ? "On Track" : "Watch";
  const sm = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n[A-Z][A-Z &'\/]+:|$)/);
  const headings = ["MATCHES PLAN", "DOESN'T MATCH / BEHIND", "SAFETY & QUALITY", "ASK THE BUILDER"];
  const sections = [];
  headings.forEach((h, i) => {
    const startIdx = text.toUpperCase().indexOf(h + ":");
    if (startIdx < 0) return;
    let endIdx = text.length;
    headings.slice(i + 1).forEach((n) => {
      const j = text.toUpperCase().indexOf(n + ":", startIdx + 1);
      if (j > -1 && j < endIdx) endIdx = j;
    });
    const points = text
      .slice(startIdx + h.length + 1, endIdx)
      .split("\n")
      .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
      .filter((l) => l && !/^nothing noted\.?$/i.test(l));
    sections.push({ title: h, points });
  });
  const pg = text.match(/PROGRESS:\s*(\d{1,3})/i);
  const cs = text.match(/CURRENT STAGE:\s*(.+)/i);
  const nm = text.match(/NEXT MILESTONE:\s*(.+)/i);
  return {
    verdict,
    progressPct: pg ? Math.max(0, Math.min(100, Number(pg[1]))) : null,
    currentStage: cs ? cs[1].trim() : "",
    nextMilestone: nm ? nm[1].trim() : "",
    summary: sm ? sm[1].trim() : "",
    sections,
    // If the AI ignored the format, keep the raw text so nothing is lost.
    raw: sections.length ? "" : text.trim(),
  };
}

const VERDICT_STYLE = {
  "Red Flag": { tone: "red", color: C.red },
  Watch: { tone: "yellow", color: C.yellow },
  "On Track": { tone: "green", color: C.green },
};
const SECTION_COLOR = {
  "MATCHES PLAN": C.green,
  "DOESN'T MATCH / BEHIND": C.red,
  "SAFETY & QUALITY": C.yellow,
  "ASK THE BUILDER": C.navy,
};

function PlanReport({ report }) {
  const vs = VERDICT_STYLE[report.verdict] || VERDICT_STYLE.Watch;
  const when = report.checkedAt ? new Date(report.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${vs.color}` }} className="mt-4 rounded-md p-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <Stamp tone={vs.tone}>{report.verdict}</Stamp>
        <span style={{ color: C.concrete }} className="text-xs">
          Checked {when} · {report.entryCount} log {report.entryCount === 1 ? "entry" : "entries"} · {report.photoCount} photos reviewed
        </span>
      </div>
      {report.progressPct !== null && report.progressPct !== undefined && (
        <div className="mb-3">
          <div className="flex items-baseline gap-2 flex-wrap text-xs mb-1" style={{ color: C.concrete }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }} className="text-base font-semibold">{report.progressPct}%</span>
            <span>built (AI estimate)</span>
            {report.currentStage && <span>· now at: <b style={{ color: C.ink }}>{report.currentStage}</b></span>}
            {report.nextMilestone && <span>· next: <b style={{ color: C.ink }}>{report.nextMilestone}</b></span>}
          </div>
          <div style={{ background: C.paperDark, height: 6 }} className="rounded-full overflow-hidden">
            <div style={{ width: `${report.progressPct}%`, background: vs.color, height: "100%" }} />
          </div>
        </div>
      )}
      {report.summary && (
        <p style={{ color: C.ink }} className="text-sm mb-3 flex gap-1.5">
          <Sparkles size={14} className="shrink-0 mt-0.5" /> <span>{report.summary}</span>
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {report.sections.map((sec) => (
          <div key={sec.title}>
            <div style={{ color: SECTION_COLOR[sec.title] || C.ink, fontFamily: "'Oswald', sans-serif" }} className="uppercase text-xs font-semibold tracking-wide mb-1">
              {sec.title}
            </div>
            {sec.points.length ? (
              <ul className="space-y-1">
                {sec.points.map((pt, i) => (
                  <li key={i} style={{ color: C.ink, borderLeft: `2px solid ${SECTION_COLOR[sec.title] || C.line}` }} className="text-xs pl-2">{pt}</li>
                ))}
              </ul>
            ) : (
              <p style={{ color: C.concrete }} className="text-xs italic">Nothing noted</p>
            )}
          </div>
        ))}
      </div>
      {report.raw && <p style={{ color: C.ink, whiteSpace: "pre-wrap" }} className="text-sm">{report.raw}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Import daily progress from a WhatsApp group export                      */
/* ---------------------------------------------------------------------- */
const blobToBase64Jpeg = (blob, maxWidth, quality) => compressImage(blob, maxWidth, quality);

// Match a WhatsApp sender (a saved name, a "~pushname", or a phone number)
// to someone in the People tab — by phone number first, then by name.
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
function matchContact(sender, contacts) {
  const digits = last10(sender);
  if (digits.length === 10) {
    const byPhone = contacts.find((c) => last10(c.phone) === digits);
    if (byPhone) return byPhone;
  }
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const sw = words(sender);
  if (!sw.length) return null;
  return (
    contacts.find((c) => {
      const cw = words(c.name);
      if (!cw.length) return false;
      const [short, long] = sw.length <= cw.length ? [sw, cw] : [cw, sw];
      return short.every((w) => long.includes(w));
    }) || null
  );
}
const senderLabel = (sender, contacts) => {
  const c = matchContact(sender, contacts);
  return c ? `${c.name} (${c.role})` : sender;
};

const MAX_KEEP_EXTRA = 4; // besides start + end, keep at most this many "useful" photos per day
const MAX_THUMBS = 16;    // how many photos per day the AI looks at

// Pick which of a day's photos the AI should look at: all of them if there
// are few, otherwise an even spread that always includes the first and last.
function sampleEvenly(list, n) {
  if (list.length <= n) return list.map((x, i) => i);
  const out = new Set([0, list.length - 1]);
  for (let k = 1; out.size < n; k++) out.add(Math.round((k * (list.length - 1)) / (n - 1)));
  return [...out].sort((a, b) => a - b).slice(0, n);
}

async function summariseWhatsAppDay(day, thumbs, contacts = [], stages = STAGES) {
  // thumbs: [{ data, time, sender }] — small numbered previews of the day's photos
  const chat = day.messages
    .map((m) => `${m.time} ${senderLabel(m.sender, contacts)}: ${m.text || (m.photos.length ? `[${m.photos.length} photo${m.photos.length > 1 ? "s" : ""}]` : "")}`)
    .join("\n")
    .slice(0, 5000);
  const photoList = thumbs.map((t, i) => `Photo ${i + 1}: sent ${t.time} by ${senderLabel(t.sender, contacts)}`).join("\n");
  const text = `These are one day's messages (${day.date}) from a WhatsApp group for a house construction site in Bangalore, India (homeowner, builder, site engineer). Where known, each sender's role is shown in brackets — give more weight to the site engineer's and builder's updates.

Messages:
${chat}

${thumbs.length ? `${thumbs.length} photo(s) from the day are attached in this order:\n${photoList}` : "No photos."}

Turn this into ONE daily progress log entry AND choose which photos are worth keeping. Reply with ONLY a JSON object:
{"relevant": true/false, "stage": "...", "description": "...", "workersCount": "", "completed": [], "start": null, "end": null, "keep": [], "skipped": ""}
- "relevant": false if the day has no real site progress (just greetings, "ok", payments chat etc.).
- "stage": exactly one of: ${stages.join(", ")}.
- "description": 1-3 short sentences on what work happened and any instructions or issues raised (e.g. "Builder asked for caution tape"). Plain English, no names needed.
- "workersCount": total people working on site if stated — add up all trades (e.g. "Workers : 4 nos" → "4"; "Mason: 1, Helper: 1, Digital surveyor: 2" → "4") — or clearly countable in photos, else "".
- "completed": stages the messages clearly say are FINISHED that day (e.g. "Excavation work completed" → ["Excavation"]), chosen only from the stage list; [] if none. Rules: ongoing work does not count; one activity inside a stage does not finish the whole stage (e.g. "PCC completed" or "footing marking done" do NOT finish Foundation); temporary works (labour shed, site office, temporary power/meter, water tank) never count as a house stage.
- The site engineer often posts a "DAILY WORK REPORT" with Date, Workers and a numbered Work list — treat that as the main source for the day.
- "start": the photo number that best shows the site at the START of the day's work (usually an early photo), or null if no useful photo.
- "end": the photo number that best shows the RESULT at the end of the day (usually a late photo, different from start), or null if only one useful photo.
- "keep": up to ${MAX_KEEP_EXTRA} OTHER photo numbers that add real information — a different area of work, a close-up of workmanship or material brands, a safety or quality problem, a delivery. Leave it empty if nothing adds value.
- Do NOT pick: near-duplicates of an already-chosen photo, blurry/dark/accidental shots, selfies or people posing, screenshots, forwarded images, memes, or photos of unrelated places.
- "skipped": a very short reason for the ones you left out, e.g. "6 near-duplicates, 1 blurry".`;
  const out = await askClaude({ text, images: thumbs.map((t) => ({ data: t.data, mimeType: "image/jpeg" })) });
  const r = parseJsonLoose(out);
  const valid = (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= thumbs.length ? Number(n) - 1 : null;
  const start = valid(r.start);
  let end = valid(r.end);
  if (end === start) end = null;
  const keep = [...new Set((Array.isArray(r.keep) ? r.keep : []).map(valid).filter((x) => x !== null && x !== start && x !== end))].slice(0, MAX_KEEP_EXTRA);
  return {
    relevant: r.relevant !== false,
    stage: stages.includes(r.stage) ? r.stage : "Other",
    description: String(r.description || "").trim(),
    workersCount: r.workersCount ? String(r.workersCount).replace(/[^0-9]/g, "") : "",
    completed: (Array.isArray(r.completed) ? r.completed : []).map((x) => stages.find((st) => st.toLowerCase() === String(x).toLowerCase())).filter((x) => x && x !== "Other"),
    pick: { start, end, keep },
    skipped: String(r.skipped || "").trim(),
  };
}

// Guess a document type from its file name (you can change it before importing).
function guessDocType(name) {
  const n = name.toLowerCase();
  if (/agreement|contract|mou/.test(n)) return "Agreement";
  if (/plan|drawing|elevation|layout|design|section|schedule|marking|footing|column|beam|slab|\.dwg$|structural|3d/.test(n)) return "Design";
  if (/receipt|paid|payment/.test(n)) return "Receipt";
  if (/bill|invoice|quotation|quote|estimate|boq/.test(n)) return "Bill";
  return "Other";
}
const DOC_SIZE_LIMIT = 8 * 1024 * 1024; // bigger files are skipped (too large to store here)

function WhatsAppImport({ progress, onImport, contacts = [], setContacts, stages = STAGES, documents = [], lastImport, onUndo }) {
  const fileRef = useRef();
  const stopRef = useRef(false);
  const [step, setStep] = useState(null); // null | "choose" | "reading" | "review"
  const [error, setError] = useState("");
  const [data, setData] = useState(null); // { days, senders, getPhoto, getFile, hasMedia, docs }
  const [pickedDocs, setPickedDocs] = useState({}); // name -> { include, type, title }
  const [sourceFile, setSourceFile] = useState(null);
  const tz = deviceTimeZone();
  const needsTz = tz && tz !== SITE_TIME_ZONE;
  const [toIndiaTime, setToIndiaTime] = useState(true);
  const [pickedSenders, setPickedSenders] = useState({});
  const [pickedDays, setPickedDays] = useState({});
  const [status, setStatus] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [runChecks, setRunChecks] = useState(true);
  const [importing, setImporting] = useState(false);

  const importedDates = new Set(progress.filter((p) => p.source === "whatsapp").map((p) => p.date));
  const close = () => { stopRef.current = true; setStep(null); setData(null); setDrafts([]); setError(""); };

  const onPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setSourceFile(file);
    await loadExport(file, toIndiaTime);
  };
  const loadExport = async (file, convert) => {
    setError("");
    try {
      const res = await readWhatsAppExport(file, { convertToSiteTime: convert });
      if (!res.messages.length) throw new Error("No messages found in that file.");
      const days = groupByDay(res.messages);
      const counts = {};
      res.messages.forEach((m) => { counts[m.sender] = (counts[m.sender] || 0) + 1; });
      const senders = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const existingNames = new Set(documents.map((d) => cleanDocName(d.attachment?.name).toLowerCase()).filter(Boolean));
      const docs = listDocuments(res.messages).map((d) => ({
        ...d,
        inZip: res.hasFile ? res.hasFile(d.name) : false,
        size: res.fileSize ? res.fileSize(d.name) : 0,
        already: existingNames.has(d.clean.toLowerCase()),
      }));
      setPickedDocs(Object.fromEntries(docs.map((d) => [d.name, {
        include: d.inZip && !d.already && !(d.size > DOC_SIZE_LIMIT),
        type: guessDocType(d.clean),
        title: d.clean.replace(/\.[a-z0-9]+$/i, ""),
      }])));
      setData({ days, senders, getPhoto: res.getPhoto, getFile: res.getFile, hasMedia: res.hasMedia, docs });
      setPickedSenders(Object.fromEntries(senders.map(([n]) => [n, true])));
      setPickedDays(Object.fromEntries(days.map((d) => [d.date, !importedDates.has(d.date)])));
      setStep("choose");
    } catch (err) {
      console.error("[SiteLedger] WhatsApp import failed", err);
      setError(err.message || "Couldn't read that file.");
    }
  };

  // Quick-add an unknown sender to People so they're recognised next time.
  const addSenderToPeople = async (sender, role) => {
    if (!role || !setContacts) return;
    const isNumber = last10(sender).length === 10 && !/[a-z]/i.test(sender);
    const next = [{ id: uid(), role, name: sender, phone: isNumber ? sender : "", notes: isNumber ? "Added from WhatsApp import — edit to add their name" : "Added from WhatsApp import" }, ...contacts];
    setContacts(next);
    await saveKey("contacts", next);
  };

  const daysForSenders = () =>
    (data?.days || [])
      .map((d) => ({ ...d, messages: d.messages.filter((m) => pickedSenders[m.sender]) }))
      .filter((d) => d.messages.length);

  const readDays = async () => {
    const days = daysForSenders().filter((d) => pickedDays[d.date]);
    if (!days.length) return;
    stopRef.current = false;
    setStep("reading");
    const out = [];
    for (let i = 0; i < days.length; i++) {
      if (stopRef.current) break;
      const day = days[i];
      setStatus(`Reading ${day.date} (${i + 1} of ${days.length})…`);
      // All photos posted that day, with who sent them and when.
      const all = day.messages.flatMap((m) => m.photos.map((name) => ({ name, time: m.time, sender: m.sender })));
      const sampled = sampleEvenly(all, MAX_THUMBS).map((idx) => all[idx]);
      const thumbs = [];
      for (const ph of sampled) {
        const blob = await data.getPhoto(ph.name);
        if (blob) thumbs.push({ ...ph, data: await blobToBase64Jpeg(blob, 480, 0.6) });
      }
      if (thumbs.length) setStatus(`Reading ${day.date} (${i + 1} of ${days.length}) — AI is sorting ${all.length} photo${all.length > 1 ? "s" : ""}…`);
      let summary;
      try {
        summary = await summariseWhatsAppDay(day, thumbs, contacts, stages);
      } catch (err) {
        const busy = /high demand|overloaded|try again later|\(429\)|\(503\)/i.test(err?.message || "");
        summary = {
          relevant: true, stage: "Other",
          description: day.messages.map((m) => m.text).filter(Boolean).join(" · ").slice(0, 300), workersCount: "",
          pick: { start: thumbs.length ? 0 : null, end: thumbs.length > 1 ? thumbs.length - 1 : null, keep: [] }, // fall back to first + last
          failed: busy ? "AI busy — filled from the raw messages, first and last photo kept" : "AI couldn't read this day — filled from the raw messages, first and last photo kept",
        };
      }
      // Load full-size versions of just the photos worth keeping.
      const photos = { extra: [] };
      const full = async (idx) => {
        const blob = idx === null || idx === undefined ? null : await data.getPhoto(thumbs[idx].name);
        return blob ? blobToBase64Jpeg(blob, 1200, 0.72) : null;
      };
      const st = await full(summary.pick.start);
      const en = await full(summary.pick.end);
      if (st) photos.start = st;
      if (en) photos.end = en;
      for (const k of summary.pick.keep) { const d = await full(k); if (d) photos.extra.push(d); }
      const keptCount = (st ? 1 : 0) + (en ? 1 : 0) + photos.extra.length;
      summary.photoNote = all.length ? `${all.length} photo${all.length > 1 ? "s" : ""} → kept ${keptCount}${summary.skipped ? ` (skipped: ${summary.skipped})` : all.length > keptCount ? ` (${all.length - keptCount} skipped)` : ""}${all.length > thumbs.length ? ` · AI looked at ${thumbs.length}` : ""}` : "";
      const reporters = [...new Set(day.messages.map((m) => senderLabel(m.sender, contacts)))];
      out.push({ date: day.date, ...summary, photos, include: summary.relevant, messageCount: day.messages.length, reportedBy: reporters.join(", ") });
      setDrafts([...out]);
      await new Promise((r) => setTimeout(r, 800)); // be gentle with the free AI quota
    }
    setStep("review");
  };

  const selectedDocs = () => (data?.docs || []).filter((d) => pickedDocs[d.name]?.include);
  const readDocs = async () => {
    const out = [];
    for (const d of selectedDocs()) {
      const blob = await data.getFile(d.name);
      if (!blob) continue;
      const b64 = await fileToBase64(blob);
      out.push({ ...d, ...pickedDocs[d.name], attachment: { name: d.clean, mimeType: blob.type, data: b64 } });
    }
    return out;
  };
  const doImport = async () => {
    setImporting(true);
    const docs = await readDocs();
    await onImport(drafts.filter((d) => d.include), runChecks, docs);
    setImporting(false);
    close();
  };
  const importDocsOnly = async () => {
    setImporting(true);
    const docs = await readDocs();
    await onImport([], false, docs);
    setImporting(false);
    close();
  };

  const setDraft = (idx, patch) => setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const visibleDays = daysForSenders();
  const selectedCount = visibleDays.filter((d) => pickedDays[d.date]).length;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-1">
            Import from WhatsApp
          </h3>
          <p style={{ color: C.concrete }} className="text-xs max-w-2xl">
            In the site WhatsApp group: ⋮ → More → <b>Export chat</b> → <b>Include media</b>, then upload the zip here. AI turns each day's messages and photos into a daily log entry for you to review. Days already imported are skipped.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="file" accept=".zip,.txt,application/zip,text/plain" ref={fileRef} className="hidden" onChange={onPick} />
          <Btn tone="ghost" small onClick={() => fileRef.current.click()}>
            <Upload size={14} /> Upload chat export
          </Btn>
        </div>
      </div>
      {lastImport && (lastImport.entryIds?.length || lastImport.docIds?.length) ? (
        <p style={{ color: C.concrete }} className="text-xs mt-2">
          Last import: {new Date(lastImport.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} — {lastImport.entryIds?.length || 0} log entries, {lastImport.docIds?.length || 0} documents.{" "}
          <button onClick={onUndo} style={{ color: C.red }} className="underline">Undo last import</button>
        </p>
      ) : null}
      {error && <p style={{ color: C.red }} className="text-xs mt-2">{error}</p>}

      {step && (
        <Modal title="Import from WhatsApp" onClose={close} size="large">
          {step === "choose" && data && (
            <div>
              {needsTz && (
                <label className="flex items-start gap-2 text-xs mb-3" style={{ color: C.ink }}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={toIndiaTime}
                    onChange={(e) => { setToIndiaTime(e.target.checked); if (sourceFile) loadExport(sourceFile, e.target.checked); }}
                  />
                  <span>Convert message times from your phone's time zone (<b>{tz}</b>) to <b>India time</b>, so each update lands on the right site day. Keep this on unless the chat was exported from a phone set to India time.</span>
                </label>
              )}
              {!data.hasMedia && (
                <p style={{ color: C.yellow }} className="text-xs mb-3">No photos in this export — choose “Include media” when exporting to bring the photos in too.</p>
              )}
              <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide mb-1">Whose messages count as progress?</div>
              <p style={{ color: C.concrete }} className="text-xs mb-2">Matched to your People list by phone number or name. Add anyone unknown so the AI knows their role.</p>
              <div className="grid gap-2 sm:grid-cols-2 mb-4">
                {data.senders.map(([name, n]) => {
                  const c = matchContact(name, contacts);
                  return (
                    <div key={name} style={{ background: "#fff", border: `1px solid ${c ? C.green : C.line}` }} className="text-xs rounded-md px-3 py-2 flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1.5 min-w-0">
                        <input type="checkbox" checked={!!pickedSenders[name]} onChange={(e) => setPickedSenders({ ...pickedSenders, [name]: e.target.checked })} />
                        <span className="font-semibold truncate">{name}</span>
                        <span style={{ color: C.concrete }}>({n})</span>
                      </label>
                      {c ? (
                        <span style={{ color: C.green }} className="ml-auto flex items-center gap-1 font-semibold">
                          <CheckCircle2 size={12} /> {c.role}{c.name.toLowerCase() !== name.toLowerCase() ? ` · ${c.name}` : ""}
                        </span>
                      ) : setContacts ? (
                        <select
                          defaultValue=""
                          onChange={(e) => addSenderToPeople(name, e.target.value)}
                          style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 11 }}
                          className="ml-auto"
                        >
                          <option value="">Not in People — add as…</option>
                          {contactSchema[0].options.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span style={{ color: C.concrete }} className="ml-auto">not in People</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mb-1">
                <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide">Days to import</div>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setPickedDays(Object.fromEntries(visibleDays.map((d) => [d.date, !importedDates.has(d.date)])))} style={{ color: C.navy }} className="underline">New days only</button>
                  <button onClick={() => setPickedDays(Object.fromEntries(visibleDays.map((d) => [d.date, false])))} style={{ color: C.navy }} className="underline">None</button>
                </div>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2 mb-4" style={{ maxHeight: 320, overflowY: "auto" }}>
                {[...visibleDays].reverse().map((d) => {
                  const photos = d.messages.reduce((n, m) => n + m.photos.length, 0);
                  return (
                    <label key={d.date} style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-md px-3 py-2 text-xs flex items-center gap-2">
                      <input type="checkbox" checked={!!pickedDays[d.date]} onChange={(e) => setPickedDays({ ...pickedDays, [d.date]: e.target.checked })} />
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{d.date}</span>
                      <span style={{ color: C.concrete }}>{d.messages.length} msgs · {photos} photos</span>
                      {importedDates.has(d.date) && <span style={{ color: C.green }} className="ml-auto font-semibold">imported</span>}
                    </label>
                  );
                })}
              </div>
              {data.docs.length > 0 && (
                <div className="mb-4">
                  <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide mb-1">Documents shared in the chat ({data.docs.length})</div>
                  <p style={{ color: C.concrete }} className="text-xs mb-2">Ticked ones are saved to <b>Documents</b>. Ones you already have (same file name) are unticked.</p>
                  <div className="space-y-1.5" style={{ maxHeight: 220, overflowY: "auto" }}>
                    {data.docs.map((d) => {
                      const pd = pickedDocs[d.name] || {};
                      const tooBig = d.size > DOC_SIZE_LIMIT;
                      return (
                        <div key={d.name + d.date + d.time} style={{ background: "#fff", border: `1px solid ${C.line}`, opacity: pd.include ? 1 : 0.7 }} className="rounded-md px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
                          <input type="checkbox" disabled={!d.inZip || tooBig} checked={!!pd.include} onChange={(e) => setPickedDocs({ ...pickedDocs, [d.name]: { ...pd, include: e.target.checked } })} />
                          <FileText size={13} style={{ color: C.navy }} />
                          <input style={{ ...inputStyle, width: 260, padding: "3px 6px", fontSize: 12 }} value={pd.title || ""} onChange={(e) => setPickedDocs({ ...pickedDocs, [d.name]: { ...pd, title: e.target.value } })} />
                          <select style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 12 }} value={pd.type} onChange={(e) => setPickedDocs({ ...pickedDocs, [d.name]: { ...pd, type: e.target.value } })}>
                            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <span style={{ color: C.concrete }}>{d.date} · {d.sender}</span>
                          {d.already && <span style={{ color: C.green }} className="font-semibold">already in Documents</span>}
                          {!d.inZip && <span style={{ color: C.yellow }}>not in this export (export “with media”)</span>}
                          {tooBig && <span style={{ color: C.yellow }}>too large ({Math.round(d.size / 1048576)} MB) — upload it manually</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <Btn onClick={readDays} disabled={!selectedCount}>
                  <Sparkles size={15} /> Read {selectedCount} {selectedCount === 1 ? "day" : "days"} with AI
                </Btn>
                {selectedDocs().length > 0 && (
                  <Btn tone="ghost" onClick={importDocsOnly} disabled={importing}>
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Save {selectedDocs().length} {selectedDocs().length === 1 ? "document" : "documents"} only
                  </Btn>
                )}
              </div>
              <p style={{ color: C.concrete }} className="text-xs mt-2">Nothing is saved until you press Import at the end — you can close this window at any time.</p>
              {selectedCount > 15 && <p style={{ color: C.concrete }} className="text-xs mt-2">Tip: many days can take a few minutes. You can review what's done so far at any time.</p>}
            </div>
          )}

          {(step === "reading" || step === "review") && (
            <div>
              {step === "reading" && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span style={{ color: C.ink }} className="text-sm flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> {status}</span>
                  <button onClick={() => { stopRef.current = true; }} style={{ color: C.navy }} className="text-xs underline">Stop and review what's done</button>
                </div>
              )}
              <div className="space-y-3 mb-4">
                {drafts.map((d, idx) => (
                  <div key={d.date} style={{ background: "#fff", border: `1px solid ${d.include ? C.green : C.line}`, opacity: d.include ? 1 : 0.65 }} className="rounded-md p-3">
                    <div className="flex items-start gap-3 flex-wrap">
                      <label className="flex items-center gap-2 text-xs font-semibold">
                        <input type="checkbox" checked={d.include} onChange={(e) => setDraft(idx, { include: e.target.checked })} />
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{d.date}</span>
                      </label>
                      <div className="flex gap-1.5">
                        {PHOTO_SLOTS.filter((s) => d.photos[s.key]).map((s) => (
                          <div key={s.key} className="relative">
                            <img src={`data:image/jpeg;base64,${d.photos[s.key]}`} alt={s.label} title={s.label} className="rounded object-cover" style={{ width: 56, height: 56 }} />
                            <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }} className="absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded">{s.key === "start" ? "Start" : "End"}</span>
                          </div>
                        ))}
                        {(d.photos.extra || []).map((x, k) => (
                          <div key={k} className="relative">
                            <img src={`data:image/jpeg;base64,${x}`} alt="Useful photo" className="rounded object-cover" style={{ width: 56, height: 56 }} />
                            <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }} className="absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded">+{k + 1}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex-1 min-w-[220px] grid gap-2 sm:grid-cols-3">
                        <select style={{ ...inputStyle, padding: "6px 8px", fontSize: 13 }} value={d.stage} onChange={(e) => setDraft(idx, { stage: e.target.value })}>
                          {stages.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input style={{ ...inputStyle, padding: "6px 8px", fontSize: 13 }} type="number" min="0" placeholder="Workers" value={d.workersCount} onChange={(e) => setDraft(idx, { workersCount: e.target.value })} />
                        <span style={{ color: C.concrete }} className="text-xs self-center">{d.messageCount} messages{!d.relevant ? " · looks like chat only" : ""}</span>
                        {d.reportedBy && <span style={{ color: C.concrete }} className="text-xs sm:col-span-3">From: {d.reportedBy}</span>}
                        {d.photoNote && <span style={{ color: C.concrete }} className="text-xs sm:col-span-3 flex items-center gap-1"><Camera size={11} /> {d.photoNote}</span>}
                        {d.completed?.length > 0 && (
                          <span className="text-xs sm:col-span-3 flex items-center gap-1 flex-wrap" style={{ color: C.green }}>
                            <CheckCircle2 size={11} /> Marks as finished: {d.completed.join(", ")}
                            <button onClick={() => setDraft(idx, { completed: [] })} style={{ color: C.concrete }} className="underline ml-1">don't</button>
                          </span>
                        )}
                        <textarea style={{ ...inputStyle, minHeight: 54, fontSize: 13 }} className="sm:col-span-3" value={d.description} onChange={(e) => setDraft(idx, { description: e.target.value })} />
                      </div>
                    </div>
                    {d.failed && <p style={{ color: C.yellow }} className="text-xs mt-1">{d.failed}</p>}
                  </div>
                ))}
              </div>
              {step === "review" && (
                <div className="flex items-center gap-4 flex-wrap">
                  {selectedDocs().length > 0 && <span style={{ color: C.concrete }} className="text-xs w-full">Also saving {selectedDocs().length} document(s) to Documents.</span>}
                  <Btn onClick={doImport} disabled={importing || (!drafts.some((d) => d.include) && !selectedDocs().length)}>
                    {importing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    Import {drafts.filter((d) => d.include).length} {drafts.filter((d) => d.include).length === 1 ? "entry" : "entries"}
                  </Btn>
                  <label className="flex items-center gap-2 text-xs" style={{ color: C.ink }}>
                    <input type="checkbox" checked={runChecks} onChange={(e) => setRunChecks(e.target.checked)} />
                    Run the AI safety/flag check on each imported entry
                  </label>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// Compares the WHOLE daily log (text, AI flags, and as many site photos as
// fit in one request) against the uploaded final plan. Used by the button
// in the Progress tab and by the weekly scheduled check.
async function runPlanCrossCheck({ meta, progress, onStep = () => {} }) {
  const planFile = meta.planFile;
  if (!planFile) throw new Error("Upload the final plan first.");
  onStep("Gathering the daily log and photos…");
  const entries = [...progress].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const log = entries
    .map((p, i) => {
      const photoNote = p.photoSlots?.length ? ` [photos: ${p.photoSlots.map((k) => (k === "start" ? "start of day" : "end of day")).join(" + ")}]` : "";
      const aiNote = p.flagReason ? ` | Daily AI check: ${p.flag} — ${p.flagReason}` : "";
      return `#${i + 1} ${p.date} — ${p.stage} (${p.workersCount || "?"} workers): ${p.description || "(no notes)"}${photoNote}${aiNote}`;
    })
    .join("\n");

  // Request-size budget: the plan file goes first, then site photos from
  // the most recent days backwards until the budget is used up.
  const BUDGET = 3000000; // base64 characters, stays under the server's 4.5 MB upload limit
  const PLAN_MAX = 1500000; // leave at least half the budget for site photos
  const planMime = planFile.type || "application/octet-stream";
  const planSendable = planMime.startsWith("image/") || planMime === "application/pdf";
  const images = [];
  let used = 0;
  let planPages = 0; // >0 when a big PDF was turned into page images
  let planTotalPages = 0;
  if (planSendable) {
    if (planMime === "application/pdf" && planFile.b64.length > PLAN_MAX) {
      onStep("Plan PDF is large — preparing its pages…");
      let res = await pdfToImages(planFile.b64);
      let size = res.images.reduce((n, d) => n + d.length, 0);
      if (size > PLAN_MAX) {
        res = await pdfToImages(planFile.b64, { maxPages: 3, width: 1400, quality: 0.7 });
        size = res.images.reduce((n, d) => n + d.length, 0);
      }
      res.images.forEach((data) => images.push({ data, mimeType: "image/jpeg" }));
      used += size;
      planPages = res.images.length;
      planTotalPages = res.totalPages;
    } else if (planMime.startsWith("image/") && planFile.b64.length > PLAN_MAX) {
      const data = await shrinkBase64Image(planFile.b64, 1800, 0.75);
      images.push({ data, mimeType: "image/jpeg" });
      used += data.length;
    } else {
      images.push({ data: planFile.b64, mimeType: planMime });
      used += planFile.b64.length;
    }
  }
  const photoLabels = [];
  for (const p of [...entries].reverse()) {
    if (!p.photoSlots?.length) continue;
    const pics = await loadKey(progressPhotoKey(p.id), null);
    for (const slot of PHOTO_SLOTS) {
      const data = pics?.[slot.key];
      if (!data) continue;
      if (used + data.length > BUDGET) break;
      images.push({ data, mimeType: "image/jpeg" });
      used += data.length;
      photoLabels.push(`${p.date} ${p.stage} — ${slot.label.toLowerCase()}`);
    }
    if (used > BUDGET * 0.95) break;
  }

  onStep("AI is comparing the site against the plan…");
  const planCount = planSendable ? Math.max(planPages, 1) : 0;
  const attachList = [
    !planSendable
      ? "The plan file (" + planFile.name + ") could not be attached in this format — rely on the notes below."
      : planPages
      ? `Attachments 1-${planPages}: pages of the FINAL APPROVED PLAN (${planFile.name})${planTotalPages > planPages ? `, first ${planPages} of ${planTotalPages} pages` : ""}.`
      : "Attachment 1: the FINAL APPROVED PLAN (" + planFile.name + ").",
    ...photoLabels.map((l, i) => `Attachment ${i + planCount + 1}: site photo, ${l}.`),
  ].join("\n");

  const text = `You are an experienced, strict site engineer reviewing a house under construction in Bangalore, India, for the homeowner, who lives abroad and cannot visit. Compare EVERYTHING logged so far against the final approved plan.

${attachList}

Stages marked complete: ${effectiveCompletedStages(meta, progress).join(", ") || "none"}
${meta.planText ? `Extra plan notes from the homeowner: ${meta.planText}\n` : ""}Today's date: ${today()}

Full daily progress log (oldest first):
${log || "(no entries yet)"}

Check carefully:
- Does the work in the photos match the plan (layout, dimensions you can judge, setbacks, number of floors, room positions, materials)?
- Is the work in the right sequence, and are any stages behind the plan's timeline?
- Do the log notes match what the photos actually show (including dates printed on photos)?
- Safety and workmanship problems visible in photos.
- Gaps: days with no entries, stages logged with no photos, anything missing you'd want evidence for.

Reply in EXACTLY this format, plain text, no markdown symbols other than "- " bullets:
VERDICT: ON TRACK or WATCH or RED FLAG
PROGRESS: a single number 0-100 = your estimate of how much of the WHOLE house (as per the plan) is built so far, judged from the log and photos
CURRENT STAGE: the stage work is at now, in a few words
NEXT MILESTONE: the next big milestone to watch for, in a few words
SUMMARY: two or three sentences a homeowner can understand.
MATCHES PLAN:
- point
DOESN'T MATCH / BEHIND:
- point (mention the log date)
SAFETY & QUALITY:
- point
ASK THE BUILDER:
- question
Keep every point short and specific. Write "- Nothing noted" under a heading if there is nothing.`;

  const out = await askClaude({ text, images });
  return { ...parsePlanReport(out), checkedAt: new Date().toISOString(), entryCount: entries.length, photoCount: photoLabels.length };
}

// Weekly schedule: the check is "due" once the chosen weekday has arrived
// and no check has run since then. It runs the next time anyone opens the app.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function lastScheduledDate(day, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  return d;
}
function planCheckDue(meta) {
  const day = meta?.planSchedule?.day;
  if (day === undefined || day === null || day === "" || !meta.planFile) return false;
  const running = meta.planReviewRunning && Date.now() - new Date(meta.planReviewRunning).getTime() < 15 * 60 * 1000;
  if (running) return false;
  const last = meta.planReview?.checkedAt ? new Date(meta.planReview.checkedAt) : null;
  return !last || last < lastScheduledDate(Number(day));
}
function nextPlanCheckLabel(meta) {
  const day = meta?.planSchedule?.day;
  if (day === undefined || day === null || day === "") return "";
  if (planCheckDue(meta)) return "due now — runs next time the app is opened";
  const next = lastScheduledDate(Number(day));
  next.setDate(next.getDate() + 7);
  return next.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function ProgressTab({ progress, setProgress, meta, setMeta, contacts = [], setContacts, documents = [], setDocuments, currentUser }) {
  const [planFile, setPlanFile] = useState(meta.planFile || null);
  const [planFilePreview, setPlanFilePreview] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkStep, setCheckStep] = useState("");
  const [checkError, setCheckError] = useState("");
  const planFileRef = useRef();
  const loggedStages = new Set(progress.map((p) => p.stage));
  const stages = getStages(meta);

  // Always points at the latest list, so an AI review that finishes later
  // doesn't overwrite entries added or removed in the meantime.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // Latest meta for async work (AI reviews finish later and must not
  // overwrite changes made in the meantime).
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const patchMeta = async (fn) => {
    const next = fn(metaRef.current);
    metaRef.current = next;
    setMeta(next);
    await saveKey("meta", next);
    return next;
  };


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
      const { flag, reason, completed } = await reviewProgressEntry(entry, pics, {
        recent: progressRef.current.filter((p) => p.id !== entry.id),
        planText: metaRef.current.planText,
        completedStages: effectiveCompletedStages(metaRef.current, progressRef.current),
        stages: getStages(metaRef.current),
      });
      await patchEntry(entry.id, { flag, flagReason: reason });
      if (completed?.length) await markStagesAuto(completed, entry.date, { evidence: (entry.description || "").slice(0, 80), entryId: entry.id, importId: entry.importId });
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

  // Adds entries built from a WhatsApp export, newest first, then (optionally)
  // runs the usual AI flag check on each one in the background.
  const importFromWhatsApp = async (drafts, runChecks, docs = []) => {
    const importId = uid();
    const entries = [];
    for (const d of drafts) {
      const id = uid();
      const photoSlots = PHOTO_SLOTS.filter((s) => d.photos[s.key]).map((s) => s.key);
      const extraCount = (d.photos.extra || []).length;
      if (photoSlots.length || extraCount) await saveKey(progressPhotoKey(id), d.photos);
      entries.push({ id, importId, date: d.date, extraCount, stage: d.stage, workersCount: d.workersCount, description: d.description, photoSlots, flag: runChecks ? "Checking" : "", flagReason: "", source: "whatsapp", reportedBy: d.reportedBy || "" });
    }
    if (entries.length) {
      const next = [...entries, ...progressRef.current].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      progressRef.current = next;
      setProgress(next);
      await saveKey("progress", next);
    }

    // Documents shared in the chat → Documents tab.
    const newDocs = docs.map((d) => ({
      id: uid(), importId, title: d.title || d.name, type: d.type || "Other", date: d.date, amount: "",
      attachment: d.attachment, notes: `From WhatsApp — shared by ${d.sender}${d.caption ? `: "${d.caption.slice(0, 120)}"` : ""}`,
      uploadedBy: currentUser?.id || null, uploadedByName: currentUser?.name || currentUser?.email || "", source: "whatsapp",
    }));
    if (newDocs.length && setDocuments) {
      const nextDocs = [...newDocs, ...documents];
      setDocuments(nextDocs);
      await saveKey("documents", nextDocs);
    }

    // Stages the chat says were finished.
    for (const d of drafts) {
      if (d.completed?.length) await markStagesAuto(d.completed, d.date, { evidence: (d.description || "").slice(0, 80), importId });
    }
    await patchMeta((m) => ({ ...m, lastImport: { id: importId, at: new Date().toISOString(), entryIds: entries.map((e) => e.id), docIds: newDocs.map((d) => d.id) } }));

    if (runChecks) {
      for (const e of entries) {
        await runReview(e, drafts.find((d) => d.date === e.date)?.photos);
      }
    }
  };

  // Removes everything the last WhatsApp import added (entries, their photos,
  // documents and the stage ticks it made).
  const undoLastImport = async () => {
    const li = metaRef.current.lastImport;
    if (!li) return;
    if (!window.confirm(`Undo the last WhatsApp import? This removes ${li.entryIds?.length || 0} log entries and ${li.docIds?.length || 0} documents it added.`)) return;
    const ids = new Set(li.entryIds || []);
    for (const e of progressRef.current.filter((x) => ids.has(x.id))) {
      if (e.photoSlots?.length || e.extraCount) await saveKey(progressPhotoKey(e.id), null);
    }
    const next = progressRef.current.filter((x) => !ids.has(x.id));
    progressRef.current = next;
    setProgress(next);
    await saveKey("progress", next);
    if (li.docIds?.length && setDocuments) {
      const dIds = new Set(li.docIds);
      const nextDocs = documents.filter((d) => !dIds.has(d.id));
      setDocuments(nextDocs);
      await saveKey("documents", nextDocs);
    }
    await patchMeta((m) => {
      const auto = { ...(m.stageAuto || {}) };
      Object.keys(auto).forEach((k) => { if (auto[k]?.importId === li.id) delete auto[k]; });
      return { ...m, stageAuto: auto, lastImport: null };
    });
  };

  const saveEdit = (initial, updateItem) => async (vals, photos) => {
    const photoSlots = PHOTO_SLOTS.filter((s) => photos[s.key]).map((s) => s.key);
    // Keep any extra photos from a WhatsApp import — the edit form only shows start/end.
    const existing = initial.extraCount ? await loadKey(progressPhotoKey(initial.id), null) : null;
    const extra = existing?.extra || [];
    if (photoSlots.length || extra.length) await saveKey(progressPhotoKey(initial.id), { ...photos, extra });
    else if (initial.photoSlots?.length) await saveKey(progressPhotoKey(initial.id), null);
    const entry = { ...initial, ...vals, photoSlots };
    const next = await updateItem(initial.id, { ...vals, photoSlots });
    progressRef.current = next;
    runReview(entry, photos);
  };

  const onPickPlanFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    // Plans are drawings with small text, so keep images sharper than site photos.
    const b64 = isImage ? await compressImage(file, 2000, 0.85) : await fileToBase64(file);
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

  // Tap a stage: force it done / not done, overriding the AI.
  const toggleStageComplete = (stage) =>
    patchMeta((m) => {
      const st = stageState(m, stage, loggedStages);
      const on = new Set(m.completedStages || []);
      const off = new Set(m.stageManualOff || []);
      if (st.done) { on.delete(stage); off.add(stage); } else { on.add(stage); off.delete(stage); }
      return { ...m, completedStages: [...on], stageManualOff: [...off] };
    });
  const resetStageToAuto = (stage) =>
    patchMeta((m) => ({
      ...m,
      completedStages: (m.completedStages || []).filter((x) => x !== stage),
      stageManualOff: (m.stageManualOff || []).filter((x) => x !== stage),
    }));
  // ---- Find a day in the log
  const [logMode, setLogMode] = useState("all"); // all | date | range
  const [logDate, setLogDate] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logStage, setLogStage] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logFlagged, setLogFlagged] = useState(false);
  const loggedDates = [...new Set(progress.map((p) => p.date).filter(Boolean))].sort();
  const logFilter = (p) => {
    if (logMode === "date" && logDate && p.date !== logDate) return false;
    if (logMode === "range" && ((logFrom && p.date < logFrom) || (logTo && p.date > logTo))) return false;
    if (logStage && p.stage !== logStage) return false;
    if (logFlagged && !(p.flag === "Watch" || p.flag === "Red Flag")) return false;
    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase();
      const hay = [p.description, p.stage, p.reportedBy, p.flagReason].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const logFiltered = logMode !== "all" || logStage || logSearch.trim() || logFlagged;
  const logMatches = progress.filter(logFilter).length;
  const stepDay = (dir) => {
    const base = logDate || loggedDates[loggedDates.length - 1];
    const idx = loggedDates.indexOf(base);
    const next = idx === -1
      ? (dir < 0 ? [...loggedDates].reverse().find((d) => d < base) : loggedDates.find((d) => d > base))
      : loggedDates[idx + dir];
    if (next) { setLogMode("date"); setLogDate(next); }
  };
  const nearestDays = (d) => {
    const before = [...loggedDates].reverse().find((x) => x < d);
    const after = loggedDates.find((x) => x > d);
    return { before, after };
  };
  const clearLogFilter = () => { setLogMode("all"); setLogDate(""); setLogFrom(""); setLogTo(""); setLogStage(""); setLogSearch(""); setLogFlagged(false); };

  const [newStage, setNewStage] = useState("");
  const [newStageAfter, setNewStageAfter] = useState(""); // "" = at the end
  const [reordering, setReordering] = useState(false);
  const addCustomStage = async () => {
    const name = newStage.trim();
    if (!name || getStages(metaRef.current).some((x) => x.toLowerCase() === name.toLowerCase())) { setNewStage(""); return; }
    await patchMeta((m) => {
      const current = getStages(m).filter((x) => x !== "Other");
      const at = newStageAfter ? current.indexOf(newStageAfter) + 1 : current.length;
      const order = [...current.slice(0, at), name, ...current.slice(at)];
      return { ...m, customStages: [...(m.customStages || []), name], stageOrder: order };
    });
    setNewStage("");
  };
  const moveStage = (name, dir) =>
    patchMeta((m) => {
      const order = getStages(m).filter((x) => x !== "Other");
      const i = order.indexOf(name);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return m;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...m, stageOrder: order };
    });
  const resetStageOrder = () => patchMeta((m) => ({ ...m, stageOrder: [] }));
  const removeCustomStage = (name) => {
    if (!window.confirm(`Remove the stage "${name}"? Log entries already using it are kept.`)) return;
    patchMeta((m) => ({ ...m, customStages: (m.customStages || []).filter((x) => x !== name) }));
  };
  // AI said these stages are finished (from a log entry or WhatsApp import).
  const markStagesAuto = (stages, date, extra = {}) => {
    const valid = (stages || []).filter((x) => getStages(metaRef.current).includes(x) && x !== "Other");
    if (!valid.length) return;
    return patchMeta((m) => {
      const auto = { ...(m.stageAuto || {}) };
      valid.forEach((x) => { if (!auto[x] || (date && date < auto[x].date)) auto[x] = { date, ...extra }; });
      return { ...m, stageAuto: auto };
    });
  };

  const crossCheck = async () => {
    if (!planFile) return;
    setChecking(true);
    setCheckError("");
    try {
      const report = await runPlanCrossCheck({ meta, progress: progressRef.current, onStep: setCheckStep });
      const next = { ...meta, planReview: report, planReviewRunning: null };
      setMeta(next);
      await saveKey("meta", next);
    } catch (e) {
      console.error("[SiteLedger] Plan cross-check failed", e);
      const busy = /high demand|overloaded|try again later|rate limit|\(429\)|\(503\)/i.test(e?.message || "");
      setCheckError(busy
        ? "The AI service is busy right now (this is on Google's side and usually clears in a few minutes). Please try again shortly."
        : `Could not complete the cross-check. ${e?.message || ""}`.trim());
    }
    setCheckStep("");
    setChecking(false);
  };

  const setScheduleDay = async (value) => {
    const next = { ...meta, planSchedule: value === "" ? null : { day: Number(value) } };
    setMeta(next);
    await saveKey("meta", next);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2">
          Stage completion
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-3">
          Stages tick themselves off automatically: when a log entry or WhatsApp update says a stage is finished (<b>AI</b>), or when the next structural stage has started (<b>auto</b>). Tap a stage to override it yourself. If you untick one the AI marked, it shows a dashed “not done” chip — the ↺ icon hands it back to AI.
        </p>
        <div className="flex flex-wrap gap-2">
          {getStages(meta).filter((x) => x !== "Other").map((x) => {
            const st = stageState(meta, x, loggedStages);
            const custom = (meta.customStages || []).includes(x);
            const tag = st.how === "ai" ? "AI" : st.how === "implied" ? "auto" : null;
            const title = st.how === "ai" ? `Marked done by AI${st.auto?.date ? ` on ${st.auto.date}` : ""}${st.auto?.evidence ? ` — "${st.auto.evidence}"` : ""}. Tap to override.`
              : st.how === "implied" ? `Done automatically because ${st.implied} has started. Tap to override.`
              : st.how === "manual" ? "You marked this done. Tap to undo."
              : st.how === "manual-off" ? "You marked this NOT done (overriding AI). Tap to mark done."
              : "Tap to mark done.";
            return (
              <span key={x} className="inline-flex items-center">
                <button
                  onClick={() => toggleStageComplete(x)}
                  title={title}
                  style={{
                    border: `1.5px ${st.how === "manual-off" ? "dashed" : "solid"} ${st.done ? C.green : st.inProgress ? C.rust : C.line}`,
                    background: st.done ? C.green : "#fff",
                    color: st.done ? "#fff" : C.ink,
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5"
                >
                  {st.done && <CheckCircle2 size={13} />}
                  {x}
                  {tag && <span style={{ background: "rgba(255,255,255,0.25)" }} className="text-[9px] uppercase px-1 rounded">{tag}</span>}
                  {st.how === "manual-off" && (
                    <>
                      <span style={{ color: C.concrete }} className="text-[9px] uppercase">not done</span>
                      <span
                        role="button"
                        title="Undo my override — let AI decide again"
                        onClick={(e) => { e.stopPropagation(); resetStageToAuto(x); }}
                        style={{ color: C.navy }}
                        className="ml-0.5 inline-flex"
                      >
                        <RotateCcw size={12} />
                      </span>
                    </>
                  )}
                </button>
                {custom && (
                  <button onClick={() => removeCustomStage(x)} title="Remove this stage" style={{ color: C.concrete }} className="ml-0.5 hover:text-red-600"><X size={12} /></button>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <input
            style={{ ...inputStyle, width: 260, padding: "6px 10px", fontSize: 13 }}
            placeholder="Add a stage or mini project, e.g. Lift installation"
            value={newStage}
            onChange={(e) => setNewStage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomStage()}
          />
          <select
            style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 13 }}
            value={newStageAfter}
            onChange={(e) => setNewStageAfter(e.target.value)}
            title="Where the new stage goes"
          >
            <option value="">at the end</option>
            {getStages(meta).filter((x) => x !== "Other").map((x) => <option key={x} value={x}>after {x}</option>)}
          </select>
          <Btn small tone="ghost" onClick={addCustomStage} disabled={!newStage.trim()}><Plus size={13} /> Add stage</Btn>
          <Btn small tone="ghost" onClick={() => setReordering(true)}><ListOrdered size={13} /> Reorder stages</Btn>
        </div>
        {reordering && (
          <Modal title="Reorder stages" onClose={() => setReordering(false)}>
            <p style={{ color: C.concrete }} className="text-xs mb-3">Use the arrows to move a stage. The order is used on the Dashboard, in the log form and by the AI.</p>
            <div className="space-y-1.5 mb-4">
              {getStages(meta).filter((x) => x !== "Other").map((x, i, arr) => (
                <div key={x} style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-md px-3 py-1.5 flex items-center gap-2 text-sm">
                  <span style={{ color: C.concrete, fontFamily: "'IBM Plex Mono', monospace" }} className="text-xs w-5 text-right">{i + 1}</span>
                  <span className="flex-1" style={{ color: C.ink }}>{x}{(meta.customStages || []).includes(x) && <span style={{ color: C.concrete }} className="text-xs"> · your stage</span>}</span>
                  <button onClick={() => moveStage(x, -1)} disabled={i === 0} title="Move up" style={{ color: i === 0 ? C.line : C.navy }} className="p-1"><ArrowUp size={15} /></button>
                  <button onClick={() => moveStage(x, 1)} disabled={i === arr.length - 1} title="Move down" style={{ color: i === arr.length - 1 ? C.line : C.navy }} className="p-1"><ArrowDown size={15} /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Btn onClick={() => setReordering(false)}><CheckCircle2 size={15} /> Done</Btn>
              {(meta.stageOrder || []).length > 0 && <button onClick={resetStageOrder} style={{ color: C.navy }} className="text-xs underline">Back to default order</button>}
            </div>
          </Modal>
        )}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
        <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide mb-2">
          Building plan &amp; schedule
        </h3>
        <p style={{ color: C.concrete }} className="text-xs mb-2">
          Upload the final approved plan (PDF or a photo/scan of the drawing). The cross-check compares every daily log entry and site photo against it.
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" ref={planFileRef} className="hidden" onChange={onPickPlanFile} />
          <Btn onClick={() => planFileRef.current.click()} tone="ghost" small>
            <Paperclip size={14} /> {planFile ? "Replace plan" : "Upload final plan"}
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
          <Btn onClick={crossCheck} disabled={checking || !planFile} tone="rust">
            {checking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Cross-check progress vs. plan
          </Btn>
          {checking && <span style={{ color: C.concrete }} className="text-xs">{checkStep}</span>}
          {!planFile && <span style={{ color: C.concrete }} className="text-xs">Upload the final plan first.</span>}
        </div>
        <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="mt-3 rounded-md px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
          <CalendarDays size={14} style={{ color: C.navy }} />
          <span style={{ color: C.ink }} className="font-semibold">Weekly auto-check:</span>
          <select
            style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12 }}
            value={meta.planSchedule?.day ?? ""}
            onChange={(e) => setScheduleDay(e.target.value)}
            disabled={!planFile}
          >
            <option value="">Off</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>Every {d}</option>)}
          </select>
          {meta.planSchedule && planFile && (
            <span style={{ color: C.concrete }}>Next: {nextPlanCheckLabel(meta)}. Results also update the Dashboard.</span>
          )}
        </div>
        {checkError && <p style={{ color: C.red }} className="text-xs mt-2">{checkError}</p>}
        {meta.planReview && <PlanReport report={meta.planReview} />}
      </div>

      <WhatsAppImport
        progress={progress} onImport={importFromWhatsApp} contacts={contacts} setContacts={setContacts}
        stages={stages} documents={documents} lastImport={meta.lastImport} onUndo={undoLastImport}
      />

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
        extraFilter={logFilter}
        filterKey={[logMode, logDate, logFrom, logTo, logStage, logSearch, logFlagged].join("|")}
        pageSize={20}
        emptyFilteredText={
          logMode === "date" && logDate
            ? (() => {
                const { before, after } = nearestDays(logDate);
                return `No log entry for ${fmtDay(logDate, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}${before || after ? ` — nearest logged days: ${[before, after].filter(Boolean).map((d) => fmtDay(d, { day: "numeric", month: "short" })).join(" and ")}` : ""}.`;
              })()
            : "No entries match this filter."
        }
        toolbar={progress.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide mr-1">Find</span>
              {[["all", "All days"], ["date", "On a date"], ["range", "Between dates"]].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setLogMode(k); if (k === "date" && !logDate) setLogDate(loggedDates[loggedDates.length - 1] || today()); }}
                  style={{ background: logMode === k ? C.navy : "#fff", color: logMode === k ? "#fff" : C.ink, border: `1px solid ${logMode === k ? C.navy : C.line}` }}
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                >
                  {label}
                </button>
              ))}
              {logMode === "date" && (
                <span className="flex items-center gap-1">
                  <button onClick={() => stepDay(-1)} title="Previous logged day" style={{ color: C.navy }} className="px-1.5 text-sm font-bold">‹</button>
                  <input type="date" style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 13 }} value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                  <button onClick={() => stepDay(1)} title="Next logged day" style={{ color: C.navy }} className="px-1.5 text-sm font-bold">›</button>
                </span>
              )}
              {logMode === "range" && (
                <span className="flex items-center gap-1 text-xs" style={{ color: C.concrete }}>
                  <input type="date" style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 13 }} value={logFrom} onChange={(e) => setLogFrom(e.target.value)} />
                  to
                  <input type="date" style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 13 }} value={logTo} onChange={(e) => setLogTo(e.target.value)} />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <select style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 13 }} value={logStage} onChange={(e) => setLogStage(e.target.value)}>
                <option value="">All stages</option>
                {stages.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <span className="relative">
                <Search size={13} style={{ color: C.concrete, position: "absolute", left: 8, top: 8 }} />
                <input style={{ ...inputStyle, width: 220, padding: "4px 8px 4px 26px", fontSize: 13 }} placeholder="Search notes, e.g. PCC, steel" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
              </span>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: C.ink }}>
                <input type="checkbox" checked={logFlagged} onChange={(e) => setLogFlagged(e.target.checked)} /> Flagged only
              </label>
              <span style={{ color: C.concrete }} className="text-xs ml-auto">
                {logFiltered ? `Showing ${logMatches} of ${progress.length} entries` : `${progress.length} entries · ${loggedDates.length} days logged`}
                {logFiltered && <button onClick={clearLogFilter} style={{ color: C.navy }} className="underline ml-2">Clear</button>}
              </span>
            </div>
          </div>
        )}
        renderForm={({ addItem, updateItem, initial }) =>
          initial
            ? <ProgressEntryForm key={initial.id} initial={initial} stages={stages} onSave={saveEdit(initial, updateItem)} />
            : <ProgressEntryForm stages={stages} onSave={saveEntry(addItem)} />}
        onRemoveItem={(item) => item.photoSlots?.length && saveKey(progressPhotoKey(item.id), null)}
        renderCard={(p) => <ProgressCard entry={p} onRecheck={runReview} />}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Gallery tab — every image in the project, grouped by where it came from */
/* ---------------------------------------------------------------------- */
const isImageFile = (f) => !!f?.data && (f.mimeType || "").startsWith("image/");

// Small clickable thumbnail for a file attached to a card (image or PDF).
function AttachmentThumb({ file, label }) {
  const [open, setOpen] = useState(false);
  const img = isImageFile(file);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-2 flex items-center gap-2 text-xs underline" style={{ color: C.navy }}>
        {img ? (
          <img src={`data:${file.mimeType};base64,${file.data}`} alt={label} className="rounded object-cover" style={{ width: 44, height: 44, border: `1px solid ${C.line}` }} />
        ) : (
          <Paperclip size={13} />
        )}
        {label}
      </button>
      {open && <FilePreview file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

// Row of thumbnails for one or more attached files.
function AttachmentList({ files, label }) {
  const list = asFileList(files);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4">
      {list.map((f, i) => (
        <AttachmentThumb key={i} file={f} label={list.length > 1 ? `${label} ${i + 1}` : label} />
      ))}
    </div>
  );
}

const GALLERY_SECTIONS = [
  { key: "all", label: "All" },
  { key: "site", label: "Site photos" },
  { key: "progress", label: "Progress" },
  { key: "expenses", label: "Expenses" },
  { key: "products", label: "Products" },
  { key: "documents", label: "Documents" },
];
const SECTION_TONE = { site: "concrete", progress: "green", expenses: "red", products: "yellow", documents: "navy" };

function GalleryTab({ gallery, setGallery, progress, expenses, loan, products, documents, canSeeTab, currentUser }) {
  const [section, setSection] = useState("all");
  const [progressPhotos, setProgressPhotos] = useState({}); // entryId -> {start,end}
  const [preview, setPreview] = useState(null);
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


  // Progress photos live under their own keys — fetch them once.
  useEffect(() => {
    let alive = true;
    const withPhotos = progress.filter((p) => (p.photoSlots?.length || p.extraCount) && !progressPhotos[p.id]);
    if (!withPhotos.length) return;
    Promise.all(withPhotos.map((p) => loadKey(progressPhotoKey(p.id), null).then((ph) => [p.id, ph || {}]))).then((pairs) => {
      if (alive) setProgressPhotos((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { alive = false; };
  }, [progress]);

  // Build one list of tiles from every part of the app this person may see.
  const tiles = [];
  gallery.forEach((g) => tiles.push({ id: `g-${g.id}`, section: "site", date: g.date, title: "Site photo", note: g.note, file: { name: `Site photo ${g.date}`, mimeType: "image/jpeg", data: g.b64 }, galleryId: g.id }));
  progress.forEach((p) => {
    PHOTO_SLOTS.forEach((slot) => {
      if (!p.photoSlots?.includes(slot.key)) return;
      const data = progressPhotos[p.id]?.[slot.key];
      tiles.push({ id: `p-${p.id}-${slot.key}`, section: "progress", date: p.date, title: `${p.stage} · ${slot.label}`, note: p.description, loading: !data, file: data ? { name: `${p.date} ${p.stage} ${slot.label}`, mimeType: "image/jpeg", data } : null });
    });
    for (let k = 0; k < (p.extraCount || 0); k++) {
      const data = progressPhotos[p.id]?.extra?.[k];
      tiles.push({ id: `p-${p.id}-x${k}`, section: "progress", date: p.date, title: `${p.stage} · Photo ${k + 1}`, note: p.description, loading: !data, file: data ? { name: `${p.date} ${p.stage} photo ${k + 1}`, mimeType: "image/jpeg", data } : null });
    }
  });
  if (canSeeTab("budget")) {
    expenses.forEach((e) => {
      asFileList(e.receipt).filter(isImageFile).forEach((f, i) =>
        tiles.push({ id: `e-${e.id}-${i}`, section: "expenses", date: e.date, title: `${fmtINR(e.amount)} · ${e.category || "Expense"}`, note: [e.description, e.paidTo && `Paid to ${e.paidTo}`].filter(Boolean).join(" · "), file: f })
      );
    });
    (loan?.enabled ? loan.entries || [] : []).forEach((l) => {
      asFileList(l.proof).filter(isImageFile).forEach((f, i) =>
        tiles.push({ id: `l-${l.id}-${i}`, section: "expenses", date: l.date, title: `${fmtINR(l.amount)} · Loan ${l.type || "entry"}`, note: l.notes, file: f })
      );
    });
  }
  if (canSeeTab("products")) {
    products.forEach((p) => {
      if (!isImageFile(p.image)) return;
      tiles.push({ id: `pr-${p.id}`, section: "products", date: "", title: p.item, note: [p.brand, p.room].filter(Boolean).join(" · "), file: p.image });
    });
  }
  if (canSeeTab("documents")) {
    documents.forEach((d) => {
      if (!isImageFile(d.attachment) || !canSeeDocument(d, currentUser)) return;
      tiles.push({ id: `d-${d.id}`, section: "documents", date: d.date, title: d.title, note: d.type, file: d.attachment });
    });
  }
  tiles.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const sections = GALLERY_SECTIONS.filter((s) =>
    s.key === "all" || s.key === "site" || s.key === "progress" ||
    (s.key === "expenses" && canSeeTab("budget")) || (s.key === "products" && canSeeTab("products")) || (s.key === "documents" && canSeeTab("documents"))
  );
  const count = (k) => (k === "all" ? tiles.length : tiles.filter((t) => t.section === k).length);
  const shown = section === "all" ? tiles : tiles.filter((t) => t.section === section);
  const sectionLabel = (k) => GALLERY_SECTIONS.find((s) => s.key === k)?.label;

  return (
    <div>
      <SectionHeader
        icon={Camera}
        title="Photo gallery"
        subtitle="Every photo in the project — site photos, progress, payments, products and documents"
        action={
          <>
            <input type="file" accept="image/*" ref={fileRef} className="hidden" onChange={onPick} />
            <Btn onClick={() => fileRef.current.click()}>
              <Plus size={16} /> Add site photo
            </Btn>
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {sections.map((s) => {
          const active = section === s.key;
          const n = count(s.key);
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                background: active ? C.navy : C.card,
                color: active ? "#fff" : C.ink,
                border: `1px solid ${active ? C.navy : C.line}`,
                opacity: n === 0 && !active ? 0.55 : 1,
                transition: "background 150ms, color 150ms",
              }}
              className="rounded-full px-3 py-1 text-xs font-semibold"
            >
              {s.label} <span style={{ fontFamily: "'IBM Plex Mono', monospace", opacity: 0.75 }}>{n}</span>
            </button>
          );
        })}
      </div>

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

      {shown.length === 0 && (
        <p style={{ color: C.concrete }} className="text-sm italic">
          {section === "all" ? "No photos yet." : `No ${sectionLabel(section).toLowerCase()} photos yet.`}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <div key={t.id} style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg overflow-hidden">
            <button type="button" onClick={() => t.file && setPreview(t.file)} className="relative block w-full" style={{ height: 180, background: C.paperDark }}>
              {t.file ? (
                <img src={`data:${t.file.mimeType};base64,${t.file.data}`} alt={t.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Loader2 size={18} className="animate-spin" style={{ color: C.concrete }} /></div>
              )}
              <span className="absolute top-2 left-2 rounded" style={{ background: "rgba(245,242,233,0.94)", padding: "2px 3px" }}><Stamp tone={SECTION_TONE[t.section]}>{sectionLabel(t.section)}</Stamp></span>
            </button>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="text-sm font-semibold uppercase truncate">{t.title}</span>
                {t.galleryId && (
                  <button onClick={() => { if (window.confirm("Delete this photo?")) remove(t.galleryId); }} style={{ color: C.concrete }} className="shrink-0 hover:text-red-600"><Trash2 size={14} /></button>
                )}
              </div>
              {t.date && <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs mb-1">{t.date}</div>}
              {t.note && <p style={{ color: C.ink, whiteSpace: "pre-wrap" }} className="text-xs" >{t.note}</p>}
            </div>
          </div>
        ))}
      </div>
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Builder details — read from the uploaded agreement by AI                */
/* ---------------------------------------------------------------------- */
const BUILDER_FIELDS = [
  { key: "companyName", label: "Builder / company name" },
  { key: "contactPerson", label: "Contact person / signatory" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Registered address", multiline: true },
  { key: "gstin", label: "GSTIN" },
  { key: "registrationNo", label: "Company / firm registration no. (CIN etc.)" },
  { key: "licenseNo", label: "Contractor licence / RERA no." },
  { key: "pan", label: "PAN" },
  { key: "agreementDate", label: "Agreement date" },
  { key: "contractValue", label: "Contract value (as written)" },
  { key: "completionPeriod", label: "Completion period (as written, e.g. 14 months)" },
];

// Pull the first {...} block out of an AI reply and parse it.
function parseJsonLoose(text) {
  const t = (text || "").replace(/```json|```/g, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI reply didn't contain the details in the expected format.");
  return JSON.parse(t.slice(start, end + 1));
}

async function extractBuilderDetails(file) {
  const mime = file.mimeType || "application/octet-stream";
  let images;
  if (mime === "application/pdf" && file.data.length > 1500000) {
    // Big scanned agreements: send the first pages as images (names and
    // registration details are almost always on the first pages).
    const res = await pdfToImages(file.data, { maxPages: 5, width: 1600, quality: 0.75 });
    images = res.images.map((data) => ({ data, mimeType: "image/jpeg" }));
  } else if (mime.startsWith("image/") && file.data.length > 1500000) {
    images = [{ data: await shrinkBase64Image(file.data, 1800, 0.8), mimeType: "image/jpeg" }];
  } else if (mime === "application/pdf" || mime.startsWith("image/")) {
    images = [{ data: file.data, mimeType: mime }];
  } else {
    throw new Error("Only PDF or photo/scan agreements can be read. Word files aren't supported — save it as PDF and re-upload.");
  }
  const text = `The attached file is a house construction agreement from Bangalore, India, between a homeowner and a builder/contractor. Read it carefully and extract the BUILDER's (contractor's) details — not the homeowner's.

Reply with ONLY a JSON object, no other text, using exactly these keys:
{
  "companyName": "", "contactPerson": "", "phone": "", "email": "", "address": "",
  "gstin": "", "registrationNo": "", "licenseNo": "", "pan": "",
  "agreementDate": "", "contractValue": "", "completionPeriod": ""
}
Rules: copy values exactly as written in the document; use "" for anything not present — never guess. "registrationNo" is a company/firm registration such as CIN or partnership registration. "licenseNo" is a contractor licence or RERA number. "contractValue" is the total contract amount as written. "completionPeriod" is the promised construction duration / completion time as written (e.g. "14 months from start of work"), or "" if not stated.`;
  const out = await askClaude({ text, images });
  const raw = parseJsonLoose(out);
  const clean = {};
  BUILDER_FIELDS.forEach((f) => { clean[f.key] = typeof raw[f.key] === "string" ? raw[f.key].trim() : raw[f.key] ? String(raw[f.key]) : ""; });
  return clean;
}

function BuilderDetailsCard({ agreement, setAgreement, documents, contacts, setContacts }) {
  const agreementDocs = documents.filter((d) => d.type === "Agreement" && d.attachment?.data);
  const [docId, setDocId] = useState(agreementDocs[0]?.id || "");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null); // details being reviewed before saving
  const [addToPeople, setAddToPeople] = useState(true);
  const builder = agreement?.builder;

  useEffect(() => {
    if (!docId && agreementDocs[0]) setDocId(agreementDocs[0].id);
  }, [agreementDocs.length]);

  const readAgreement = async () => {
    const doc = agreementDocs.find((d) => d.id === docId) || agreementDocs[0];
    if (!doc) return;
    setReading(true);
    setError("");
    try {
      const details = await extractBuilderDetails(doc.attachment);
      setDraft({ ...details, _source: doc.title, _docId: doc.id });
      const exists = contacts.some((c) => c.role === "Builder" && details.companyName && (c.name || "").toLowerCase().includes(details.companyName.toLowerCase()));
      setAddToPeople(!exists);
    } catch (e) {
      console.error("[SiteLedger] Builder details extraction failed", e);
      const busy = /high demand|overloaded|try again later|\(429\)|\(503\)/i.test(e?.message || "");
      setError(busy ? "The AI service is busy right now — please try again in a few minutes." : `Couldn't read the agreement. ${e?.message || ""}`);
    }
    setReading(false);
  };

  const save = async () => {
    const { _source, _docId, ...details } = draft;
    const next = {
      ...agreement,
      builderName: details.companyName || agreement.builderName,
      builder: { ...details, source: _source || builder?.source || "Entered manually", readAt: new Date().toISOString() },
    };
    setAgreement(next);
    await saveKey("agreement", next);

    if (addToPeople && (details.companyName || details.contactPerson)) {
      const name = [details.companyName, details.contactPerson && `(${details.contactPerson})`].filter(Boolean).join(" ");
      const notes = [details.address, details.gstin && `GSTIN: ${details.gstin}`, details.email].filter(Boolean).join("\n");
      const nextContacts = [{ id: uid(), role: "Builder", name, phone: details.phone || "", notes }, ...contacts];
      setContacts(nextContacts);
      await saveKey("contacts", nextContacts);
    }
    setDraft(null);
  };

  const filled = builder && BUILDER_FIELDS.some((f) => builder[f.key]);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 2px rgba(32,36,42,0.05), 0 1px 1px rgba(32,36,42,0.04)" }} className="rounded-lg p-4 mb-6">
      <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="uppercase text-sm font-semibold tracking-wide flex items-center gap-2">
            <Hammer size={15} /> Builder details
          </h3>
          <p style={{ color: C.concrete }} className="text-xs">
            {filled
              ? `From ${builder.source}${builder.readAt ? ` · updated ${new Date(builder.readAt).toLocaleDateString()}` : ""}`
              : "Let AI read your uploaded agreement and fill in the builder's name, address and registration details."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {agreementDocs.length > 1 && (
            <select style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 12 }} value={docId} onChange={(e) => setDocId(e.target.value)}>
              {agreementDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          )}
          {agreementDocs.length > 0 && (
            <Btn small tone="rust" onClick={readAgreement} disabled={reading}>
              {reading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {reading ? "Reading agreement…" : filled ? "Re-read agreement" : "Read from agreement"}
            </Btn>
          )}
          <Btn small tone="ghost" onClick={() => setDraft({ ...(builder || {}), _source: builder?.source || "Entered manually" })}>
            <Pencil size={13} /> {filled ? "Edit" : "Enter manually"}
          </Btn>
        </div>
      </div>
      {agreementDocs.length === 0 && !filled && (
        <p style={{ color: C.concrete }} className="text-xs italic">Upload the agreement in Documents (type “Agreement”, PDF or photo) and a “Read from agreement” button will appear here.</p>
      )}
      {error && <p style={{ color: C.red }} className="text-xs mb-2">{error}</p>}
      {filled && (
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {BUILDER_FIELDS.filter((f) => builder[f.key]).map((f) => (
            <div key={f.key} className={f.multiline ? "sm:col-span-2" : ""}>
              <div style={{ color: C.concrete }} className="text-[11px] uppercase font-semibold tracking-wide">{f.label}</div>
              {f.key === "phone" ? (
                <a href={`tel:${builder.phone.replace(/[^0-9+]/g, "")}`} style={{ color: C.navy }} className="text-sm underline">{builder.phone}</a>
              ) : f.key === "email" ? (
                <a href={`mailto:${builder.email}`} style={{ color: C.navy }} className="text-sm underline">{builder.email}</a>
              ) : f.key === "address" ? (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(builder.address)}`} target="_blank" rel="noreferrer" style={{ color: C.ink, whiteSpace: "pre-wrap" }} className="text-sm hover:underline">{builder.address}</a>
              ) : (
                <div style={{ color: C.ink, fontFamily: ["gstin", "registrationNo", "licenseNo", "pan"].includes(f.key) ? "'IBM Plex Mono', monospace" : undefined }} className="text-sm">{builder[f.key]}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal title="Check builder details" onClose={() => setDraft(null)}>
          <p style={{ color: C.concrete }} className="text-xs mb-3 flex gap-1.5">
            <Sparkles size={12} className="shrink-0 mt-0.5" />
            <span>{draft._source && draft._source !== "Entered manually" ? `Read by AI from “${draft._source}”. ` : ""}Please check against the agreement and correct anything before saving.</span>
          </p>
          {BUILDER_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.multiline ? (
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <input style={inputStyle} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm mb-4" style={{ color: C.ink }}>
            <input type="checkbox" checked={addToPeople} onChange={(e) => setAddToPeople(e.target.checked)} />
            Also add the builder to People (contacts)
          </label>
          <Btn onClick={save}><CheckCircle2 size={15} /> Save builder details</Btn>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Budget / expenses / loan tab                                           */
/* ---------------------------------------------------------------------- */
const EXPENSE_CATEGORIES = ["Material", "Labor", "Builder Payment", "Permission / Govt Fee", "Professional Fee", "Transport", "Other"];
const expenseSchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "category", label: "Category", type: "select", options: EXPENSE_CATEGORIES, required: true },
  { key: "description", label: "Description", type: "text" },
  { key: "amount", label: "Amount (₹)", type: "number", required: true },
  { key: "paidTo", label: "Paid to", type: "text" },
  { key: "mode", label: "Mode", type: "select", options: ["Cash", "UPI", "Bank Transfer", "Cheque", "Card"] },
  { key: "receipt", label: "Payment screenshots / receipts (optional)", type: "file", accept: "image/*,.pdf", multiple: true },
];
const loanEntrySchema = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "type", label: "Type", type: "select", options: ["Sanction", "Disbursement", "EMI Paid", "Other"], required: true },
  { key: "amount", label: "Amount (₹)", type: "number", required: true },
  { key: "proof", label: "Proof — screenshots or bank statements (optional)", type: "file", accept: "image/*,.pdf", multiple: true },
  { key: "notes", label: "Notes", type: "textarea" },
];

// "Disbursed so far" is the total of all Disbursement entries. Older
// projects typed it in by hand — that number is used only until the first
// Disbursement entry is logged.
function loanDisbursed(loan) {
  const disb = (loan?.entries || []).filter((e) => e.type === "Disbursement");
  if (!disb.length) return Number(loan?.disbursed || 0);
  return disb.reduce((sum, e) => sum + Number(e.amount || 0), 0);
}

function BudgetTab({ expenses, setExpenses, permissions, meta, setMeta, loan, setLoan, agreement, setAgreement, documents = [], contacts = [], setContacts }) {
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

      <BuilderDetailsCard agreement={agreement} setAgreement={setAgreement} documents={documents} contacts={contacts} setContacts={setContacts} />

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
        filter={{
          key: "category",
          options: EXPENSE_CATEGORIES,
          summary: (shown, val) => (
            <span style={{ color: C.concrete }}>
              {val === "All" ? "Total" : val}:{" "}
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="font-semibold">
                {fmtINR(shown.reduce((sum, e) => sum + Number(e.amount || 0), 0))}
              </span>
            </span>
          ),
        }}
        addLabel="Add expense"
        renderCard={(e) => (
          <div>
            <div className="flex items-center justify-between mb-1 pr-16">
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{e.date}</span>
              <Stamp tone="navy">{e.category}</Stamp>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(e.amount)}</div>
            <p style={{ color: C.ink }} className="text-sm">{e.description}</p>
            {e.paidTo && <p style={{ color: C.concrete }} className="text-xs mt-1">Paid to {e.paidTo} · {e.mode}</p>}
            <AttachmentList files={e.receipt} label="Payment proof" />
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
            <div className="grid gap-4 sm:grid-cols-2 mb-4 items-end">
              <Field label="Total sanctioned amount (₹)">
                <input style={inputStyle} type="number" defaultValue={loan.sanctioned} onBlur={(e) => updateLoanField("sanctioned", e.target.value)} />
              </Field>
              {(() => {
                const disbursed = loanDisbursed(loan);
                const sanctioned = Number(loan.sanctioned || 0);
                const pct = sanctioned ? Math.min(100, Math.round((disbursed / sanctioned) * 100)) : 0;
                const count = (loan.entries || []).filter((e) => e.type === "Disbursement").length;
                return (
                  <div className="mb-3">
                    <div className="flex items-end justify-between gap-3 flex-wrap mb-1.5">
                      <div>
                        <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide">Disbursed so far</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.green }} className="text-lg font-semibold">{fmtINR(disbursed)}</div>
                      </div>
                      {sanctioned > 0 && (
                        <div className="text-right">
                          <div style={{ color: C.concrete }} className="text-xs uppercase font-semibold tracking-wide">Yet to disburse</div>
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(Math.max(0, sanctioned - disbursed))}</div>
                        </div>
                      )}
                    </div>
                    {sanctioned > 0 && (
                      <div style={{ background: C.paperDark, height: 6 }} className="rounded-full overflow-hidden">
                        <div style={{ width: `${pct}%`, background: C.green, height: "100%" }} />
                      </div>
                    )}
                    <div style={{ color: C.concrete }} className="text-xs mt-1">
                      {count ? `Auto-calculated from ${count} disbursement ${count === 1 ? "entry" : "entries"}${sanctioned ? ` · ${pct}% of sanction` : ""}` : "Add a loan entry of type “Disbursement” and this updates automatically"}
                    </div>
                  </div>
                );
              })()}
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
                  <div className="flex items-center justify-between mb-1 pr-16">
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">{l.date}</span>
                    <Stamp tone="navy">{l.type}</Stamp>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-lg font-semibold">{fmtINR(l.amount)}</div>
                  <p style={{ color: C.ink }} className="text-sm">{l.notes}</p>
                  <AttachmentList files={l.proof} label="Proof" />
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
          <div className="flex items-center justify-between mb-1 pr-16">
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
  { key: "phone", label: "Phone number", type: "tel" },
  { key: "photo", label: "Photo (optional)", type: "file", accept: "image/*", maxWidth: 400 },
  { key: "notes", label: "Notes", type: "textarea" },
];

// Round contact photo, or their initials if there's no photo.
function ContactAvatar({ contact, size = 48 }) {
  const [open, setOpen] = useState(false);
  const p = contact.photo;
  const initials = String(contact.name || "?").replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";
  if (p?.data) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="shrink-0">
          <img src={`data:${p.mimeType};base64,${p.data}`} alt={contact.name} className="rounded-full object-cover" style={{ width: size, height: size, border: `2px solid ${C.line}` }} />
        </button>
        {open && <FilePreview file={{ ...p, name: contact.name }} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <div style={{ width: size, height: size, background: C.navyLight, color: "#fff", fontFamily: "'Oswald', sans-serif" }} className="rounded-full shrink-0 flex items-center justify-center font-semibold">
      {initials}
    </div>
  );
}

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
        <div className="flex gap-3">
          <ContactAvatar contact={c} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-1 pr-16">
              <Stamp tone="navy">{c.role}</Stamp>
            </div>
            <div style={{ fontFamily: "'Oswald', sans-serif", color: C.ink }} className="font-semibold text-sm mt-1">{c.name}</div>
            {c.phone ? (
              <div className="flex items-center gap-2 mt-1">
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-sm">{c.phone}</span>
                <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} style={{ color: C.rust }} className="inline-flex items-center gap-1 text-xs font-semibold">
                  <Phone size={13} /> Call
                </a>
              </div>
            ) : (
              <div style={{ color: C.concrete }} className="text-xs mt-1 italic">No phone number yet — tap edit to add</div>
            )}
            {c.notes && <p style={{ color: C.ink, whiteSpace: "pre-wrap" }} className="text-sm mt-1">{c.notes}</p>}
          </div>
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
  { key: "quantity", label: "Quantity", type: "text", placeholder: "e.g. 40 boxes, 120 sq ft, 6 nos" },
  { key: "price", label: "Price paid (₹)", type: "number" },
  { key: "claimedPrice", label: "Builder's quoted price (₹)", type: "number" },
  { key: "vendor", label: "Vendor / shop", type: "text" },
  { key: "shopPhone", label: "Shop phone number", type: "tel", inputMode: "tel", placeholder: "e.g. +91 98450 12345" },
  { key: "shopAddress", label: "Shop address", type: "textarea" },
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
              {p.quantity && <div style={{ color: C.ink }} className="text-xs mb-1">Qty: <span className="font-semibold">{p.quantity}</span></div>}
              <div className="flex items-center gap-3">
                {p.price && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.rust }} className="text-sm font-semibold">Paid {fmtINR(p.price)}</span>}
                {p.claimedPrice && <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.concrete }} className="text-xs">Quoted {fmtINR(p.claimedPrice)}</span>}
              </div>
              {p.vendor && <div style={{ color: C.concrete }} className="text-xs mt-1">From {p.vendor}</div>}
              {p.shopPhone && (
                <a href={`tel:${p.shopPhone.replace(/[^0-9+]/g, "")}`} style={{ color: C.navy }} className="text-xs mt-1 inline-flex items-center gap-1 underline">
                  <Phone size={12} /> {p.shopPhone}
                </a>
              )}
              {p.shopAddress && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.vendor, p.shopAddress].filter(Boolean).join(", "))}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.concrete, whiteSpace: "pre-wrap" }}
                  className="text-xs mt-1 flex items-start gap-1 hover:underline"
                >
                  <MapPin size={12} className="shrink-0 mt-0.5" /> <span>{p.shopAddress}</span>
                </a>
              )}
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
// Who can see a document — used by the Documents tab and the Gallery.
function canSeeDocument(d, currentUser) {
  if (currentUser?.role === "owner") return true;
  if (d.type === "Design") return true;
  if (d.type === "Agreement") return currentUser?.role === "builder";
  return !!d.uploadedBy && d.uploadedBy === currentUser?.id;
}

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
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const isOwner = currentUser?.role === "owner";

  const [typeFilter, setTypeFilter] = useState("All");

  // Bills, receipts, and "other" are private to whoever uploaded them
  // (plus the owner, who sees everything). Agreements are shared between
  // the builder and the owner only. Designs (drawings, plans, elevations)
  // are shared with everyone on the project, since the whole site team
  // needs to build from them.
  const canSee = (d) => canSeeDocument(d, currentUser);
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
  // Keeps id and who uploaded it; only the form fields change.
  const saveEdit = async (vals) => {
    const next = documents.map((d) => (d.id === editing.id ? { ...d, ...vals, id: d.id, uploadedBy: d.uploadedBy, uploadedByName: d.uploadedByName } : d));
    setDocuments(next);
    setEditing(null);
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
            <CardActions onEdit={() => setEditing(d)} onDelete={() => remove(d.id)} />
            <div className="flex items-center justify-between mb-1 pr-16">
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
      {editing && (
        <Modal title="Edit document" onClose={() => setEditing(null)}>
          <SchemaForm schema={documentSchema} initial={editing} submitLabel="Save changes" onSubmit={saveEdit} />
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
          <div className="flex items-center justify-between mb-1 pr-16">
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

// Shows "Install app" in the header when Chrome on Android says the app can
// be installed; hidden once it's installed or on browsers that don't support it.
function InstallAppButton() {
  const [prompt, setPrompt] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!prompt) return null;
  return (
    <button
      onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }}
      style={{ color: C.yellow }}
      className="flex items-center gap-1 text-xs font-semibold"
    >
      <Download size={14} /> Install app
    </button>
  );
}

export default function App({ currentUser, onSignOut, onSwitchProject }) {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);

  const [meta, setMeta] = useState({ projectName: "Construction AI Ledger", budgetAllocated: "", planText: "", completedStages: [] });
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
        loadKey("meta", { projectName: "Construction AI Ledger", budgetAllocated: "", planText: "", completedStages: [] }),
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

  // Weekly scheduled plan cross-check. Runs quietly in the background when
  // the chosen weekday has arrived and it hasn't run yet this week. A short
  // "running" marker stops two people's apps from running it at once.
  const [autoCheck, setAutoCheck] = useState(""); // "" | "running" | error text
  useEffect(() => {
    if (!loaded || !planCheckDue(meta)) return;
    let cancelled = false;
    (async () => {
      // Re-read the latest saved settings first, in case someone else just ran it.
      const fresh = await loadKey("meta", meta);
      if (cancelled || !planCheckDue(fresh)) { if (!cancelled) setMeta(fresh); return; }
      const locked = { ...fresh, planReviewRunning: new Date().toISOString() };
      setMeta(locked);
      await saveKey("meta", locked);
      setAutoCheck("running");
      try {
        const latestProgress = await loadKey("progress", progress);
        const report = await runPlanCrossCheck({ meta: locked, progress: latestProgress });
        const done = { ...(await loadKey("meta", locked)), planReview: { ...report, scheduled: true }, planReviewRunning: null };
        setMeta(done);
        await saveKey("meta", done);
        setAutoCheck("");
      } catch (e) {
        console.error("[SiteLedger] Scheduled plan check failed", e);
        const cleared = { ...(await loadKey("meta", locked)), planReviewRunning: null };
        setMeta(cleared);
        await saveKey("meta", cleared);
        setAutoCheck("The weekly plan check couldn't run just now (the AI may be busy). It will try again next time the app is opened.");
      }
    })();
    return () => { cancelled = true; };
  }, [loaded]);

  if (!loaded) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin" style={{ color: C.navy }} size={28} />
      </div>
    );
  }

  const data = { progress, expenses, permissions, contacts, products, documents, issues, gallery, meta, loan, agreement };
  const canSee = (tabKey) => (ROLE_TAB_ACCESS[currentUser?.role] || ROLE_TAB_ACCESS.other).includes(tabKey);

  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      <style>{FONTS}</style>
      <header style={{ background: `linear-gradient(180deg, ${C.navy} 0%, #122841 100%)` }} className="text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <Hammer size={22} style={{ color: C.yellow }} />
            <span style={{ fontFamily: "'Oswald', sans-serif" }} className="text-lg font-semibold tracking-wide uppercase">
              {currentUser?.projectName || "Construction AI Ledger"}
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
              <InstallAppButton />
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
          <nav className="no-scrollbar flex gap-1 overflow-x-auto pb-0 -mb-px">
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
        {tab === "dashboard" && <Dashboard data={data} setTab={setTab} currentUser={currentUser} autoCheck={autoCheck} setMeta={setMeta} />}
        {tab === "progress" && (
          <ProgressTab
            progress={progress} setProgress={setProgress} meta={meta} setMeta={setMeta}
            contacts={contacts} setContacts={setContacts} documents={documents} setDocuments={setDocuments} currentUser={currentUser}
          />
        )}
        {tab === "gallery" && (
          <GalleryTab
            gallery={gallery} setGallery={setGallery}
            progress={progress} expenses={expenses} loan={loan} products={products} documents={documents}
            canSeeTab={canSee} currentUser={currentUser}
          />
        )}
        {tab === "budget" && canSee("budget") && (
          <BudgetTab
            expenses={expenses} setExpenses={setExpenses}
            permissions={permissions} meta={meta} setMeta={setMeta}
            loan={loan} setLoan={setLoan}
            agreement={agreement} setAgreement={setAgreement}
            documents={documents} contacts={contacts} setContacts={setContacts}
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
