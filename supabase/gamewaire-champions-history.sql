begin;

do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.gamewaire_publish_lean(uuid)',
    'public.gamewaire_soccer_publication_guard()',
    'public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)',
    'public.gamewaire_schedule_claim()'] loop
    if to_regprocedure(signature) is null then raise exception 'Missing prerequisite: %',signature; end if;
    definition := pg_get_functiondef(to_regprocedure(signature));
    definition := replace(definition, '''soccer-probability-v3''', '''soccer-probability-v4''');
    execute definition;
  end loop;
end $$;

commit;
