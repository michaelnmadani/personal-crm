-- Employment history can be pasted straight off a LinkedIn profile and parsed
-- into entries. The parser reads years out of the period so the existing
-- start_year / end_year / is_current columns keep working, but the period is
-- also kept exactly as it was pasted: "Mar 2019 - Present" carries a month that
-- the year columns can't hold, and nothing from the paste should be lost.

alter table public.work_history add column raw_period text;
