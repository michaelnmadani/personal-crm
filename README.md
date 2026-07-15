# Personal CRM

A private, single-user relationship manager that runs on your phone, Mac, and PC as an
installable PWA. Contacts with personal details (family, facts, how you met), a meeting-notes
timeline, in-app reminders with keep-in-touch cadences — and, coming in Phase 2, a network
graph of who-knows-who.

Full design: [PLAN.md](PLAN.md)

## Stack

- **Frontend**: React + Vite + TypeScript, Tailwind CSS, TanStack Query, installable PWA
- **Backend**: Supabase (Postgres + Auth + Realtime), row-level security on every table
- **Hosting**: Vercel (static build)

## Setup

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` against it
   (SQL editor or `supabase db push`).
2. `cp .env.example .env.local` and fill in your project URL and publishable/anon key.
3. `npm install && npm run dev`

First visit: create your account on the sign-in screen (it's your private database —
one account, enforced by RLS). Optionally disable further signups in Supabase
(Auth → Providers) once your account exists.

## Install on your devices

- **iPhone/Android**: open the deployed URL → Share → "Add to Home Screen"
- **Mac/PC**: open it in Chrome or Edge → install icon in the address bar

## Scripts

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build to `dist/`
- `npm run icons` — regenerate PWA icons (no dependencies)
