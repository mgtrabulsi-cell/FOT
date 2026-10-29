begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.gamewaire_admin_account),true);
set local role authenticated;
do $$
declare story uuid; pick uuid:=gen_random_uuid(); graphic jsonb; attachment text; owner text:=auth.uid()::text;
begin
  assert has_column_privilege('authenticated','public.angles','parlay_graphic','update'),'Editable metadata grant';
  attachment:=owner||'/parlay-rollback-test.png';
  insert into storage.objects(bucket_id,name,owner_id) values('livewire-photos',attachment,owner);
  graphic:=jsonb_build_object('version',1,'pickId',pick,'title','PARLAY','subtitle','NBA + NFL',
    'odds','+1360','images',false,'image_path',attachment,'legs',jsonb_build_array(
      jsonb_build_object('id',gen_random_uuid(),'sport','NBA','type','moneyline'),
      jsonb_build_object('id',gen_random_uuid(),'sport','NFL','type','spread')));
  insert into public.angles(season,week,game_id,matchup,kind,subject,category,title,narrative,status,
    picks,image_paths,parlay_graphic)
  values(2026,7,'COMBO:0','NBA + NFL','team','','Other','Rollback parlay','Draft only, never published','draft',
    jsonb_build_array(jsonb_build_object('id',pick,'text',E'Team ML\nOther Team +3.5','category','parlay','result','pending')),
    array[attachment],graphic) returning id into story;
  assert (select parlay_graphic=graphic from public.angles where id=story),'Template persists with image and single pick';
  update public.angles set parlay_graphic=jsonb_set(graphic,'{subtitle}','"Updated slate"'),revision=revision+1 where id=story;
  begin
    update public.angles set parlay_graphic=graphic||'{"image_path":"missing.png"}',revision=revision+1 where id=story;
    raise exception 'Missing image should fail';
  exception when check_violation then null; end;
  begin
    update public.angles set parlay_graphic=graphic||'{"legs":[]}',revision=revision+1 where id=story;
    raise exception 'Empty parlay should fail';
  exception when check_violation then null; end;
  begin
    update public.angles set picks='[]',pick='',revision=revision+1 where id=story;
    raise exception 'Missing tracked parlay should fail';
  exception when check_violation then null; end;
end $$;
reset role;
rollback;
select 'PASS: editable parlay metadata, attachment linkage, one tracked parlay, revision updates and invalid metadata rejection; rolled back without publishing' result;
