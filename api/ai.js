// Vercel serverless function: POST /api/ai
// Body: { text: string, images?: string[] (base64 jpegs), useSearch?: boolean }
//
// Supports two providers, tried in this order:
//   1. GEMINI_API_KEY  — Google's Gemini API. Free to use for testing (no
//      credit card needed for the free tier): grab a key at
//      https://aistudio.google.com/apikey and add it as GEMINI_API_KEY.
//   2. ANTHROPIC_API_KEY — Claude via the Anthropic API. This is a paid,
//      pay-as-you-go product, separate from a Claude.ai subscription —
//      see console.anthropic.com/settings/billing to add credits.
//
// Set whichever one you have a key for; if both are set, Gemini is used
// (since it's the free option for testing). Deploy this repo to Vercel and
// add the env var in the project settings — no other setup needed.
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Accept either plain base64 strings (assumed JPEG — the old shape) or
  // { data, mimeType } objects, so a PDF plan upload can be sent as
  // itself instead of being silently dropped.
  const files = images.map((img) =>
    typeof img === "string" ? { data: img, mimeType: "image/jpeg" } : img
  );

  try {
    let out;
    if (geminiKey) {
      try {
        out = await withRetry(() => callGemini({ text, files, useSearch, apiKey: geminiKey }));
      } catch (e) {
        // Gemini still busy after retrying — use Claude instead if a key is set.
        if (anthropicKey && isBusyError(e)) {
          console.warn("Gemini busy, falling back to Anthropic");
          out = await withRetry(() => callAnthropic({ text, files, useSearch, apiKey: anthropicKey }));
        } else {
          throw e;
        }
      }
    } else if (anthropicKey) {
      out = await callAnthropic({ text, files, useSearch, apiKey: anthropicKey });
    } else {
      return res.status(500).json({
        error: "No AI provider configured — set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in your environment variables.",
      });
    }
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

async function callGemini({ text, files, useSearch, apiKey }) {
  const parts = [{ text }];
  files.forEach(({ data, mimeType }) => parts.push({ inlineData: { mimeType: mimeType || "image/jpeg", data } }));

  const body = { contents: [{ parts }] };
  if (useSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const model = "gemini-3.6-flash";
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

async function callAnthropic({ text, files, useSearch, apiKey }) {
  const content = [];
  files.forEach(({ data, mimeType }) => {
    const mt = mimeType || "image/jpeg";
    // Claude takes PDFs as a "document" block, everything else as "image".
    content.push(
      mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: mt, data } }
        : { type: "image", source: { type: "base64", media_type: mt, data } }
    );
  });
  content.push({ type: "text", text });

  const body = {
    model: "claude-sonnet-5",
    max_tokens: 2500,
    messages: [{ role: "user", content }],
  };
  if (useSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    const err = new Error(data?.error?.message || `Anthropic error (${anthropicRes.status})`);
    err.status = anthropicRes.status;
    throw err;
  }
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}
