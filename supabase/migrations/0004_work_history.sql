-- Work history per contact (career timeline, backfillable).
create table public.work_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company text not null,
  title text,
  start_year integer,
  end_year integer,
  is_current boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index work_history_contact_idx on public.work_history (contact_id);

alter table public.work_history enable row level security;
create policy "own rows" on public.work_history
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.work_history;
