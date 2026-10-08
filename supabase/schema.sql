create table if not exists public.user_favorites (
  user_id uuid primary key references auth.users (id) on delete cascade,
  favorites jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_favorites_is_array check (jsonb_typeof(favorites) = 'array')
);

alter table public.user_favorites enable row level security;

drop policy if exists "Users can read their favorites" on public.user_favorites;
create policy "Users can read their favorites"
  on public.user_favorites for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their favorites" on public.user_favorites;
create policy "Users can create their favorites"
  on public.user_favorites for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their favorites" on public.user_favorites;
create policy "Users can update their favorites"
  on public.user_favorites for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.user_push_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  notify_scores boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table public.user_push_subscriptions enable row level security;

drop policy if exists "Users can read their push subscriptions" on public.user_push_subscriptions;
create policy "Users can read their push subscriptions"
  on public.user_push_subscriptions for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their push subscriptions" on public.user_push_subscriptions;
create policy "Users can create their push subscriptions"
  on public.user_push_subscriptions for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their push subscriptions" on public.user_push_subscriptions;
create policy "Users can update their push subscriptions"
  on public.user_push_subscriptions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their push subscriptions" on public.user_push_subscriptions;
create policy "Users can remove their push subscriptions"
  on public.user_push_subscriptions for delete to authenticated
  using (auth.uid() = user_id);

create table if not exists public.push_game_states (
  event_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.push_game_states enable row level security;
