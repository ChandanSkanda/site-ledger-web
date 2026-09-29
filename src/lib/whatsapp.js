// Reads a WhatsApp "Export chat" file (.zip with media, or plain .txt) and
// turns it into messages grouped by day. Handles both Android and iPhone
// export formats, 12h/24h times, and dd/mm vs mm/dd dates.

import JSZip from "jszip";

// A line that starts a new message: date, time, then (optionally) "- ".
const HEADER_RE =
  /^\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*/i;

const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

function clean(s) {
  return s.replace(/[‎‏‪-‮]/g, "").replace(/[  ]/g, " ");
}

export function parseChatText(raw) {
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

  return msgs
    .filter((x) => x.sender) // drop system lines ("X added Y", encryption notice…)
    .map((x) => {
      const day = dayFirst ? x.a : x.b;
      const month = dayFirst ? x.b : x.a;
      const year = x.y < 100 ? 2000 + x.y : x.y;
      let hour = x.h;
      if (x.ampm.startsWith("p") && hour < 12) hour += 12;
      if (x.ampm.startsWith("a") && hour === 12) hour = 0;
      const pad = (n) => String(n).padStart(2, "0");
      let text = x.text.trim();
      // Attachments: iPhone "<attached: file.jpg>", Android "file.jpg (file attached)".
      const files = [];
      text = text.replace(/<attached:\s*([^>]+)>/gi, (_, f) => { files.push(f.trim()); return ""; });
      text = text.replace(/^([^\n]+?\.[a-z0-9]{2,5})\s*\(file attached\)/gim, (_, f) => { files.push(f.trim()); return ""; });
      const omitted = /<Media omitted>|image omitted/i.test(text);
      text = text.replace(/<Media omitted>|image omitted|<This message was edited>/gi, "").trim();
      return {
        date: `${year}-${pad(month)}-${pad(day)}`,
        time: `${pad(hour)}:${pad(x.min)}`,
        sender: x.sender,
        text,
        photos: files.filter((f) => PHOTO_EXT.test(f)),
        mediaOmitted: omitted,
      };
    });
}

// Opens the export and returns { messages, getPhoto(name) -> Blob|null, hasMedia }.
export async function readWhatsAppExport(file) {
  if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
    return { messages: parseChatText(await file.text()), getPhoto: async () => null, hasMedia: false };
  }
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);
  const txtName = names.find((n) => /_chat\.txt$/i.test(n)) || names.find((n) => /\.txt$/i.test(n));
  if (!txtName) throw new Error("This zip doesn't look like a WhatsApp chat export (no chat .txt file inside).");
  const messages = parseChatText(await zip.file(txtName).async("string"));
  const byBase = {};
  names.forEach((n) => { byBase[n.split("/").pop()] = n; });
  const hasMedia = names.some((n) => PHOTO_EXT.test(n));
  return {
    messages,
    hasMedia,
    getPhoto: async (name) => {
      const path = byBase[name];
      if (!path) return null;
      const blob = await zip.file(path).async("blob");
      return new Blob([blob], { type: /\.png$/i.test(name) ? "image/png" : "image/jpeg" });
    },
  };
}

export function groupByDay(messages) {
  const days = {};
  messages.forEach((m) => { (days[m.date] = days[m.date] || []).push(m); });
  return Object.keys(days).sort().map((date) => ({ date, messages: days[date].sort((x, y) => x.time.localeCompare(y.time)) }));
}
