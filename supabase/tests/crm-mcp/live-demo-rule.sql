-- The live database's demo rule (not in the repo's migrations): the public demo
-- login can read its own rows but write nothing. Mirrored here as restrictive
-- policies, which have the same effect as the live per-command policies.
do $$
declare t text;
begin
  foreach t in array array['contacts','family_members','facts','interactions','interaction_participants','reminders',
                           'relationships','tags','contact_tags','work_history','groups','group_members','group_companies']
  loop
    execute format($f$create policy "demo read-only (insert)" on public.%I as restrictive for insert
      with check (auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')$f$, t);
    execute format($f$create policy "demo read-only (update)" on public.%I as restrictive for update
      using (auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')$f$, t);
    execute format($f$create policy "demo read-only (delete)" on public.%I as restrictive for delete
      using (auth.uid() <> 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32')$f$, t);
  end loop;
end $$;
