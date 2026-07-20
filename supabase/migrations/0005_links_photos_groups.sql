-- Website/LinkedIn links + photo on contacts; groups (church, teams, companies…)
-- with memberships; private storage bucket for contact photos.

alter table public.contacts
  add column website text,
  add column linkedin_url text,
  add column photo_url text; -- storage path in the contact-photos bucket

-- contacts_overview selects c.* — recreate it so the new columns appear.
drop view public.contacts_overview;
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

-- ------------------------------------------------------------------- groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'other'
    check (type in ('company', 'church', 'sports', 'school', 'club', 'nonprofit', 'family', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);

create index group_members_contact_idx on public.group_members (contact_id);

alter table public.groups enable row level security;
create policy "own rows" on public.groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.group_members enable row level security;
create policy "own rows" on public.group_members
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.groups g where g.id = group_id and g.user_id = auth.uid())
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.groups, public.group_members;

-- ------------------------------------------------------------ photo storage
-- Private bucket; app displays photos via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('contact-photos', 'contact-photos', false)
on conflict (id) do nothing;

-- Each user's photos live under a folder named by their user id.
create policy "own contact photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'contact-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'contact-photos' and (storage.foldername(name))[1] = auth.uid()::text);
