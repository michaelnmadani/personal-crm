-- Voice capture. Things said into the phone land here as drafts and wait to be
-- confirmed before anything touches a contact's timeline or the reminder list.
--
-- Only the words are kept — never audio. And nothing is parsed on the way in:
-- the inbox parses when it is opened, against the moment the words were said.
-- That way an improved parser re-reads every waiting draft, and "yesterday"
-- means the day before you said it, not the day before you got round to it.

create table public.capture_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  raw_text text not null check (length(btrim(raw_text)) > 0),
  -- typed: keyboard (including the keyboard's own mic key); speech: the in-app
  -- talk button; shared: sent in from another app via the share sheet.
  source text not null default 'typed' check (source in ('typed', 'speech', 'shared')),
  -- Made on the phone. A capture retried after a dropped connection carries
  -- the same id, so it lands once instead of twice.
  client_id text not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded')),
  resolved_at timestamptz,
  interaction_id uuid references public.interactions(id) on delete set null,
  reminder_id uuid references public.reminders(id) on delete set null,
  unique (user_id, client_id)
);

create index capture_drafts_pending_idx
  on public.capture_drafts (user_id, captured_at desc)
  where status = 'pending';

alter table public.capture_drafts enable row level security;

-- The same ownership rules as every other table, with the public demo login's
-- read-only rule built in from the start.
create policy "capture drafts: read own" on public.capture_drafts
  for select using (user_id = auth.uid());

create policy "capture drafts: add own" on public.capture_drafts
  for insert with check (
    user_id = auth.uid()
    and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
  );

create policy "capture drafts: change own" on public.capture_drafts
  for update
  using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')
  with check (
    user_id = auth.uid()
    and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
    and (interaction_id is null
      or exists (select 1 from public.interactions i where i.id = interaction_id and i.user_id = auth.uid()))
    and (reminder_id is null
      or exists (select 1 from public.reminders r where r.id = reminder_id and r.user_id = auth.uid()))
  );

create policy "capture drafts: remove own" on public.capture_drafts
  for delete using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32');

-- Dictation mangles names, but consistently: the same name comes out wrong the
-- same way each time. When a draft is confirmed against a different contact
-- than the one guessed, what was heard is remembered against who was meant, so
-- that mishearing resolves by itself next time.
create table public.capture_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  heard text not null check (length(heard) between 1 and 80),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  last_used_at timestamptz not null default now(),
  unique (user_id, heard, contact_id)
);

create index capture_aliases_user_idx on public.capture_aliases (user_id);

alter table public.capture_aliases enable row level security;

create policy "capture aliases: read own" on public.capture_aliases
  for select using (user_id = auth.uid());

create policy "capture aliases: add own" on public.capture_aliases
  for insert with check (
    user_id = auth.uid()
    and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

create policy "capture aliases: change own" on public.capture_aliases
  for update
  using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')
  with check (
    user_id = auth.uid()
    and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

create policy "capture aliases: remove own" on public.capture_aliases
  for delete using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32');

-- A capture made on the phone shows up in an inbox already open on the laptop.
alter publication supabase_realtime add table public.capture_drafts;
