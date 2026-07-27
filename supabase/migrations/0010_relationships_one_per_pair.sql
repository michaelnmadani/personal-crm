-- A connection between two people is inherently mutual: one row means "these
-- two are connected", and both profiles read it from either direction. Adding
-- it again from the other side produced a second row and a doubled edge on the
-- network graph.

-- Collapse any existing reciprocal duplicates, keeping the earliest row (and
-- the strongest tie / most specific relation where they differ).
delete from public.relationships a
using public.relationships b
where least(a.from_contact, a.to_contact) = least(b.from_contact, b.to_contact)
  and greatest(a.from_contact, a.to_contact) = greatest(b.from_contact, b.to_contact)
  and (a.created_at, a.id) > (b.created_at, b.id);

-- One connection per unordered pair, regardless of which way round it was added.
create unique index relationships_unique_pair
  on public.relationships (least(from_contact, to_contact), greatest(from_contact, to_contact));
