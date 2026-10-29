begin;
do $$
begin
  assert not exists(select 1 from pg_trigger where tgname = 'gamewaire_published_push' and not tgisinternal),
    'Publishing picks must not queue automatic GamewAIre broadcasts';
  assert not exists(select 1 from public.gamewaire_push_deliveries where delivered_at is null and cancelled_at is null),
    'Legacy pending broadcasts are cancelled';
  assert exists(select 1 from pg_trigger where tgname = 'angle_first_publication_push' and tgenabled = 'O'),
    'Manual first Angle publication retains its notification queue';
  assert not exists(select 1 from public.claim_gamewaire_push()), 'Cancelled broadcasts cannot be claimed';
end $$;
rollback;
