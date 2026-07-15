-- Harden RLS on child tables: inserting/updating a row that references a contact
-- (or interaction/tag) must also prove ownership of the referenced parent row.
-- Without this, FK checks (which bypass RLS) let user B attach rows to user A's
-- contacts — invisible to A, but still wrong.

drop policy "own rows" on public.family_members;
create policy "own rows" on public.family_members
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

drop policy "own rows" on public.facts;
create policy "own rows" on public.facts
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

drop policy "own rows" on public.interaction_participants;
create policy "own rows" on public.interaction_participants
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
    and exists (select 1 from public.interactions i where i.id = interaction_id and i.user_id = auth.uid())
  );

drop policy "own rows" on public.reminders;
create policy "own rows" on public.reminders
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      contact_id is null
      or exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
    )
  );

drop policy "own rows" on public.relationships;
create policy "own rows" on public.relationships
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = from_contact and c.user_id = auth.uid())
    and exists (select 1 from public.contacts c where c.id = to_contact and c.user_id = auth.uid())
  );

drop policy "own rows" on public.contact_tags;
create policy "own rows" on public.contact_tags
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
