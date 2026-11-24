begin;

do $$
declare definition text;
begin
  if to_regprocedure('public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)') is null
    or to_regprocedure('public.gamewaire_schedule_claim()') is null
    then raise exception 'Apply the full-analysis and Champions League migrations first'; end if;
  definition := pg_get_functiondef('public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)'::regprocedure);
  definition := regexp_replace(definition,
    'case\s+when\s+target_sport\s*=\s*''NFL''\s+then\s+6\s+else\s+0\s+end',
    'case when target_sport in (''NFL'',''Champions League'') then 6 else 0 end', 'g');
  if position('target_sport=''Champions League'' and extract(isodow from target_date)<>1' in definition)=0 then
    definition := replace(definition, 'if target_sport is null',
      'if (target_sport=''Champions League'' and extract(isodow from target_date)<>1) or target_sport is null');
  end if;
  if position('batches.note is distinct from excluded.note' in definition)=0 then
    definition := replace(definition, 'where batches.model_version is distinct from excluded.model_version',
      'where batches.model_version is distinct from excluded.model_version
        or (target_sport=''Champions League'' and batches.note is distinct from excluded.note)');
  end if;
  definition := replace(definition,
    '(target_sport not in (''NBA'',''NFL'') or payload->>''playerPropMinimum''=''4'')',
    '(payload->>''playerPropMinimum''=''4'' and payload->>''pickLayoutVersion''=''one-lean-four-props-v1'')');
  if position('target_sport in (''NFL'',''Champions League'') then 6' in definition)=0
    or position('extract(isodow from target_date)<>1' in definition)=0
    or position('batches.note is distinct from excluded.note' in definition)=0
    or position('pickLayoutVersion' in definition)=0
    then raise exception 'Unexpected scheduler definition; weekly planning was not installed'; end if;
  execute definition;

  definition := pg_get_functiondef('public.gamewaire_schedule_claim()'::regprocedure);
  definition := replace(definition, '40 attempts / 80 credits', '40 attempts / 200 credits');
  definition := regexp_replace(definition, 'remaining\s*<\s*2([^0-9]|$)', 'remaining<5\1', 'g');
  definition := replace(definition, 'below 2 credits', 'below 5 credits');
  if position('remaining<5' in definition)=0 then raise exception 'Soccer credit guard was not upgraded'; end if;
  execute definition;
end $$;

-- Retire only unstarted daily jobs superseded by this week's Monday plan.
update public.gamewaire_schedule_jobs j set status='skipped',finished_at=now(),
  error='Superseded by the Monday Champions League weekly plan.'
from public.gamewaire_schedule_batches b
where j.batch_id=b.id and j.sport='Champions League' and j.status='pending'
  and extract(isodow from b.game_date)<>1 and j.event_start>now()
  and (j.event_start at time zone 'America/New_York')::date
    between date_trunc('week',now() at time zone 'America/New_York')::date
    and date_trunc('week',now() at time zone 'America/New_York')::date+6;

notify pgrst,'reload schema';
commit;
