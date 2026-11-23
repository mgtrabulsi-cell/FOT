begin;
create temporary table gamewaire_publications (picks jsonb);
create trigger test_prop_prices before insert on gamewaire_publications
for each row execute function public.gamewaire_prop_price_guard();
insert into gamewaire_publications values
  ('[{"market":"player_points","american":-400}]'),
  ('[{"market":"player_points","american":-200}]'),
  ('[{"market":"player_points","american":5000}]');
do $$
declare price jsonb; blocked boolean;
begin
  for price in select value from jsonb_array_elements('[99,-99,0,null,"bad"]') loop
    blocked:=false;
    begin
      insert into gamewaire_publications values
        (jsonb_build_array(jsonb_build_object('market','player_points','american',price)));
    exception when others then
      if position('valid American odds' in sqlerrm)=0 then raise; end if;
      blocked:=true;
    end;
    assert blocked,'Malformed prop odds were accepted';
  end loop;
end $$;
rollback;
