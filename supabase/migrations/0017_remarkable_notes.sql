-- reMarkable notes inbox.
--
-- A sync job (github.com/michaelnmadani/Remarkable) reads handwritten pages off
-- the reMarkable tablet, has Claude transcribe them, and logs every page here —
-- the generic log. Each note carries a *recommended* contact, but nothing is
-- attached to anyone until it is approved in the app: approving (with the
-- recommendation, or a contact picked instead) turns the note into an ordinary
-- timeline entry via approve_remarkable_note().
--
-- The sync job writes with the service role, so it needs no insert policy;
-- people only ever read and review. The pipeline's own bookkeeping tables
-- (documents seen, meeting sheets uploaded, the tablet's device token) have RLS
-- on and no policies at all: only the service role can touch them.

-- ------------------------------------------------------------------- notes
create table public.remarkable_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- where the page came from
  source text not null check (source in ('cloud', 'email')),
  -- stable identity of the page, so re-syncing updates rather than duplicates:
  -- 'cloud:<document id>:<page id>' or 'email:<message id>:<part>:<page>'
  source_key text not null,
  document_id text,
  page_id text,
  document_name text,
  folder_path text,
  page_number integer,
  image_path text, -- storage path in the remarkable-pages bucket

  -- what's on it
  title text,
  transcription text, -- markdown
  summary text,
  remember text,      -- takeaways / follow-ups; becomes interactions.remember
  note_type text,
  people_mentioned jsonb not null default '[]'::jsonb,

  -- when it was written, and the calendar event it belongs to (if any)
  written_at timestamptz,
  event_uid text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  event_attendees jsonb not null default '[]'::jsonb, -- [{name, email}]

  -- the recommendation: ranked candidates, best first
  -- [{contact_id, name, detail, score, reasons: [text]}]
  suggestions jsonb not null default '[]'::jsonb,
  recommended_contact_id uuid references public.contacts(id) on delete set null,

  -- review
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'logged', 'dismissed', 'error')),
  approved_contact_ids uuid[] not null default '{}',
  interaction_id uuid references public.interactions(id) on delete set null,
  reviewed_at timestamptz,
  -- bumped when a page is written on again after it was logged
  revision integer not null default 1,
  content_hash text,
  attempts integer not null default 0,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create index remarkable_notes_review_idx on public.remarkable_notes (user_id, status, written_at desc);
create index remarkable_notes_recent_idx on public.remarkable_notes (user_id, created_at desc);
create index remarkable_notes_interaction_idx on public.remarkable_notes (interaction_id);

create trigger remarkable_notes_updated before update on public.remarkable_notes
  for each row execute function public.set_updated_at();

alter table public.remarkable_notes enable row level security;

create policy "select own rows" on public.remarkable_notes
  for select using (user_id = auth.uid());
create policy "update own rows" on public.remarkable_notes
  for update using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'::uuid)
  with check (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'::uuid);
create policy "delete own rows" on public.remarkable_notes
  for delete using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'::uuid);

-- New notes appear in an open inbox without a refresh (RLS still applies).
alter publication supabase_realtime add table public.remarkable_notes;

-- --------------------------------------------------------------- sync runs
-- One row per job run, readable in the app so "when did it last sync, and did
-- it work?" has an answer without opening GitHub.
create table public.remarkable_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  stats jsonb not null default '{}'::jsonb,
  error text
);

create index remarkable_sync_runs_user_idx on public.remarkable_sync_runs (user_id, started_at desc);

alter table public.remarkable_sync_runs enable row level security;

create policy "select own rows" on public.remarkable_sync_runs
  for select using (user_id = auth.uid());

-- ----------------------------------------------- pipeline bookkeeping (private)
-- Documents seen in the reMarkable cloud: which pages were already read, so
-- only pages that changed are transcribed again.
create table public.remarkable_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text not null,
  name text,
  folder_path text,
  file_type text,
  version integer,
  modified_client timestamptz,
  page_hashes jsonb not null default '{}'::jsonb, -- {page id: sha256 of its strokes}
  meeting_event_key text,
  skipped text,
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

-- Calendar events already put on the tablet as pre-filled meeting pages.
create table public.remarkable_meeting_sheets (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null, -- iCal UID + start, so each occurrence of a recurring meeting is its own sheet
  event_uid text not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  attendees jsonb not null default '[]'::jsonb,
  document_id text,
  document_name text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

-- The tablet's cloud device token. Never readable from the app.
create table public.remarkable_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_token text not null,
  registered_at timestamptz not null default now()
);

alter table public.remarkable_documents enable row level security;
alter table public.remarkable_meeting_sheets enable row level security;
alter table public.remarkable_credentials enable row level security;
revoke all on public.remarkable_documents from anon, authenticated;
revoke all on public.remarkable_meeting_sheets from anon, authenticated;
revoke all on public.remarkable_credentials from anon, authenticated;

-- ------------------------------------------------------------ page images
-- Private bucket; the app shows the handwriting through short-lived signed URLs.
-- Each user's pages live under a folder named by their user id.
insert into storage.buckets (id, name, public)
values ('remarkable-pages', 'remarkable-pages', false)
on conflict (id) do nothing;

create policy "read own remarkable pages" on storage.objects
  for select to authenticated
  using (bucket_id = 'remarkable-pages' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- approval
-- Attach a note to one or more contacts as a timeline entry, in one
-- transaction. Approving a note that was approved before (its page was
-- written on again since) updates the same timeline entry instead of adding a
-- second one. security invoker → RLS applies exactly as for the app's own writes.
create or replace function public.approve_remarkable_note(
  p_note_id uuid,
  p_contact_ids uuid[],
  p_kind text default 'meeting',
  p_title text default null,
  p_happened_at timestamptz default null,
  p_location text default null,
  p_notes text default null,
  p_remember text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n public.remarkable_notes;
  v_interaction uuid;
begin
  if p_contact_ids is null or cardinality(p_contact_ids) = 0 then
    raise exception 'Pick at least one contact to attach this note to';
  end if;

  select * into n from public.remarkable_notes where id = p_note_id for update;
  if n.id is null then
    raise exception 'Note not found';
  end if;

  v_interaction := n.interaction_id;
  if v_interaction is not null and exists (select 1 from public.interactions where id = v_interaction) then
    update public.interactions set
      kind = p_kind,
      title = p_title,
      happened_at = coalesce(p_happened_at, happened_at),
      location = p_location,
      notes = p_notes,
      remember = p_remember
    where id = v_interaction;

    delete from public.interaction_participants
    where interaction_id = v_interaction and not (contact_id = any (p_contact_ids));
  else
    insert into public.interactions (kind, happened_at, title, location, notes, remember)
    values (p_kind, coalesce(p_happened_at, n.written_at, now()), p_title, p_location, p_notes, p_remember)
    returning id into v_interaction;
  end if;

  insert into public.interaction_participants (interaction_id, contact_id)
  select v_interaction, c from unnest(p_contact_ids) as c
  on conflict do nothing;

  update public.remarkable_notes set
    status = 'approved',
    approved_contact_ids = p_contact_ids,
    interaction_id = v_interaction,
    reviewed_at = now(),
    title = p_title,
    transcription = p_notes,
    remember = p_remember,
    error = null
  where id = p_note_id;

  return v_interaction;
end $$;

revoke execute on function public.approve_remarkable_note(uuid, uuid[], text, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.approve_remarkable_note(uuid, uuid[], text, text, timestamptz, text, text, text) to authenticated;
