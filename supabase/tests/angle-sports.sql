begin;
insert into auth.users(id) values ('f8541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values('f8541111-1111-4111-8111-111111111111','admin','Sports test');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8541111-1111-4111-8111-111111111111',true);
insert into public.angles(season,week,game_id,matchup,kind,subject,category,title)
values (2200,18,'NFL:123','Test','team','','Other','NFL'),
 (2200,18,'NFL:0','NFL','team','','Other','General NFL'),
 (2200,18,'FANTASY:0','Fantasy','team','','Other','General Fantasy'),
 (2200,18,'NBA:0','Lakers @ Celtics','team','','Other','NBA'),
 (2200,18,'NHL:0','Rangers @ Bruins','team','','Other','NHL'),
 (2200,18,'UCL:0','Arsenal vs Inter','team','','Other','UCL'),
 (2200,18,'SOCCER:0','Inter Miami vs LAFC','team','','Other','Soccer');
do $$
begin
  begin
    insert into public.angles(season,week,game_id,matchup,kind,subject,category,title) values (2200,18,'MLB:0','Test','team','','Other','Bad');
    raise exception 'Unsupported sport accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.angles(season,week,game_id,matchup,kind,subject,category,title) values (2200,18,'NBA:123','Test','team','','Other','Bad');
    raise exception 'Non-NFL event ID accepted';
  exception when check_violation then null;
  end;
end;
$$;
reset role;
select 'Angle sports: general NFL/Fantasy, NFL games, NBA, NHL, UCL, and Soccer picks accepted; other leagues rejected' as result;
rollback;
