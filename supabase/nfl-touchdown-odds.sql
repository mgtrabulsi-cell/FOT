-- Add one archived NFL market without increasing the rolling credit budget.
begin;
alter table public.gamewaire_credit_reservations drop constraint gamewaire_credit_reservations_cost_check;
alter table public.gamewaire_credit_reservations add constraint gamewaire_credit_reservations_cost_check
  check (cost between 1 and 8);
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.gamewaire_reserve_credits(integer)'::regprocedure);
  definition := replace(definition, 'not between 1 and 7', 'not between 1 and 8');
  if position('not between 1 and 8' in definition) = 0 then
    raise exception 'Unexpected analysis credit reservation guard';
  end if;
  execute definition;
  definition := pg_get_functiondef('public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)'::regprocedure);
  if position('anytimeTouchdownOddsVersion' in definition) = 0 then
    definition := replace(definition,
      '(payload->>''playerPropMinimum''=''4'' and payload->>''pickLayoutVersion''=''one-lean-four-props-v1'')',
      '(payload->>''playerPropMinimum''=''4'' and payload->>''pickLayoutVersion''=''one-lean-four-props-v1'' and (target_sport<>''NFL'' or payload->>''anytimeTouchdownOddsVersion''=''pregame-v1''))');
  end if;
  if position('anytimeTouchdownOddsVersion' in definition) = 0 then
    raise exception 'Unexpected scheduled report reuse guard';
  end if;
  execute definition;
end $$;
commit;
