// Reads a WhatsApp "Export chat" file (.zip with media, or plain .txt) and
// turns it into messages grouped by day. Handles both Android and iPhone
// export formats, 12h/24h times, and dd/mm vs mm/dd dates.

import { ZipReader, BlobReader, BlobWriter, TextWriter, configure } from "@zip.js/zip.js";

// Runs in the page (no extra worker files needed on Vercel).
configure({ useWebWorkers: false });

// A line that starts a new message: date, time, then (optionally) "- ".
const HEADER_RE =
  /^\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*/i;

const PHOTO_EXT = /\.(jpe?g|png)$/i; // .webp in exports are stickers — ignored
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|dwg|csv|txt)$/i;
const isSticker = (f) => /^STK-|sticker/i.test(f) || /\.webp$/i.test(f);

function clean(s) {
  return s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[\u202f\u00a0]/g, " ");
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const SYSTEM_RE = /(end-to-end encrypted|created this group|created group|joined using this group|changed the (group|subject)|changed this group|changed their phone number|security code (changed|with)|is now an admin|pinned a message|deleted this message)/i;
const MEMBER_RE = /^~?\s*.{1,40}\s(added|removed|left)(\s.{0,60})?$/i;

// Phone exports use the phone's own time zone. The site is in India, so by
// default everything is converted to India time — otherwise a report posted
// on an Indian morning would land on the previous day for someone in the US.
export const SITE_TIME_ZONE = "Asia/Kolkata";
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}
function toZone(y, mo, d, h, mi, zone) {
  const local = new Date(y, mo - 1, d, h, mi); // interpreted in this device's time zone
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(local).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function parseChatText(raw, { convertToSiteTime = true } = {}) {
  const lines = clean(raw).split(/\r?\n/);
  const msgs = [];
  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      const rest = line.slice(m[0].length);
      const colon = rest.indexOf(": ");
      const sender = colon > -1 ? rest.slice(0, colon).replace(/^~\s*/, "").trim() : null;
      const text = colon > -1 ? rest.slice(colon + 2) : rest;
      msgs.push({ a: +m[1], b: +m[2], y: +m[3], h: +m[4], min: +m[5], ampm: (m[7] || "").toLowerCase(), sender, text });
    } else if (msgs.length) {
      msgs[msgs.length - 1].text += "\n" + line;
    }
  }

  // Work out whether dates are day-first (India default) or month-first.
  let dayFirst = true;
  if (msgs.some((x) => x.a > 12)) dayFirst = true;
  else if (msgs.some((x) => x.b > 12)) dayFirst = false;

  // The group itself appears as a "sender" for notices like the encryption banner.
  const groupName = msgs.find((x) => x.sender && SYSTEM_RE.test(x.text))?.sender;
  const convert = convertToSiteTime && deviceTimeZone() && deviceTimeZone() !== SITE_TIME_ZONE;

  return msgs
    .filter((x) => x.sender && x.sender !== groupName) // drop system lines
    .filter((x) => !(x.text.length < 140 && (SYSTEM_RE.test(x.text) || MEMBER_RE.test(x.text.trim()))))
    .map((x) => {
      const day = dayFirst ? x.a : x.b;
      const month = dayFirst ? x.b : x.a;
      const year = x.y < 100 ? 2000 + x.y : x.y;
      let hour = x.h;
      if (x.ampm.startsWith("p") && hour < 12) hour += 12;
      if (x.ampm.startsWith("a") && hour === 12) hour = 0;
      const pad = (n) => String(n).padStart(2, "0");
      const when = convert ? toZone(year, month, day, hour, x.min, SITE_TIME_ZONE) : { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(x.min)}` };
      let text = x.text.trim();
      // Attachments: iPhone "<attached: file.jpg>", Android "file.jpg (file attached)".
      const files = [];
      text = text.replace(/<attached:\s*([^>]+)>/gi, (_, f) => { files.push(f.trim()); return ""; });
      text = text.replace(/^([^\n]+?\.[a-z0-9]{2,5})\s*\(file attached\)/gim, (_, f) => { files.push(f.trim()); return ""; });
      // iPhone exports without media: "Plan.pdf • 4 pages document omitted" — keep the name.
      const omittedDocs = [];
      text = text.replace(/([^\n•]+?\.(?:pdf|docx?|xlsx?|pptx?|dwg))\s*•[^\n]*?document omitted/gi, (_, f) => { omittedDocs.push(f.trim()); return ""; });
      const omitted = /<Media omitted>|image omitted|document omitted/i.test(text) || omittedDocs.length > 0;
      text = text.replace(/<Media omitted>|image omitted|document omitted|video omitted|audio omitted|sticker omitted|<This message was edited>/gi, "").trim();
      const postedDate = when.date;
      // Daily reports often carry their own date ("Date: 27-09-2026",
      // "Date: 27 August 2026", "29 Sept 2026"). If it's within a few days of
      // when it was posted, file the message under that date.
      let date = postedDate;
      let cand = null;
      const rd = text.match(/\bdate\s*[:\-]\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i);
      const rn = text.match(/\bdate\s*[:\-]\s*(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]+([a-z]{3,9})[\s\-\/.,]+(\d{2,4})/i);
      if (rd) {
        const ry = +rd[3] < 100 ? 2000 + +rd[3] : +rd[3];
        cand = `${ry}-${pad(+rd[2])}-${pad(+rd[1])}`; // day-first, as used in India
      } else if (rn && MONTHS[rn[2].toLowerCase().slice(0, rn[2].toLowerCase().startsWith("sept") ? 4 : 3)]) {
        const ry = +rn[3] < 100 ? 2000 + +rn[3] : +rn[3];
        const mo = MONTHS[rn[2].toLowerCase().slice(0, rn[2].toLowerCase().startsWith("sept") ? 4 : 3)];
        cand = `${ry}-${pad(mo)}-${pad(+rn[1])}`;
      }
      if (cand) {
        const diff = Math.abs((new Date(cand) - new Date(postedDate)) / 86400000);
        if (!isNaN(diff) && diff <= 3) date = cand;
      }
      // Leftover "Plan.pdf • 4 pages" text next to an attached document.
      text = text.replace(/[^\n•]+?\.(?:pdf|docx?|xlsx?|pptx?|dwg)\s*•\s*\d+\s*pages?/gi, "").trim();
      const real = files.filter((f) => !isSticker(f));
      return {
        date,
        postedDate,
        time: when.time,
        sender: x.sender,
        text,
        photos: real.filter((f) => PHOTO_EXT.test(f)),
        docs: [...real.filter((f) => DOC_EXT.test(f)), ...omittedDocs],
        mediaOmitted: omitted,
      };
    })
    // Drop messages that were only a sticker / voice note / video.
    .filter((m) => m.text || m.photos.length || m.docs.length || m.mediaOmitted);
}

// Opens the export and returns { messages, getPhoto(name) -> Blob|null, hasMedia }.
export async function readWhatsAppExport(file, opts = {}) {
  if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
    return { messages: parseChatText(await file.text(), opts), getPhoto: async () => null, getFile: async () => null, hasFile: () => false, fileSize: () => 0, hasMedia: false };
  }
  // Reads only the zip's table of contents, then pulls out individual files
  // on demand straight from the file on this device. The whole export is
  // never loaded into memory, so multi-GB exports full of videos are fine —
  // videos and unselected days are simply never read.
  const reader = new ZipReader(new BlobReader(file));
  let entries;
  try {
    entries = await reader.getEntries();
  } catch (e) {
    throw new Error("Couldn't open this zip. Make sure it's the file WhatsApp created (Export chat), not a partly-downloaded copy.");
  }
  // Re-zipping on a Mac adds hidden "__MACOSX/._…" copies — ignore them.
  const real = entries.filter((e) => !e.directory && !e.filename.startsWith("__MACOSX/") && !e.filename.split("/").pop().startsWith("._"));
  const txt = real.find((e) => /_chat\.txt$/i.test(e.filename)) || real.find((e) => /^[^/]*WhatsApp Chat.*\.txt$/i.test(e.filename)) || real.find((e) => /\.txt$/i.test(e.filename));
  if (!txt) throw new Error("This zip doesn't look like a WhatsApp chat export (no chat .txt file inside).");
  const messages = parseChatText(await txt.getData(new TextWriter()), opts);
  const byBase = {};
  real.forEach((e) => { byBase[e.filename.split("/").pop()] = e; });
  const hasMedia = real.some((e) => PHOTO_EXT.test(e.filename) || DOC_EXT.test(e.filename));
  const read = async (name, type) => {
    const entry = byBase[name];
    if (!entry) return null;
    return entry.getData(new BlobWriter(type));
  };
  return {
    messages,
    hasMedia,
    totalSize: file.size,
    hasFile: (name) => !!byBase[name],
    fileSize: (name) => byBase[name]?.uncompressedSize || 0,
    getPhoto: (name) => read(name, /\.png$/i.test(name) ? "image/png" : "image/jpeg"),
    getFile: (name) => read(name, mimeFor(name)),
    close: () => reader.close(),
  };
}

export function mimeFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv", txt: "text/plain", dwg: "application/acad",
  }[ext] || "application/octet-stream";
}

// iPhone exports prefix attachments with a number ("00000127-Soil report.pdf").
export const cleanDocName = (name) => String(name || "").replace(/^-?\d{5,}-/, "");

// Every shared document (PDF, Word, Excel…) with who sent it and when.
// The same file can be listed twice (its name, then the attached copy) — keep one.
export function listDocuments(messages) {
  const out = [];
  messages.forEach((m) => (m.docs || []).forEach((name) => out.push({ name, clean: cleanDocName(name), date: m.postedDate || m.date, time: m.time, sender: m.sender, caption: m.text })));
  const attachedClean = new Set(out.filter((d) => d.name !== d.clean).map((d) => d.clean.toLowerCase()));
  const seen = new Set();
  return out.filter((d) => {
    if (d.name === d.clean && attachedClean.has(d.clean.toLowerCase())) return false; // name-only duplicate of an attached file
    const key = d.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupByDay(messages) {
  const days = {};
  messages.forEach((m) => { (days[m.date] = days[m.date] || []).push(m); });
  return Object.keys(days).sort().map((date) => ({ date, messages: days[date].sort((x, y) => x.time.localeCompare(y.time)) }));
}
