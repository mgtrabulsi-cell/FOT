import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { xSource, xImagePostText } from '../supabase/functions/_shared/xPosting.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('LIVEWIRE has no mounted feed, navigation, polling or unread subscriptions', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /import .*LiveWire|useLivewireUnread|fetchLivewirePosts|<LiveWire|setView\('LiveWire'\)/);
  assert.match(app, /retired_livewire_destination/);
  assert.match(app, /setAnalystMode\('Angle'\)/);
  assert.match(app, /if \(window.location.hash.startsWith\('#livewire'\)\) openNotification\(\)/);
});

test('final migration archives posts and blocks old clients while retaining Angle delivery', () => {
  const sql = read('supabase/retire-livewire.sql');
  assert.match(sql, /before insert or update on public.livewire_posts/);
  assert.match(sql, /drop trigger if exists angle_livewire_sync/);
  assert.match(sql, /drop trigger if exists livewire_new_post_push/);
  assert.match(sql, /drop trigger if exists livewire_x_publication/);
  assert.match(sql, /where angle_id is not null and post_id is null and cancelled_at is null/);
  assert.match(sql, /where source_type = 'livewire' and status in \('pending','sending'\)/);
  assert.match(sql, /where source_type = 'angle' and status = 'pending'/);
  assert.doesNotMatch(sql, /delete from public.livewire_posts|drop table|drop function public.livewire_role/i);
  const publish = sql.slice(sql.indexOf('create or replace function public.save_fantasy_graphic_publication'));
  assert.match(publish, /insert into public.angles/);
  assert.doesNotMatch(publish, /insert into public.livewire_posts/);
});

test('background dispatch has no legacy post source or deep-link output', () => {
  const x = read('supabase/functions/send-x-posts/index.ts');
  assert.match(x, /delivery.source_type !== 'angle'/);
  assert.doesNotMatch(x, /from\('livewire_posts'\)|#livewire\/post/);
  const push = read('supabase/functions/send-livewire-push/index.ts');
  assert.match(push, /if \(!delivery.angle_id \|\| delivery.post_id\) return/);
  assert.doesNotMatch(push, /#livewire\/post/);
});

test('Angle-backed Start/Sit retains exact headline and original PNG X publishing', () => {
  const row = { title: 'Week 7 Must Start Fantasy QB', fantasy_graphic_id: '11111111-1111-4111-8111-111111111111',
    image_paths: ['11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png'] };
  const source = xSource(row, true, 'id');
  assert.equal(source.graphicImage, row.image_paths[0]);
  assert.equal(xImagePostText(source, 'https://gamewire.us/#analyst-desk'), row.title);
});

test('shared admin management moves to Profile rather than disappearing with LIVEWIRE', () => {
  const profile = read('src/ProfilePage.tsx');
  assert.match(profile, /<AdminAccessSettings key=\{user.id\} userId=\{user.id\}/);
  const admin = read('src/AdminAccessSettings.tsx');
  assert.match(admin, /admin.user_id === userId && admin.role === 'owner'/);
  assert.match(admin, /rpc\('manage_livewire_admin', parameters\)/);
  for (const path of ['src/NotificationOnboarding.tsx', 'src/OwnerUserActivity.tsx']) {
    assert.doesNotMatch(read(path), /LIVEWIRE/);
  }
});
