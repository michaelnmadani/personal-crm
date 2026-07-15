# Personal CRM — Design & Project Plan

A personal relationship manager that runs on your **phone, Mac, and PC** from a single
codebase. It tracks business and personal connections, keeps a running log of meetings
and notes, sets reminders so nobody falls through the cracks, and visualizes who-knows-who
as an interactive **network graph** to help with networking.

## Confirmed decisions

| Decision | Choice |
|---|---|
| App form | **Progressive Web App (PWA)** — installable on iPhone/Android home screen and as a desktop app on Mac & PC; one codebase, always in sync |
| Frontend | **React + Vite** SPA, Tailwind CSS + shadcn/ui (same stack as AI Image Studio, so it feels familiar) |
| Backend / sync | **Supabase** — hosted Postgres, auth, realtime sync, row-level security (free tier is plenty for one user) |
| Hosting | **Vercel** (free tier) — HTTPS out of the box, required for PWA install & notifications |
| Graph view | **Cytoscape.js** force-directed network graph of contacts and relationships |
| Data entry | Manual entry first-class (fast forms, quick-add), with vCard/CSV import as a later phase |
| Reminders | **Fully in-app** — Today view, badges, and in-app alerts; no push notifications, no email, no external services |

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Any device — installed PWA (phone / Mac / PC / browser)    │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ Contacts  │ │ Timeline │ │ Reminders │ │ Network      │  │
│  │ & Profile │ │ (notes & │ │ & Today   │ │ Graph        │  │
│  │ pages     │ │ meetings)│ │ view      │ │ (Cytoscape)  │  │
│  └─────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬───────┘  │
│        └────────────┴─── shared data layer ──────┘          │
│              (TanStack Query + IndexedDB cache               │
│               → read your data even when offline)           │
└──────────────────────────┬──────────────────────────────────┘
                 HTTPS + realtime WebSocket
┌──────────────────────────┴──────────────────────────────────┐
│  Supabase (cloud)                                            │
│  ┌──────────────┐ ┌───────────────┐ ┌─────────────────────┐ │
│  │ Postgres     │ │ Auth          │ │ Scheduled function  │ │
│  │ (contacts,   │ │ (email login, │ │ (daily: generate    │ │
│  │  notes,      │ │  RLS: only    │ │  birthday & keep-   │ │
│  │  reminders,  │ │  you see your │ │  in-touch reminder  │ │
│  │  edges)      │ │  data)        │ │  rows)              │ │
│  └──────────────┘ └───────────────┘ └─────────────────────┘ │
│  Storage bucket: contact photos                              │
└──────────────────────────────────────────────────────────────┘
```

Why this shape:
- **One codebase, three platforms.** A PWA installs like a native app on iOS/Android
  ("Add to Home Screen") and on Mac/PC (install prompt in Chrome/Edge, or just a browser
  tab). No App Store, no separate Windows/Mac builds.
- **Sync is automatic.** Every device talks to the same Supabase database; add a note on
  your phone after a coffee meeting and it's on your desktop when you sit down.
- **Private by design.** Single-user auth + Postgres row-level security; your relationship
  data never lives on a shared/multi-tenant app you don't control.

## 2. Data model (Postgres)

Everything hangs off `contacts`. All personal details are structured where structure
helps (family members, dates) and free-form where it doesn't (notes).

```sql
contacts
  id            uuid pk
  first_name    text        last_name     text
  nickname      text        photo_url     text
  kind          text        -- 'business' | 'personal' | 'both'
  company       text        title         text
  emails        jsonb       -- [{label:'work', value:'…'}]
  phones        jsonb
  location      text        -- city / where they live
  birthday      date
  how_we_met    text        -- "Intro'd by Sarah at CES 2025"
  met_on        date
  keep_in_touch interval    -- desired contact cadence, e.g. '3 months'
  summary       text        -- free-form "who is this person" blurb
  archived      boolean
  created_at / updated_at

family_members                -- spouse, kids, parents…
  id            uuid pk
  contact_id    uuid → contacts
  relation      text        -- 'spouse' | 'child' | 'parent' | 'sibling' | 'pet' | other
  name          text
  birthdate     date        -- exact if known…
  approx_birth_year int     -- …or just enough to compute "ages ~7 and ~9"
  notes         text        -- "starting college fall 2026"

facts                         -- open-ended personal details
  id            uuid pk
  contact_id    uuid → contacts
  label         text        -- 'Hobby', 'Favorite restaurant', 'Allergy', 'Alma mater'
  value         text

interactions                  -- the meeting/notes timeline
  id            uuid pk
  kind          text        -- 'meeting' | 'call' | 'email' | 'message' | 'event' | 'note'
  happened_at   timestamptz
  location      text
  title         text
  notes         text        -- markdown; the body of your meeting notes
  created_at / updated_at

interaction_participants      -- meetings can include several contacts
  interaction_id uuid → interactions
  contact_id     uuid → contacts

reminders
  id            uuid pk
  contact_id    uuid → contacts (nullable — general reminders allowed)
  due_at        timestamptz
  title         text        -- "Follow up on the proposal"
  notes         text
  recurrence    text        -- null | rrule ('FREQ=MONTHLY;INTERVAL=3')
  status        text        -- 'open' | 'done' | 'snoozed'
  snoozed_until timestamptz
  source        text        -- 'manual' | 'keep_in_touch' | 'birthday'

relationships                 -- the edges of the network graph
  id            uuid pk
  from_contact  uuid → contacts
  to_contact    uuid → contacts
  relation      text        -- 'colleague' | 'friend' | 'family' | 'introduced_me' |
                            -- 'works_with' | 'invested_in' | custom
  strength      int         -- 1–5, drawn as edge thickness
  notes         text        -- "met at Google, now co-founders"

tags            (id, name, color)
contact_tags    (contact_id, tag_id)      -- 'VC', 'college friend', 'Toronto', …
```

Derived, not stored: **last contacted** (max `happened_at` per contact) and
**overdue keep-in-touch** (last contacted + cadence < today) — computed by a view that
powers the Today screen and graph coloring.

## 3. Screens & features

### 3.1 Contact profile — the heart of the app
- Header: photo, name, company/title, tags, kind (business/personal), quick actions
  (call/email links, "log interaction", "add reminder").
- **Personal panel**: spouse & family with auto-computed ages ("Emma — 9, Jack — 6"),
  birthday countdown, facts list (hobbies, favorite restaurant…), how/when you met.
- **Timeline**: reverse-chronological interactions — every meeting, call, and note,
  with markdown rendering. Inline quick-add ("Coffee at Balzac's — she's hiring a
  designer; intro her to Dave").
- **Connections panel**: this person's edges from the graph ("Spouse of Anna K.",
  "Colleague of Raj at Shopify"), each linking to that profile, plus an
  "open in graph" button that centers the network view on them.
- **Keep in touch**: cadence picker; shows "last contacted 5 weeks ago — due in 1 week".

### 3.2 Contacts list
- Fast search (name, company, tag, city — Postgres full-text).
- Filters: business/personal, tag, overdue-for-contact, recently added.
- Sort by last contacted to surface neglected relationships.
- **Quick-add**: name-only creation in two taps; enrich the profile later. Manual entry
  has to be frictionless or the CRM dies.

### 3.3 Today (home screen)
- Due & overdue reminders, birthdays this week (contacts *and* their kids/spouses),
  keep-in-touch contacts who are overdue, and recent notes.
- This is the screen the phone icon opens to — "what should I do about my
  relationships today?"

### 3.4 Meeting notes
- "Log interaction" from anywhere: pick participants (multi-select), kind, date
  (defaults to now), location, markdown notes.
- Checkbox lines in notes ("[ ] send deck") can be promoted to reminders in one tap.
- Full-text search across all notes ("where did I write about the fundraise?").

### 3.5 Reminders
- One-off ("follow up Tuesday"), recurring (rrule: "ping every 3 months"), and
  auto-generated (birthdays, keep-in-touch cadence — created by a daily Supabase
  scheduled edge function that inserts reminder rows).
- Complete / snooze (1d, 1w, custom) from the Today list.
- **Everything surfaces in-app — no push notifications, no email**:
  - The **Today view is the alert center**: due & overdue reminders sit at the top,
    grouped Today / Overdue / Upcoming, and it's the screen the app opens to.
  - **Badge counts** on the Reminders tab and on the installed app icon
    (PWA badging API on desktop) show how many items are due at a glance.
  - Overdue items get a persistent banner on every screen until completed or snoozed —
    impossible to miss while you're in the app, invisible when you're not.
  - Contacts overdue for keep-in-touch are highlighted in the list and haloed in the
    graph, so the nudge is ambient rather than interruptive.

### 3.6 Network graph (Cytoscape.js)
- **Nodes** = contacts. Size = interaction count (your actual relationship weight),
  color = tag/group or business-vs-personal, photo avatars at high zoom, halo on
  contacts overdue for keep-in-touch.
- **Edges** = `relationships`. Thickness = strength, style/color by relation type,
  hover shows the note ("met at Google, co-founders").
- Layouts: force-directed (default, clusters emerge naturally) and concentric
  ("me" in the center, ordered by closeness).
- **Networking tools**:
  - *Filter/isolate*: show only "VC" tag, only Toronto, only people met in 2026.
  - *Cluster view*: communities (college, ex-Shopify, family) become visible blobs —
    reveals which worlds you bridge and which are siloed.
  - *Path finding*: pick two people → shortest path — "who can introduce me to X?"
  - *Broker score*: highlights contacts who connect otherwise-separate clusters —
    your most valuable networking nodes.
- Click node → profile side panel; drag between two nodes → create a relationship edge.
- Fully touch-friendly (pinch zoom, tap) so it works on the phone too.

## 4. Cross-platform & offline behavior

| Concern | Approach |
|---|---|
| Install on iPhone/Android | PWA manifest + service worker → "Add to Home Screen"; runs full-screen like a native app |
| Install on Mac & PC | Chrome/Edge "Install app" → dock/taskbar icon, own window; also works as a plain browser tab |
| Sync | Online-first via Supabase; realtime subscription pushes changes to other open devices instantly |
| Offline | Service worker caches the app shell; TanStack Query persists data to IndexedDB → you can **read** contacts/notes offline (e.g., on a plane); writes queue and flush on reconnect (last-write-wins is fine for one user) |
| Responsive UI | Phone: bottom tab bar (Today / Contacts / Add / Graph / Reminders). Desktop: sidebar + two-pane (list + profile) with room for the graph |

## 5. Privacy & security
- Supabase Auth (email + password or magic link), single account.
- **Row-level security on every table** (`user_id = auth.uid()`) — enforced in the
  database, not just the app.
- Contact photos in a private storage bucket behind signed URLs.
- One-click **export** (JSON + CSV) so your relationship data is never locked in;
  doubles as backup.

## 6. Build phases

**Phase 1 — usable CRM (MVP)**
Supabase schema + auth + RLS · contacts CRUD with quick-add · profile page with family,
facts, tags · interactions timeline with markdown notes · manual reminders + Today view ·
responsive layout · PWA install · deploy to Vercel.

**Phase 2 — the graph**
Relationships CRUD (from profile and by drag-in-graph) · Cytoscape network view with
force layout, filters, node sizing/coloring · profile ↔ graph navigation.

**Phase 3 — proactive & polished**
Keep-in-touch cadences + auto reminders + birthday reminders (daily edge function) ·
app-icon badge counts + overdue banner · full-text search everywhere · offline read cache.

**Phase 4 — power features**
vCard/CSV import (phone contacts, LinkedIn export) · path finding & broker scores
in the graph · data export/backup.

## 7. Repo layout (new repository, e.g. `personal-crm`)

```
personal-crm/
  src/
    app/            # routes: today, contacts, contact/[id], graph, reminders, settings
    components/     # profile panels, timeline, quick-add, reminder list…
    graph/          # Cytoscape wrapper, layouts, filters, path-finding
    lib/            # supabase client, query hooks, rrule helpers, date/age utils
    pwa/            # manifest, service worker, app-icon badging
  supabase/
    migrations/     # SQL schema above
    functions/      # daily-reminders (birthday + keep-in-touch row generation)
  index.html  vite.config.ts  tailwind.config.ts
```

Estimated cost to run: **$0/month** (Supabase free tier + Vercel free tier are far more
than a single-user CRM needs).
