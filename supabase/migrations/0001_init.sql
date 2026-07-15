-- Personal CRM — initial schema
-- Every table carries user_id (defaulted to auth.uid()) and is protected by RLS,
-- so isolation is enforced in the database, not the app.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- contacts
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text,
  nickname text,
  kind text not null default 'business' check (kind in ('business', 'personal', 'both')),
  company text,
  title text,
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  location text,
  birthday date,
  how_we_met text,
  met_on date,
  keep_in_touch_days integer check (keep_in_touch_days > 0),
  summary text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------- family members & facts
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  relation text not null default 'other'
    check (relation in ('spouse', 'partner', 'child', 'parent', 'sibling', 'pet', 'other')),
  name text not null,
  birthdate date,
  approx_birth_year integer,
  notes text,
  created_at timestamptz not null default now()
);

create table public.facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  label text not null,
  value text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ interactions
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'meeting'
    check (kind in ('meeting', 'call', 'email', 'message', 'event', 'note')),
  happened_at timestamptz not null default now(),
  location text,
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interaction_participants (
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (interaction_id, contact_id)
);

-- --------------------------------------------------------------- reminders
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  due_at timestamptz not null,
  title text not null,
  notes text,
  recurrence_days integer check (recurrence_days > 0),
  status text not null default 'open' check (status in ('open', 'done')),
  snoozed_until timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'keep_in_touch', 'birthday')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- --------------------------------------- relationships (graph — Phase 2 UI)
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_contact uuid not null references public.contacts(id) on delete cascade,
  to_contact uuid not null references public.contacts(id) on delete cascade,
  relation text not null default 'knows',
  strength integer not null default 3 check (strength between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  check (from_contact <> to_contact)
);

-- -------------------------------------------------------------------- tags
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  unique (user_id, name)
);

create table public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (contact_id, tag_id)
);

-- ----------------------------------------------------------------- indexes
create index contacts_user_idx on public.contacts (user_id, archived);
create index family_contact_idx on public.family_members (contact_id);
create index facts_contact_idx on public.facts (contact_id);
create index interactions_user_time_idx on public.interactions (user_id, happened_at desc);
create index ip_contact_idx on public.interaction_participants (contact_id);
create index reminders_user_due_idx on public.reminders (user_id, status, due_at);
create index relationships_from_idx on public.relationships (from_contact);
create index relationships_to_idx on public.relationships (to_contact);

-- ------------------------------------------------------- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger interactions_updated before update on public.interactions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- views
-- Contacts plus derived "last contacted" (runs with caller's rights → RLS applies)
create view public.contacts_overview
with (security_invoker = true) as
select
  c.*,
  (
    select max(i.happened_at)
    from public.interactions i
    join public.interaction_participants ip on ip.interaction_id = i.id
    where ip.contact_id = c.id
  ) as last_contacted
from public.contacts c;

-- --------------------------------------------------------------------- RLS
alter table public.contacts enable row level security;
alter table public.family_members enable row level security;
alter table public.facts enable row level security;
alter table public.interactions enable row level security;
alter table public.interaction_participants enable row level security;
alter table public.reminders enable row level security;
alter table public.relationships enable row level security;
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;

create policy "own rows" on public.contacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.family_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.facts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.interactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.interaction_participants
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.reminders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.relationships
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.contact_tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- realtime
-- Publish changes so other open devices refresh instantly (RLS still applies).
alter publication supabase_realtime add table
  public.contacts, public.family_members, public.facts, public.interactions,
  public.interaction_participants, public.reminders, public.relationships,
  public.tags, public.contact_tags;
