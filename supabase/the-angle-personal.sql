begin;
alter table public.angles drop constraint if exists angles_category_check;
alter table public.angles add constraint angles_category_check check (
  category in ('Former team', 'Head-to-head history', 'Rivalry / rematch', 'Milestone / comeback', 'Birthday', 'Public life event', 'Other')
);
notify pgrst, 'reload schema';
commit;
