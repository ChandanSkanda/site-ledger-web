// Storage abstraction.
//
// Right now this uses the browser's localStorage, so the app works
// completely standalone (and offline) — good for a single phone/laptop.
//
// When you're ready for you + your brother to see the SAME data from
// different devices, swap the bodies of these two functions to read/write
// Supabase instead (see /supabase/schema.sql for a matching table layout).
// Every screen in App.jsx calls these two functions and nothing else, so
// that's the only file you need to touch to change where data lives.

const PREFIX = "site-ledger:";

export async function loadKey(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveKey(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}
