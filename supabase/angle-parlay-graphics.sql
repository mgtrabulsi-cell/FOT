begin;
alter table public.angles add column if not exists parlay_graphic jsonb;
grant update(parlay_graphic) on public.angles to authenticated;
alter table public.angles drop constraint if exists angles_parlay_graphic;
alter table public.angles add constraint angles_parlay_graphic check (
  parlay_graphic is null or coalesce((
    jsonb_typeof(parlay_graphic)='object'
    and parlay_graphic->>'version'='1'
    and parlay_graphic->>'title' in ('PARLAY','SAME GAME PARLAY','CROSS GAME PARLAY')
    and jsonb_typeof(parlay_graphic->'legs')='array'
    and jsonb_array_length(parlay_graphic->'legs') between 2 and 8
    and parlay_graphic->>'pickId' is not null
    and parlay_graphic->>'image_path' is not null
    and parlay_graphic->>'image_path'=any(image_paths)
    and picks @> jsonb_build_array(jsonb_build_object('id',parlay_graphic->>'pickId','category','parlay'))
  ),false)
);
notify pgrst,'reload schema';
commit;
