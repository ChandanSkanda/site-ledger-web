# Site Ledger — construction tracker

Started from the Claude.ai artifact prototype. This is a real, standalone
project you can run, deploy, and eventually wrap into an Android app.

## What's here right now

- A working React + Vite + Tailwind web app (`src/App.jsx` — all the tabs:
  Dashboard, Progress, Gallery, Budget, Permissions, People, Products,
  Documents, Issues).
- Data is saved to the browser's `localStorage` (`src/lib/storage.js`) —
  works fully offline, one device at a time.
- AI features (photo review, price checking, plan cross-check) call your
  own backend endpoint (`/api/ai`, implemented in `api/ai.js`), which holds
  the real Anthropic API key server-side. The Claude.ai prototype called
  Anthropic directly from the browser — that only worked there because
  Claude.ai injected the key invisibly. A real deployed site can't do that
  safely, so this proxy step is required.

## Phase 1 — get it running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Everything works except the AI buttons
(no backend running yet locally) — the rest of the app (logging progress,
expenses, contacts, permissions, products, documents, issues) is fully
usable as-is.

## Phase 2 — turn on the AI features

The simplest path is deploying to **Vercel** (free tier is enough):

1. Push this folder to a GitHub repo.
2. Import it in Vercel.
3. In Vercel's project settings, add an environment variable
   `ANTHROPIC_API_KEY` with a real key from console.anthropic.com.
4. Deploy. `/api/ai` now works automatically — Vercel treats anything in
   `/api` as a serverless function with no extra config.

To test the AI proxy locally before deploying: `npx vercel dev` (needs a
free Vercel CLI login) runs both the frontend and the `/api` functions
together on your machine.

If you'd rather not use Vercel, `api/ai.js` is a plain proxy — port the
same logic into any Node/Express server or another provider's serverless
functions; nothing else in the app needs to change.

## Phase 3 — sync data between you and your brother

Right now data lives in one browser's `localStorage`, so it won't show up
on his phone. When you're ready:

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in its SQL editor.
3. Add Supabase auth (email/password or magic link is enough for two
   users) and a `project_id` you both belong to.
4. Rewrite `loadKey`/`saveKey` in `src/lib/storage.js` to read/write the
   `records` table instead of `localStorage`, filtered by `project_id`
   and `collection`. Nothing in `App.jsx` needs to change — every screen
   only calls those two functions.
5. Move gallery photos from base64-in-JSON to Supabase Storage, and save
   the storage path in the record instead.

This is the point where "single user" naturally becomes "a small team",
if you ever do make it generic for other homeowners later — each house
becomes its own `project_id`.

## Phase 4 — package it as an Android app

Once the website is live at a real URL and you're happy with it, wrap it
with **Capacitor** (the standard way to turn a web app into an installable
Android app without a rewrite):

```bash
npm install @capacitor/core @capacitor/android
npx cap init "Site Ledger" "com.yourname.siteledger"
npm run build
npx cap add android
npx cap copy
npx cap open android
```

That last command opens Android Studio with a real native project wrapping
your built site. From there:

- Add the **Camera** permission in `android/app/src/main/AndroidManifest.xml`
  so the gallery upload can use the phone camera directly, not just the
  file picker.
- Set your app icon and splash screen (Android Studio's Asset Studio, or
  `@capacitor/assets` to generate them from one image).
- `npx cap sync` after any future `npm run build`, to push web changes
  into the native shell.
- Build a signed release APK/AAB from Android Studio's Build menu when
  you're ready to install it on your brother's phone directly (APK) or
  publish to the Play Store (AAB).

You do not need to rewrite anything in React for this step — Capacitor
just puts your built website inside a native wrapper with access to phone
APIs (camera, contacts-dialer, storage) as needed.

## Suggested order

1. Get Phase 1 running and use it for real for a week — log actual
   progress, expenses, and contacts. See what's missing.
2. Deploy (Phase 2) so the AI features work and you can use it from your
   phone's browser on-site.
3. Add Supabase sync (Phase 3) once you and your brother are both
   actively using it.
4. Wrap it for Android (Phase 4) once the web version feels done — this
   is deliberately last, since every change is still free and instant on
   the web, but slower to test once it's a compiled native app.
