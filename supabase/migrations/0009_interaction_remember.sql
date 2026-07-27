-- Per-timeline-entry "items to remember": a distinct field for key takeaways
-- and follow-up items, separate from the free-form notes about what happened.
alter table public.interactions
  add column remember text;
