begin;
do $$
begin
  assert has_column_privilege('authenticated','public.angles','post_to_x','UPDATE'), 'Editor can update its X opt-in field';
  assert not has_column_privilege('anon','public.angles','post_to_x','UPDATE'), 'Guests cannot change X opt-in';
  assert not has_column_privilege('authenticated','public.angles','created_by','UPDATE'), 'Authorship stays protected';
  assert not has_column_privilege('authenticated','public.angles','season','UPDATE'), 'Season stays protected';
  assert (select relrowsecurity from pg_class where oid='public.angles'::regclass), 'Admin RLS remains enabled';
end $$;
select set_config('request.jwt.claim.sub', (select user_id::text from public.livewire_roles where role in ('owner','admin') order by role desc limit 1), true);
set local role authenticated;
do $$
declare target uuid; affected integer;
begin
  select id into target from public.angles order by updated_at desc limit 1;
  assert target is not null, 'An existing post is required for the editing regression';
  update public.angles set title=title, narrative=narrative, evidence=evidence, counterpoint=counterpoint,
    game_id=game_id, matchup=matchup, kind=kind, subject=subject, category=category,
    pick=pick, picks=picks, review_picks=review_picks, source_url=source_url, source_label=source_label,
    reviewed=reviewed, status=status, image_paths=image_paths, news_types=news_types, themes=themes,
    post_to_x=post_to_x, parlay_graphic=parlay_graphic, revision=revision+1
  where id=target;
  get diagnostics affected=row_count;
  assert affected=1, 'An admin can save the complete editor payload';
end $$;
rollback;
