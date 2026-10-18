begin;

create or replace function public.set_livewire_owner_byline() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.angle_id is null and exists (
    select 1 from public.livewire_roles where user_id = new.author_id and role = 'owner'
  ) then
    new.author_name := 'From The Analyst''s Desk';
  end if;
  return new;
end;
$$;
revoke all on function public.set_livewire_owner_byline() from public, anon, authenticated;
drop trigger if exists livewire_owner_byline on public.livewire_posts;
create trigger livewire_owner_byline before insert or update of author_id, author_name on public.livewire_posts
for each row execute function public.set_livewire_owner_byline();

update public.livewire_posts post set author_name = 'From The Analyst''s Desk'
where post.angle_id is null and post.author_name <> 'From The Analyst''s Desk'
  and exists (select 1 from public.livewire_roles where user_id = post.author_id and role = 'owner');

notify pgrst, 'reload schema';
commit;
