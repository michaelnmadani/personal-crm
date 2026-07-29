-- A follow-up set while logging a timeline entry belongs to that entry: it is
-- how the entry gets shown with the promise made at the time. Keep the link so
-- the profile can put the two together, and let the reminder outlive a deleted
-- entry rather than disappearing with it — the commitment is still real.

alter table public.reminders add column interaction_id uuid references public.interactions(id) on delete set null;

create index if not exists reminders_interaction_id_idx on public.reminders (interaction_id);
