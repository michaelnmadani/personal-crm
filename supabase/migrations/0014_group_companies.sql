-- Map company names onto a group, so several names for the same employer
-- ("Macquarie Group", "Macquarie Bank") collapse into one hub on the network
-- chart instead of standing as separate companies.
--
-- One company name belongs to at most one group, hence the unique on
-- (user_id, company) rather than (user_id, group_id, company).

create table public.group_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  company text not null,
  created_at timestamptz not null default now(),
  unique (user_id, company)
);

create index group_companies_group_idx on public.group_companies (group_id);

alter table public.group_companies enable row level security;

create policy "own rows" on public.group_companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
