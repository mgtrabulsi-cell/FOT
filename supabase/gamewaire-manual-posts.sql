begin;

-- Angle's first-publication queue now owns the manually reviewed post notification.
drop trigger if exists gamewaire_published_push on public.gamewaire_publications;
alter table public.gamewaire_push_deliveries add column if not exists cancelled_at timestamptz;
update public.gamewaire_push_deliveries set cancelled_at = now(), last_error = 'Replaced by manual Angle publication'
where delivered_at is null and cancelled_at is null;
create or replace function public.claim_gamewaire_push()
returns setof public.gamewaire_push_deliveries
language sql security definer set search_path = ''
as $$
  update public.gamewaire_push_deliveries as delivery
  set attempts = delivery.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where delivery.id in (
    select id from public.gamewaire_push_deliveries
    where delivered_at is null and cancelled_at is null and next_attempt_at <= now() and expires_at > now()
    order by next_attempt_at, id for update skip locked limit 100
  ) returning delivery.*;
$$;
notify pgrst, 'reload schema';
commit;
