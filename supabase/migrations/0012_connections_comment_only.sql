-- Connections carry no category or strength any more: a direct link is enough,
-- with an optional free-text comment (the existing `notes` column).
--
-- Any category the user actually chose is folded into the comment first, so
-- dropping the column doesn't silently throw information away. 'knows' was the
-- default and says nothing, so it isn't worth keeping.
update public.relationships
   set notes = relation
 where relation is not null
   and relation <> 'knows'
   and coalesce(notes, '') = '';

alter table public.relationships drop column if exists relation;
alter table public.relationships drop column if exists strength;
