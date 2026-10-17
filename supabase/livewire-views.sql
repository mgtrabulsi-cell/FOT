begin;

alter table public.livewire_posts add column if not exists view_count bigint not null default 0
  check (view_count >= 0);

create or replace function public.record_livewire_view(post_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  update public.livewire_posts set view_count = view_count + 1
  where id = post_id returning view_count into total;
  if total is null then raise exception 'Post is no longer available'; end if;
  return total;
end;
$$;
revoke all on function public.record_livewire_view(uuid) from public;
grant execute on function public.record_livewire_view(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
