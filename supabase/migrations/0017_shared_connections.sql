-- Staging for names parsed out of a pasted LinkedIn "shared connections" list.
-- A parsed name is a claim, not a fact, until reviewed — nothing here writes to
-- `relationships` on its own; every row needs an explicit confirm/create/ignore.
create table public.shared_connection_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  raw_name text not null,
  headline text,
  matched_contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'ignored')),
  parsed_at timestamptz not null default now(),
  unique (contact_id, raw_name)
);

create index shared_connection_candidates_contact_idx on public.shared_connection_candidates (contact_id);

alter table public.shared_connection_candidates enable row level security;
create policy "own rows" on public.shared_connection_candidates
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.shared_connection_candidates;

-- Confirmed shared-connection matches are recorded as ordinary `relationships`
-- rows (already rendered on the Network graph) rather than a parallel edge
-- table — `source` is the only new thing they need to carry.
alter table public.relationships
  add column source text not null default 'manual' check (source in ('manual', 'linkedin_shared'));

create extension if not exists pg_trgm with schema extensions;

create index contacts_name_trgm_idx on public.contacts
  using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) extensions.gin_trgm_ops);

-- Ranked fuzzy-match candidates for the review table's "suggested match" column.
-- security invoker so it runs under the caller's RLS context; the explicit
-- user_id filter is defense in depth, same style as the rest of this schema.
create or replace function public.match_contacts_by_name(p_query text, p_limit int default 5)
returns table (id uuid, first_name text, last_name text, company text, score real)
language sql stable security invoker as $$
  select c.id, c.first_name, c.last_name, c.company,
         similarity(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''), p_query) as score
  from public.contacts c
  where c.user_id = auth.uid()
    and similarity(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''), p_query) > 0.15
  order by score desc
  limit p_limit
$$;
