-- Fantasy News: a second Analyst Desk section stored alongside The Angle, tagged Injuries and/or News.
begin;

alter table public.angles add column if not exists section text not null default 'angle'
  check (section in ('angle', 'news'));
alter table public.angles add column if not exists news_types text[] not null default '{}'
  check (news_types <@ array['injury','news']::text[] and array_position(news_types, null) is null
    and (cardinality(news_types) < 2 or news_types[1] <> news_types[2]));
alter table public.angles drop constraint if exists angles_news_types_section_check;
alter table public.angles add constraint angles_news_types_section_check check (
  (section = 'angle' and cardinality(news_types) = 0)
  or (section = 'news' and (status <> 'published' or cardinality(news_types) > 0))
);
-- Section is chosen on insert and cannot move between Analyst Desk tabs afterwards.
grant update (news_types) on public.angles to authenticated;
create index if not exists angles_section_week_idx on public.angles(section, season, week, updated_at desc);

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id=new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id,author_id,author_name,title,body,source_url,themes,created_at,updated_at,image_paths,admin_pick,admin_picks)
  values(new.id,new.created_by,'From The Analyst''s Desk',new.title,
    concat_ws(E'\n\n',new.narrative,
      case when btrim(new.evidence)<>'' then 'The supporting context'||E'\n'||new.evidence end,
      case when btrim(new.counterpoint)<>'' then 'The other side'||E'\n'||new.counterpoint end),
    nullif(new.source_url,''),case when new.section='news' then array['fantasy'] else array['news'] end,
    coalesce(new.published_at,new.updated_at),
    new.updated_at,new.image_paths,new.pick,new.picks)
  on conflict(angle_id) do update set
    author_id=excluded.author_id,author_name=excluded.author_name,title=excluded.title,body=excluded.body,
    source_url=excluded.source_url,updated_at=excluded.updated_at,image_paths=excluded.image_paths,
    admin_pick=excluded.admin_pick,admin_picks=excluded.admin_picks;
  return new;
end;
$$;
revoke all on function public.sync_angle_livewire() from public, anon, authenticated;

create or replace function public.queue_angle_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_push_deliveries where angle_id = new.id and delivered_at is null;
    return new;
  end if;
  insert into public.angle_push_publications(angle_id) values (new.id) on conflict do nothing;
  if found then
    insert into public.livewire_push_deliveries(angle_id, user_id, endpoint, subject, primary_theme)
    select new.id, user_id, endpoint, new.title, case when new.section = 'news' then 'fantasy' end
    from public.user_push_subscriptions
    on conflict(angle_id, endpoint) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_angle_push() from public, anon, authenticated;

create or replace function public.analyst_unread_items(board_season integer, board_week integer)
returns table(kind text, key text)
language sql stable security invoker set search_path = ''
as $$
  select case when story.section = 'news' then 'news' else 'angle' end, story.id::text from public.angles story
  where story.status = 'published' and story.season = board_season and story.week = board_week
    and not exists(select 1 from public.angle_reads receipt where receipt.user_id = auth.uid() and receipt.angle_id = story.id)
  union all
  select 'picks'::text, board.season || ':' || board.week || ':' || board.revision || ':' || target.player_id
  from public.matchup_boards board
  cross join lateral (
    select pick->>'id' as player_id from jsonb_array_elements(board.picks) pick
    union all select 'empty' where jsonb_array_length(board.picks) = 0
  ) target
  where board.season = board_season and board.week = board_week
    and not exists(select 1 from public.matchup_reads receipt where receipt.user_id = auth.uid()
      and receipt.season = board.season and receipt.week = board.week and receipt.revision = board.revision
      and receipt.player_id = target.player_id);
$$;
revoke all on function public.analyst_unread_items(integer,integer) from public;
grant execute on function public.analyst_unread_items(integer,integer) to anon, authenticated;

create or replace function public.mark_analyst_read(item_kind text, item_key text) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to sync read status'; end if;
  if item_kind in ('angle', 'news') and item_key ~* '^[0-9a-f-]{36}$' then
    insert into public.angle_reads(user_id, angle_id) values(auth.uid(), item_key::uuid) on conflict do nothing;
  elsif item_kind = 'picks' and item_key ~ '^[0-9]{4}:[0-9]{1,2}:[1-9][0-9]*:([0-9]{1,15}|empty)$' then
    insert into public.matchup_reads(user_id, season, week, revision, player_id)
    values(auth.uid(), split_part(item_key,':',1)::integer, split_part(item_key,':',2)::integer,
      split_part(item_key,':',3)::integer, split_part(item_key,':',4)) on conflict do nothing;
  else raise exception 'Invalid Analyst Desk receipt'; end if;
end;
$$;
revoke all on function public.mark_analyst_read(text,text) from public, anon;
grant execute on function public.mark_analyst_read(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
