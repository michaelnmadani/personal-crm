-- A "last modified" stamp for each contact.
--
-- contacts.updated_at only moves when the contact row itself is edited, so a
-- person you just wrote a note about would look untouched. What people mean by
-- "modified" is any change to their record, so take the latest of the contact
-- and everything hanging off it.
--
-- Computed in the view rather than kept by triggers so it is right for history
-- that already exists — a trigger would only start counting from today, and on
-- a freshly imported address book that would leave every contact identical.
--
-- contact_tags has no timestamp of its own, so tagging alone doesn't count.
-- Backfilling one would stamp all existing rows with now() and make every
-- contact look modified today, which is worse than leaving it out.

drop view if exists public.contacts_overview;

create view public.contacts_overview
with (security_invoker = true) as
select
  c.*,
  (
    select max(i.happened_at)
    from public.interactions i
    join public.interaction_participants ip on ip.interaction_id = i.id
    where ip.contact_id = c.id
  ) as last_contacted,
  greatest(
    c.updated_at,
    (
      select max(i.updated_at)
      from public.interactions i
      join public.interaction_participants ip on ip.interaction_id = i.id
      where ip.contact_id = c.id
    ),
    (select max(f.created_at) from public.facts f where f.contact_id = c.id),
    (select max(fm.created_at) from public.family_members fm where fm.contact_id = c.id),
    (select max(w.created_at) from public.work_history w where w.contact_id = c.id),
    (select max(r.created_at) from public.reminders r where r.contact_id = c.id),
    (select max(gm.created_at) from public.group_members gm where gm.contact_id = c.id),
    (
      select max(rel.created_at)
      from public.relationships rel
      where rel.from_contact = c.id or rel.to_contact = c.id
    )
  ) as last_modified
from public.contacts c;
