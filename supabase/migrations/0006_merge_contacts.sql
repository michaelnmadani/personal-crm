-- merge_contacts(winner, loser): fold the loser contact into the winner,
-- keeping all information from each, then delete the loser.
-- security invoker → runs with the caller's rights, so RLS still applies and a
-- user can only ever merge their own contacts.
create or replace function public.merge_contacts(winner uuid, loser uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  w public.contacts;
  l public.contacts;
begin
  if winner = loser then raise exception 'cannot merge a contact into itself'; end if;
  select * into w from public.contacts where id = winner;
  select * into l from public.contacts where id = loser;
  if w.id is null or l.id is null then raise exception 'contact not found'; end if;

  -- Merge scalar fields: keep the winner's value, fall back to the loser's.
  update public.contacts set
    last_name          = coalesce(w.last_name, l.last_name),
    nickname           = coalesce(w.nickname, l.nickname),
    company            = coalesce(w.company, l.company),
    title              = coalesce(w.title, l.title),
    location           = coalesce(w.location, l.location),
    website            = coalesce(w.website, l.website),
    linkedin_url       = coalesce(w.linkedin_url, l.linkedin_url),
    photo_url          = coalesce(w.photo_url, l.photo_url),
    birthday           = coalesce(w.birthday, l.birthday),
    met_on             = least(w.met_on, l.met_on),
    keep_in_touch_days = coalesce(w.keep_in_touch_days, l.keep_in_touch_days),
    kind               = case when w.kind = l.kind then w.kind else 'both' end,
    how_we_met         = nullif(concat_ws(' · ', nullif(w.how_we_met, ''), nullif(l.how_we_met, '')), ''),
    summary            = nullif(concat_ws(E'\n\n', nullif(w.summary, ''), nullif(l.summary, '')), ''),
    emails             = coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(w.emails || l.emails) e), '[]'::jsonb),
    phones             = coalesce((select jsonb_agg(distinct p) from jsonb_array_elements(w.phones || l.phones) p), '[]'::jsonb),
    updated_at         = now()
  where id = winner;

  -- Re-point one-to-many children.
  update public.family_members set contact_id = winner where contact_id = loser;
  update public.facts          set contact_id = winner where contact_id = loser;
  update public.work_history   set contact_id = winner where contact_id = loser;
  update public.reminders      set contact_id = winner where contact_id = loser;

  -- Composite-key children: move what won't collide, drop the rest.
  update public.interaction_participants set contact_id = winner
    where contact_id = loser
      and not exists (select 1 from public.interaction_participants x
                      where x.interaction_id = interaction_participants.interaction_id and x.contact_id = winner);
  delete from public.interaction_participants where contact_id = loser;

  update public.group_members set contact_id = winner
    where contact_id = loser
      and not exists (select 1 from public.group_members x
                      where x.group_id = group_members.group_id and x.contact_id = winner);
  delete from public.group_members where contact_id = loser;

  update public.contact_tags set contact_id = winner
    where contact_id = loser
      and not exists (select 1 from public.contact_tags x
                      where x.tag_id = contact_tags.tag_id and x.contact_id = winner);
  delete from public.contact_tags where contact_id = loser;

  -- Relationships: rewrite endpoints, then drop self-loops and duplicates.
  update public.relationships set from_contact = winner where from_contact = loser;
  update public.relationships set to_contact = winner where to_contact = loser;
  delete from public.relationships where from_contact = to_contact;
  delete from public.relationships a using public.relationships b
    where a.ctid > b.ctid
      and least(a.from_contact, a.to_contact) = least(b.from_contact, b.to_contact)
      and greatest(a.from_contact, a.to_contact) = greatest(b.from_contact, b.to_contact);

  delete from public.contacts where id = loser;
end $$;
