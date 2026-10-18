import { readAnglePicks } from './theAngle.ts';
import type { AnglePick } from './theAngle.ts';

export type PostTheme = 'news' | 'fantasy' | 'betting';
export type LivewirePost = {
  id: string; author_id: string | null; author_name: string; angle_id?: string | null;
  admin_pick?: string; admin_picks?: AnglePick[]; title: string | null; body: string;
  themes?: PostTheme[]; image_paths?: string[]; source_url: string | null;
  created_at: string; updated_at: string; view_count?: number;
};
export type LivewireSnapshot = { posts: LivewirePost[]; hasMore: boolean };

export function readLivewirePosts(value: unknown): LivewirePost[] {
  if (!Array.isArray(value) || !value.every((post) => post && typeof post === 'object'
    && typeof post.id === 'string' && (post.author_id === null || typeof post.author_id === 'string')
    && typeof post.author_name === 'string' && (post.title === null || typeof post.title === 'string')
    && typeof post.body === 'string' && (post.source_url === null || typeof post.source_url === 'string')
    && typeof post.created_at === 'string' && Number.isFinite(Date.parse(post.created_at))
    && typeof post.updated_at === 'string' && Number.isFinite(Date.parse(post.updated_at))
    && (post.angle_id === undefined || post.angle_id === null || typeof post.angle_id === 'string')
    && (post.admin_pick === undefined || typeof post.admin_pick === 'string')
    && (post.image_paths === undefined || (Array.isArray(post.image_paths) && post.image_paths.length <= 4
      && post.image_paths.every((path: unknown) => typeof path === 'string')))
    && (post.themes === undefined || (Array.isArray(post.themes)
      && post.themes.every((theme: unknown) => theme === 'news' || theme === 'fantasy' || theme === 'betting')))
    && (post.view_count === undefined || (Number.isSafeInteger(post.view_count) && post.view_count >= 0)))) {
    throw new Error('The server returned invalid LIVEWIRE posts. Please retry.');
  }
  value.forEach((post) => { if (post.admin_picks !== undefined) readAnglePicks(post.admin_picks); });
  return value;
}

export function livewireSnapshot(posts: LivewirePost[], limit: number): LivewireSnapshot {
  return { posts: posts.slice(0, limit), hasMore: posts.length > limit };
}

export async function fetchLivewirePosts(
  config: { url: string; key: string },
  options: { limit: number; themes: PostTheme[]; postId?: string },
  signal?: AbortSignal,
): Promise<LivewirePost[]> {
  const posts: LivewirePost[] = [];
  for (let offset = 0; offset <= options.limit; offset += 500) {
    const count = Math.min(500, options.limit + 1 - offset);
    const url = new URL(`${config.url}/rest/v1/livewire_posts`);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.desc,id.desc');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(count));
    if (options.themes.length) url.searchParams.set('themes', `ov.{${options.themes.join(',')}}`);
    if (options.postId) url.searchParams.set('id', `eq.${options.postId}`);
    const response = await fetch(url, {
      headers: { apikey: config.key, Accept: 'application/json' },
      cache: 'reload',
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Could not refresh LIVEWIRE (HTTP ${response.status}). Please retry.`);
    const page = readLivewirePosts(await response.json());
    posts.push(...page);
    if (page.length < count || options.postId) break;
  }
  return posts;
}
