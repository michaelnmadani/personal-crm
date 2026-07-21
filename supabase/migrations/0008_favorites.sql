-- Favourite (starred) contacts: a per-contact flag so favourites can be pinned
-- to the top of the contacts list.

alter table public.contacts
  add column favorite boolean not null default false;

-- contacts_overview selects c.* — recreate it so the new column appears.
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

-- Partial index: favourites are a small subset, so index only those rows.
create index contacts_favorite_idx on public.contacts (user_id) where favorite;
