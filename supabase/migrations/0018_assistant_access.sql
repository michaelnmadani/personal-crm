-- Assistant access. An assistant such as Meta's Muse reaches the CRM through
-- the crm-mcp edge function, carrying an access key made in Settings. With it,
-- the assistant can find and read contacts, add and update people, the
-- connections between them, meetings and notes. Nothing it can do deletes.
--
-- The key itself is shown once, when it's made, and never stored: only its
-- SHA-256 fingerprint is. The edge function looks a key up by fingerprint, then
-- does everything as the key's owner — under the same row-level security as
-- the app — so a key can never reach further than its owner's own rows.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Where the owner is, so "9:30 this morning" means their 9:30, not UTC's.
  timezone text not null default 'Australia/Sydney' check (length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_tokens_user_idx on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;

create policy "api tokens: read own" on public.api_tokens
  for select using (user_id = auth.uid());

-- The public demo login can't make keys: a key acts as its owner, and the
-- demo is shared with anyone who opens the login page.
create policy "api tokens: add own" on public.api_tokens
  for insert with check (
    user_id = auth.uid()
    and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
  );

create policy "api tokens: change own" on public.api_tokens
  for update
  using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')
  with check (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32');

create policy "api tokens: remove own" on public.api_tokens
  for delete using (user_id = auth.uid() and auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32');

-- What the assistant did, in a line each — shown in Settings, so anything it
-- got wrong can be found and put right. For updates, `changes` keeps what each
-- field was before, so a wrong edit can be undone by hand.
create table public.assistant_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid references public.api_tokens(id) on delete set null,
  tool text not null,
  ok boolean not null,
  summary text not null,
  contact_ids uuid[] not null default '{}',
  changes jsonb,
  created_at timestamptz not null default now()
);

create index assistant_log_user_idx on public.assistant_log (user_id, created_at desc);

alter table public.assistant_log enable row level security;

-- Readable by its owner. Written only by the edge function (as the database
-- owner, after the change itself), so it can't be filled from the browser.
create policy "assistant log: read own" on public.assistant_log
  for select using (user_id = auth.uid());
