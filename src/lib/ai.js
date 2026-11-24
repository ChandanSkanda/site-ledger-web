// Calls our own backend endpoint (/api/ai), which holds the real Anthropic
// API key and talks to Claude on the app's behalf. The API key must never
// be shipped to the browser, which is why this isn't a direct fetch to
// api.anthropic.com like the Claude.ai artifact prototype used.
//
// See /api/ai.js for the server-side implementation.

// "Failed to fetch" / "Load failed" = the request never got an answer (Wi-Fi
// blip, laptop napping, server restarting). Worth a couple of quiet retries.
const isNetworkError = (e) => e instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed/i.test(e?.message || "");

export async function askClaude({ text, images = [], useSearch = false }) {
  const body = JSON.stringify({ text, images, useSearch });
  const waits = [3000, 8000];
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      // Vercel's own timeout / gateway hiccups — also worth one more try.
      if ((res.status === 502 || res.status === 504) && attempt < waits.length) {
        const peek = await res.clone().text().catch(() => "");
        if (res.status === 504 || /high demand|overloaded|unavailable|try again/i.test(peek)) {
          await new Promise((r) => setTimeout(r, waits[attempt]));
          continue;
        }
      }
      break;
    } catch (e) {
      if (attempt >= waits.length || !isNetworkError(e)) {
        throw new Error(isNetworkError(e) ? "Couldn't reach the AI service (network connection dropped). Check your internet and try again." : e.message);
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      try { detail = JSON.parse(body).error || ""; } catch { detail = body.slice(0, 200); }
    } catch {}
    if (res.status === 413) detail = "The files sent were too large for one request.";
    if (res.status === 504) detail = "The AI took too long to answer.";
    throw new Error(`AI request failed (${res.status})${detail ? ": " + detail : ""}`);
  }
  const data = await res.json();
  return data.text || "";
}
