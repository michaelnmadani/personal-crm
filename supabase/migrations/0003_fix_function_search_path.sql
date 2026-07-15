-- Pin search_path on the trigger function (Supabase security lint 0011).
alter function public.set_updated_at() set search_path = '';
