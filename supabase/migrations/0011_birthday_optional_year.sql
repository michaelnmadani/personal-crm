-- Birthdays where you know the day but not the year.
-- The column stays a real date (so month/day maths and indexes keep working);
-- when the year is unknown it's stored as the sentinel 2000 (a leap year, so
-- 29 Feb is representable) and this flag records that the year is meaningless.
alter table public.contacts
  add column birthday_has_year boolean not null default true;

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
