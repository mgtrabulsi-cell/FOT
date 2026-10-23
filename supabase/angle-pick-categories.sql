begin;

create or replace function public.validate_angle_picks() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare item jsonb; previous jsonb; normalized jsonb := '[]'; category text;
begin
  if jsonb_typeof(new.picks) is distinct from 'array' then raise exception 'Admin picks must be a list'; end if;
  if (tg_op='INSERT' and new.picks='[]' and btrim(new.pick)<>'')
    or (tg_op='UPDATE' and new.picks=old.picks and new.pick<>old.pick) then
    if btrim(new.pick)='' then
      new.picks := new.picks - 0;
    elsif jsonb_array_length(new.picks)=0 then
      new.picks := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',new.pick,'result','pending'));
    else
      new.picks := jsonb_set(new.picks,'{0,text}',to_jsonb(new.pick));
    end if;
  end if;
  for item in select value from jsonb_array_elements(new.picks) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'text') is distinct from 'string'
      or char_length(btrim(item->>'text')) not between 1 and 500
      or jsonb_typeof(item->'result') is distinct from 'string'
      or (item->>'result') not in ('pending','hit','miss') then
      raise exception 'Each admin pick needs a unique ID, 1-500 characters, and a valid result';
    end if;
    previous := null;
    if tg_op='UPDATE' then
      select value into previous from jsonb_array_elements(old.picks) where value->>'id'=item->>'id';
    end if;
    if item ? 'category' and (jsonb_typeof(item->'category') is distinct from 'string'
      or item->>'category' not in ('straight','parlay','sprinkle')) then
      raise exception 'Pick type must be Straight, Parlay, or Sprinkle';
    end if;
    category := coalesce(item->>'category', previous->>'category', 'straight');
    if previous is null or btrim(previous->>'text')<>btrim(item->>'text') then
      item := jsonb_set(item,'{result}','"pending"');
    end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'id',lower(item->>'id'),'text',btrim(item->>'text'),'result',item->>'result','category',category));
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(normalized)) <> jsonb_array_length(normalized) then
    raise exception 'Each admin pick needs a unique ID';
  end if;
  new.picks := normalized;
  new.pick := coalesce(normalized->0->>'text','');
  if tg_op='UPDATE' then new.published_at := old.published_at; else new.published_at := null; end if;
  if new.published_at is null and new.status='published' then
    select first_published_at into new.published_at from public.angle_push_publications where angle_id=new.id;
    new.published_at := coalesce(new.published_at,clock_timestamp());
  end if;
  return new;
end;
$$;
revoke all on function public.validate_angle_picks() from public,anon,authenticated;

-- Classify only uncategorized picks. Owner-confirmed mixed entries remain one straight.
update public.angles story set picks=(
  select jsonb_agg(
    case when item ? 'category' then item else item || jsonb_build_object('category',
      case
        when item->>'id' in (
          '9de5d166-d9bd-40f4-a62a-9e3a3517457a','507af5ac-d7f5-4bcc-84c0-0011af872484',
          'd2c0b05f-9a64-41d6-9882-84b13fdbaac9','2b4195e7-742e-4d04-8664-ace4ddbb16eb',
          'a8d9886d-ff78-452a-8ce7-d2dbc60fbc87'
        ) then 'straight'
        when item->>'text' ~* '\msprinkles?\M' then 'sprinkle'
        when item->>'text' ~* '\mparlays?\M' then 'parlay'
        else 'straight'
      end) end order by ordinal)
  from jsonb_array_elements(story.picks) with ordinality as entries(item,ordinal)
), revision=story.revision+1
where exists(select 1 from jsonb_array_elements(story.picks) item where not (item ? 'category'));

notify pgrst,'reload schema';
commit;
