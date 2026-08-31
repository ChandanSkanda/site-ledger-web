// Calls our own backend endpoint (/api/ai), which holds the real Anthropic
// API key and talks to Claude on the app's behalf. The API key must never
// be shipped to the browser, which is why this isn't a direct fetch to
// api.anthropic.com like the Claude.ai artifact prototype used.
//
// See /api/ai.js for the server-side implementation.

export async function askClaude({ text, images = [], useSearch = false }) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, images, useSearch }),
  });
  if (!res.ok) {
    throw new Error(`AI request failed (${res.status})`);
  }
  const data = await res.json();
  return data.text || "";
}
