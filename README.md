# Personal CRM

A private, single-user relationship manager for your Mac, PC, and phone. Contacts with
personal details (family, facts, how you met), a meeting-notes timeline, in-app reminders
with keep-in-touch cadences — and, coming in Phase 2, a network graph of who-knows-who.

Ships as a **native desktop app** that installs and updates itself, plus an installable
web app (PWA) for phones.

Full design: [PLAN.md](PLAN.md)

## Install (desktop)

Download the latest installer from the [Releases](../../releases) page:

- **Mac**: `Personal CRM-<version>-universal.dmg` — open it and drag the app to Applications.
- **Windows**: `Personal CRM Setup <version>.exe` — run it.

The app updates itself automatically: when a new version is published it downloads in the
background and prompts you to restart. (See [RELEASING.md](RELEASING.md) for how releases
are built and the one-time macOS signing setup for silent Mac updates.)

## Install (phone)

Open the hosted URL in Safari/Chrome → Share → **Add to Home Screen**.

## Stack

- **Desktop shell**: Electron + electron-builder, auto-update via electron-updater / GitHub Releases
- **Frontend**: React + Vite + TypeScript, Tailwind CSS, TanStack Query
- **Backend**: Supabase (Postgres + Auth + Realtime), row-level security on every table

## Backend setup (one time)

1. In your Supabase project, run the SQL in `supabase/migrations/` in order
   (`0001` … `0003`) via the SQL editor.
2. `cp .env.example .env.local` and fill in your project URL and publishable/anon key.
   These are also baked into release builds via `.env.production`.

First launch: create your account on the sign-in screen — it's your private database, one
account, enforced by RLS. Optionally disable further signups in Supabase (Auth → Providers)
once your account exists.

## Development

- `npm install` — install dependencies
- `npm run dev` — web dev server at http://localhost:5173
- `npm run electron:dev` — desktop app with hot reload
- `npm run build` — typecheck + web production build to `dist/`
- `npm run electron:pack` — build an unpacked desktop app into `release/` (quick smoke test)
- `npm run electron:dist` — build a full installer into `release/` (current OS only)
- `npm run icons` — regenerate app icons (no dependencies)

Releasing new versions: see [RELEASING.md](RELEASING.md).
