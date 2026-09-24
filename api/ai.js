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
      out = await callGemini({ text, files, useSearch, apiKey: geminiKey });
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
    throw new Error(data?.error?.message || `Gemini error (${geminiRes.status})`);
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
    max_tokens: 1000,
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
    throw new Error(data?.error?.message || `Anthropic error (${anthropicRes.status})`);
  }
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}
