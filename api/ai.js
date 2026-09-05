// Vercel serverless function: POST /api/ai
// Body: { text: string, images?: string[] (base64 jpegs), useSearch?: boolean }
//
// Deploy this repo to Vercel, add an ANTHROPIC_API_KEY environment variable
// in the project settings, and this route works with no other setup.
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

  const content = [];
  images.forEach((data) =>
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })
  );
  content.push({ type: "text", text });

  const body = {
    model: "claude-sonnet-5",
    max_tokens: 1000,
    messages: [{ role: "user", content }],
  };
  if (useSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error("Anthropic error", data);
      return res.status(502).json({
        error: "AI provider error",
        debug: {
          anthropicStatus: anthropicRes.status,
          anthropicBody: data,
          hasKey: !!process.env.ANTHROPIC_API_KEY,
          keyPrefix: (process.env.ANTHROPIC_API_KEY || "").slice(0, 7),
        },
      });
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n\n");
    return res.status(200).json({ text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "AI request failed" });
  }
}
