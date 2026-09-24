// Vercel serverless function: POST /api/ai
// Body: { text: string, images?: string[] (base64 jpegs), useSearch?: boolean }
//
// Uses Google's Gemini API only. Set GEMINI_API_KEY in Vercel's
// environment variables (free key from https://aistudio.google.com/apikey).
//
// If you deploy elsewhere (Netlify, a plain Node/Express server, etc.),
// port this same logic — it's a thin proxy, nothing Vercel-specific except
// the export shape.

// Plan cross-checks send many photos at once and can take a while.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { text, images = [], useSearch = false } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: "Missing 'text'" });
  }

  const geminiKey = process.env.GEMINI_API_KEY;

  // Accept either plain base64 strings (assumed JPEG — the old shape) or
  // { data, mimeType } objects, so a PDF plan upload can be sent as
  // itself instead of being silently dropped.
  const files = images.map((img) =>
    typeof img === "string" ? { data: img, mimeType: "image/jpeg" } : img
  );

  try {
    if (!geminiKey) {
      return res.status(500).json({ error: "No AI provider configured — set GEMINI_API_KEY in your Vercel environment variables." });
    }
    const out = await callGeminiWithFallback({ text, files, useSearch, apiKey: geminiKey });
    return res.status(200).json({ text: out });
  } catch (e) {
    console.error("AI request failed", e);
    return res.status(502).json({ error: e.message || "AI request failed" });
  }
}

// "High demand" / overloaded / rate-limit errors are temporary — worth retrying.
function isBusyError(e) {
  return e?.status === 429 || e?.status === 500 || e?.status === 503 || e?.status === 529 ||
    /high demand|overloaded|unavailable|try again later|rate limit/i.test(e?.message || "");
}

// Try up to 3 times, waiting a little longer each time (about 3s, then 8s).
async function withRetry(fn, waits = [3000, 8000]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= waits.length || !isBusyError(e)) throw e;
      console.warn(`AI busy (attempt ${attempt + 1}), retrying in ${waits[attempt]}ms`);
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

// Gemini only (no paid Anthropic calls). If the main model is busy even
// after retries, try the next model in the list; a model name Google has
// retired (404) is skipped the same way.
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

async function callGeminiWithFallback(args) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      return await withRetry(() => callGemini({ ...args, model }), model === GEMINI_MODELS[0] ? [3000, 8000] : [4000]);
    } catch (e) {
      lastErr = e;
      if (!(isBusyError(e) || e?.status === 404)) throw e;
      console.warn(`Gemini model ${model} unavailable (${e.status}), trying next`);
    }
  }
  throw lastErr;
}

async function callGemini({ text, files, useSearch, apiKey, model = GEMINI_MODELS[0] }) {
  const parts = [{ text }];
  files.forEach(({ data, mimeType }) => parts.push({ inlineData: { mimeType: mimeType || "image/jpeg", data } }));

  const body = { contents: [{ parts }] };
  if (useSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const geminiRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await geminiRes.json();
  if (!geminiRes.ok) {
    const err = new Error(data?.error?.message || `Gemini error (${geminiRes.status})`);
    err.status = geminiRes.status;
    throw err;
  }
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n");
}
