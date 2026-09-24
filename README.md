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

`api/ai.js` supports two providers — set one as an environment variable
and it just works, no other code changes needed:

- **`GEMINI_API_KEY`** (recommended for testing) — Google's Gemini API has
  a free tier with no credit card required. Grab a key at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and use
  that. If this is set, it's used regardless of whether the key below is
  also set.
- **`ANTHROPIC_API_KEY`** — Claude via the Anthropic API. This is a
  separate, pay-as-you-go product from a Claude.ai/Pro subscription — a
  Pro plan does **not** include API credits. Add a real key from
  [console.anthropic.com](https://console.anthropic.com), then add
  billing credits under Settings → Billing before it'll actually respond.

The simplest path is deploying to **Vercel** (free tier is enough):

1. Push this folder to a GitHub repo.
2. Import it in Vercel.
3. In Vercel's project settings → Environment Variables, add
   `GEMINI_API_KEY` (free) or `ANTHROPIC_API_KEY` (paid) — see above.
4. Deploy. `/api/ai` now works automatically — Vercel treats anything in
   `/api` as a serverless function with no extra config.

To test the AI proxy locally before deploying: `npx vercel dev` (needs a
free Vercel CLI login) runs both the frontend and the `/api` functions
together on your machine — `.env` needs the same key(s) added locally too.

If you'd rather not use Vercel, `api/ai.js` is a plain proxy — port the
same logic into any Node/Express server or another provider's serverless
functions; nothing else in the app needs to change.

## Phase 3 — accounts, projects, and multiple owners (done)

The app now supports real accounts, and ownership is tied to **creating a
project** rather than "whoever signs up first." Here's the model:

- Anyone can sign up (name, email, password) — that just creates an
  account, nothing more.
- After signing up/in, you either **create a project** (give it a name,
  place, and type — e.g. "Whitefield house", "Bangalore", "House
  construction") or **join one** with an invite code someone gives you.
- **Whoever creates a project is automatically its owner.**
- Everyone who joins with a code picks a field role at that point
  (Builder, Carpenter, Civil Engineer, Electrician, Plumber, etc.) — never
  "Owner". Nobody can grant themselves ownership.
- **Promoting someone to co-owner (your brother, a spouse, etc.) happens
  on the owner-only Team tab** — pick their name, change their role
  dropdown to "Owner." That's the "opt him in as owner" flow you asked
  for.

### Setup

1. **Create a free Supabase project** at supabase.com.
2. **Run the schema** — SQL Editor → paste in `supabase/schema.sql` → Run.
   (If you'd already run an older version of this file from before, the
   comment at the top of the file has a one-line command to drop the old
   tables first — safe, since there's no real data yet.)
3. **Get your API keys** — Project Settings → API → copy the Project URL
   and the "anon public" key.
4. **Set environment variables** — locally in `.env` (copy from
   `.env.example`), and in Vercel (Settings → Environment Variables, same
   way as `ANTHROPIC_API_KEY`), then redeploy.
5. `npm install` (pulls in the Supabase client library), then
   `npm run dev` or visit your deployed URL.
6. **Sign up, then create your project first** — you become its owner.
   You'll be shown a 6-character invite code — save it.
7. **Give the invite code to your brother.** He signs up, chooses "Join a
   project," enters the code, and picks a role (any field role — it
   doesn't matter which, since you'll change it next).
8. **Go to the Team tab** (owner-only) and change his role to **Owner**.

From here, both of you see the same live data, and the Audit Log records
every login, join, role change, and data edit with who and when.

### Multiple projects

If someone belongs to only one project, they land straight on its
dashboard — no extra screen. If they belong to more than one (say, a
civil engineer working across two different houses, or you starting a
second property later), they see a project picker after logging in, and
a **"Switch project"** link appears in the header at any time to jump
between them without signing out.

- **Owner** and **Builder / site admin**: everything, including Budget,
  Permissions, Documents. Owner alone sees Team and Audit Log.
- **Builder**: adds People and Products to the shared basics.
- **Civil engineer**: adds People.
- **Carpenter, electrician, plumber, other**: Dashboard, Progress,
  Gallery, Issues only — enough to log their own work.

**Two honest limitations worth knowing:**
- This role split currently only hides tabs in the app's interface — it
  isn't yet enforced at the database level for the app's actual project
  data (kv_store/audit_log). A technically savvy team member could
  theoretically still read budget data by calling Supabase directly.
  Reasonable for a small trusted team; would need real per-role database
  policies before handing this to strangers as a generic product.
- Anyone signed in can look up a project's name/place/type if they
  somehow guess or obtain its invite code — the code itself is the real
  protection (it's random and only shared with people you choose to tell)
  rather than a fully private project list.

Photos are still stored as base64 inside `kv_store` for now — fine for a
handful of photos, but for a lot of daily site photos, move them to
Supabase Storage instead (create a `gallery` bucket and store the file
path rather than the raw image data).

Photos are still stored as base64 inside `kv_store` for now — fine for
a handful of photos, but for a lot of daily site photos you'll want to
move them to Supabase Storage instead (create a `gallery` bucket and
store the file path rather than the raw image data).

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
3. Set up Supabase (Phase 3) so you and your brother share one login-
   protected, synced copy of the data — do this before Phase 4, since
   testing accounts is much faster on the web.
4. Wrap it for Android (Phase 4) once the web version feels done — this
   is deliberately last, since every change is still free and instant on
   the web, but slower to test once it's a compiled native app.
