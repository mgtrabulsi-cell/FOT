import type { DenNewsItem, Game } from './sportsData';
import { postThemes } from './postThemes.ts';
import type { PostTheme } from './postThemes.ts';

export const angleCategories = ['Former team', 'Head-to-head history', 'Rivalry / rematch', 'Milestone / comeback', 'Birthday', 'Public life event', 'Other'] as const;
export type AngleCategory = typeof angleCategories[number];
export type AnglePick = { id: string; text: string; result: 'pending' | 'hit' | 'miss' };
export function readAnglePicks(value: unknown): AnglePick[] {
  if (!Array.isArray(value) || !value.every((pick) => pick && typeof pick === 'object'
    && typeof pick.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pick.id)
    && typeof pick.text === 'string' && pick.text.trim().length > 0 && pick.text.length <= 500
    && ['pending', 'hit', 'miss'].includes(pick.result))
    || new Set(value.map((pick) => pick.id.toLowerCase())).size !== value.length) throw new Error('The server returned invalid admin picks. Please reload.');
  return value;
}
export function anglePicks(angle: { id: string; pick: string; picks?: AnglePick[] }): AnglePick[] {
  return angle.picks ?? (angle.pick.trim() ? [{ id: angle.id, text: angle.pick, result: 'pending' }] : []);
}
export type Angle = {
  id: string;
  season: number;
  week: number;
  game_id: string;
  matchup: string;
  kind: 'player' | 'team';
  subject: string;
  category: AngleCategory;
  title: string;
  narrative: string;
  evidence: string;
  counterpoint: string;
  pick: string;
  picks?: AnglePick[];
  published_at?: string | null;
  source_url: string;
  source_label: string;
  reviewed: boolean;
  status: 'draft' | 'published';
  revision: number;
  image_paths?: string[];
  section?: AngleSection;
  news_types?: NewsType[];
  themes?: PostTheme[];
};
export type AngleSection = 'angle' | 'news';
export const newsTypes = [
  { value: 'injury', label: 'Injuries', color: 'snf' },
  { value: 'news', label: 'News', color: 'tnf' },
] as const;
export type NewsType = typeof newsTypes[number]['value'];
export const angleSection = (angle: Pick<Angle, 'section'>): AngleSection => angle.section ?? 'angle';
export function angleVisibleInWeek(angle: Pick<Angle, 'season' | 'week' | 'section' | 'status' | 'game_id' | 'published_at'>, season: number | null, week: number | null, now = Date.now()) {
  if (angle.season === season && angle.week === week) return true;
  const published = Date.parse(angle.published_at ?? '');
  return angleSection(angle) === 'angle' && angle.status === 'published'
    && angleSports.some((sport) => angle.game_id.startsWith(`${sport.key}:`))
    && published <= now && published > now - 168 * 60 * 60 * 1000;
}
export function publishedAnglePicks(stories: Angle[]) {
  return stories.filter((story) => story.status === 'published')
    .flatMap((story) => anglePicks(story).map((pick) => ({ story, pick })));
}
export type AngleSuggestion = {
  key: string; game: Game; category: AngleCategory; article: DenNewsItem; sourceLabel?: string; playerName?: string; subject?: string;
  history?: { evidence: string; meetings: Array<{ label: string; url: string }> };
};
export const angleLeadGroups = ['Birthdays', 'Game trends', 'Milestones & comebacks', 'Other storylines'] as const;
export function angleLeadGroup(category: AngleCategory): typeof angleLeadGroups[number] {
  if (category === 'Birthday') return 'Birthdays';
  if (category === 'Milestone / comeback' || category === 'Public life event') return 'Milestones & comebacks';
  if (category === 'Other') return 'Other storylines';
  return 'Game trends';
}

export const angleSports = [
  { key: 'NBA', label: 'NBA', emoji: '🏀' },
  { key: 'NHL', label: 'NHL', emoji: '🏒' },
  { key: 'UCL', label: 'UCL', emoji: '⚽' },
  { key: 'SOCCER', label: 'Soccer', emoji: '⚽' },
] as const;
export type AngleSportKey = 'NFL' | typeof angleSports[number]['key'];
const nflSport = { key: 'NFL', label: 'NFL', emoji: '🏈' } as const;
export function angleSport(gameId: string): { key: AngleSportKey; label: string; emoji: string } {
  const prefix = gameId.split(':')[0];
  return angleSports.find((sport) => sport.key === prefix) ?? nflSport;
}
export const angleSportGameId = (key: typeof angleSports[number]['key']) => `${key}:0`;

export function angleSportRecords(stories: Angle[]) {
  const records = [nflSport, ...angleSports].map((sport) => ({ ...sport, wins: 0, losses: 0 }));
  for (const { story, pick } of publishedAnglePicks(stories)) {
    const record = records.find((sport) => sport.key === angleSport(story.game_id).key);
    if (record && pick.result === 'hit') record.wins += 1;
    if (record && pick.result === 'miss') record.losses += 1;
  }
  return records;
}

export function angleWriteFields(angle: Angle, status: Angle['status']) {
  return {
    game_id: angle.game_id, matchup: angle.matchup.trim(), kind: angle.kind, subject: angle.subject.trim(),
    category: angle.category, title: angle.title.trim(), narrative: angle.narrative, evidence: angle.evidence,
    counterpoint: angle.counterpoint, pick: angle.picks?.[0]?.text ?? (angle.picks ? '' : angle.pick),
    ...(angle.picks ? { picks: angle.picks.filter((pick) => pick.text.trim()).map((pick) => ({ ...pick, text: pick.text.trim() })) } : {}),
    source_url: angle.source_url.trim(),
    source_label: angle.source_label.trim(), reviewed: angle.reviewed, status, image_paths: angle.image_paths ?? [],
    news_types: angleSection(angle) === 'news' ? [...new Set(angle.news_types ?? [])] : [],
    themes: angleThemes(angle),
  };
}

export function angleThemes(angle: Pick<Angle, 'section' | 'themes'>): PostTheme[] {
  return angle.themes ?? [angleSection(angle) === 'news' ? 'fantasy' : 'news'];
}

export function readAngles(value: unknown): Angle[] {
  const isAngle = (row: unknown): row is Angle => {
    if (!row || typeof row !== 'object') return false;
    const strings = ['id', 'game_id', 'matchup', 'subject', 'title', 'narrative', 'evidence', 'counterpoint', 'pick', 'source_url', 'source_label'];
    return strings.every((key) => key in row && typeof Reflect.get(row, key) === 'string')
      && 'season' in row && Number.isInteger(row.season) && 'week' in row && Number.isInteger(row.week)
      && 'revision' in row && Number.isInteger(row.revision) && Number(row.revision) > 0
      && 'kind' in row && (row.kind === 'player' || row.kind === 'team')
      && 'status' in row && (row.status === 'draft' || row.status === 'published')
      && 'category' in row && angleCategories.some((category) => category === row.category)
      && (!('image_paths' in row) || (Array.isArray(row.image_paths) && row.image_paths.length <= 4 && row.image_paths.every((path: unknown) => typeof path === 'string')))
      && (!('section' in row) || row.section === 'angle' || row.section === 'news')
      && (!('news_types' in row) || (Array.isArray(row.news_types) && row.news_types.every((type: unknown) => newsTypes.some((item) => item.value === type))))
      && (!('themes' in row) || (Array.isArray(row.themes) && row.themes.length <= 3
        && row.themes.every((theme: unknown) => postThemes.some((item) => item.value === theme))
        && new Set(row.themes).size === row.themes.length))
      && 'reviewed' in row && typeof row.reviewed === 'boolean';
  };
  if (!Array.isArray(value) || !value.every(isAngle)) throw new Error('The server returned invalid angle data. Please reload.');
  value.forEach((angle) => {
    if ('picks' in angle) readAnglePicks(angle.picks);
    if ('published_at' in angle && angle.published_at !== null
      && (typeof angle.published_at !== 'string' || !Number.isFinite(Date.parse(angle.published_at)))) throw new Error('The server returned an invalid publication date. Please reload.');
  });
  return value;
}

export function isAngleSource(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !/\s/.test(value);
  } catch { return false; }
}

export function suggestedAngleCategory(text: string): AngleCategory | null {
  if (/\b(birthday|turns \d{2})\b/i.test(text)) return 'Birthday';
  if (/\b(new dad|new father|became a father|birth of (?:his|their) (?:child|son|daughter)|welcom(?:e[sd]?|ing) (?:his |their |a |an )?(?:first |second |third |fourth )?(?:child|baby|son|daughter))\b/i.test(text)) return 'Public life event';
  if (/\b(former team|former club|old team|reunion|reunites|revenge|homecoming)\b/i.test(text)) return 'Former team';
  if (/\b(head.to.head|historically|history against|career against|success against|dominat(?:e[sd]?|ing|ion))\b/i.test(text)) return 'Head-to-head history';
  if (/\b(rivalry|rivals?|rematch|aveng(?:e|ing))\b/i.test(text)) return 'Rivalry / rematch';
  if (/\b(milestone|comeback|record.breaking|returns? from injury)\b/i.test(text)) return 'Milestone / comeback';
  return null;
}

export type PlayerBirthday = { playerId: string; dateOfBirth: string; sourceUrl: string };

export function readPlayerBirthdays(value: unknown, reportConflict?: (message: string) => void): PlayerBirthday[] {
  if (!value || typeof value !== 'object' || !('results' in value) || !value.results
    || typeof value.results !== 'object' || !('bindings' in value.results) || !Array.isArray(value.results.bindings)) {
    throw new Error('The birthday source returned invalid data.');
  }
  const rows: PlayerBirthday[] = [];
  for (const row of value.results.bindings) {
    if (!row || typeof row !== 'object') throw new Error('The birthday source returned an invalid entry.');
    const entryValue = (key: string) => {
      const entry: unknown = Reflect.get(row, key);
      return entry && typeof entry === 'object' && 'value' in entry && typeof entry.value === 'string' ? entry.value : '';
    };
    const playerId = entryValue('espn');
    const dateOfBirth = entryValue('dob').slice(0, 10);
    const sourceUrl = entryValue('person').replace(/^http:/, 'https:');
    if (!/^\d+$/.test(playerId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      || !/^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(sourceUrl)) throw new Error('The birthday source returned an invalid identity or birth date.');
    const timestamp = Date.parse(`${dateOfBirth}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== dateOfBirth) throw new Error('The birthday source returned an invalid birth date.');
    rows.push({ playerId, dateOfBirth, sourceUrl });
  }
  const unique = new Map<string, PlayerBirthday>();
  const ambiguous = new Set<string>();
  rows.forEach((row) => {
    const previous = unique.get(row.playerId);
    if (previous && (previous.dateOfBirth !== row.dateOfBirth || previous.sourceUrl !== row.sourceUrl)) ambiguous.add(row.playerId);
    unique.set(row.playerId, row);
  });
  if (ambiguous.size) {
    const message = `Conflicting birthday identities or dates for ${ambiguous.size} player${ambiguous.size === 1 ? '' : 's'} (ESPN IDs: ${[...ambiguous].join(', ')}). Those players were skipped; verify their biographies manually.`;
    if (!reportConflict) throw new Error(message);
    reportConflict(message);
  }
  return [...unique.values()].filter((row) => !ambiguous.has(row.playerId));
}

export function birthdayNearGame(dateOfBirth: string, gameDate: string): { date: string; onGameDay: boolean } | null {
  const kickoff = new Date(gameDate);
  if (!Number.isFinite(kickoff.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(kickoff);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const dayTime = Date.parse(`${day}T00:00:00Z`);
  for (const year of [Number(part('year')) - 1, Number(part('year')), Number(part('year')) + 1]) {
    const date = `${year}-${dateOfBirth.slice(5)}`;
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date || year <= Number(dateOfBirth.slice(0, 4))) continue;
    if (Math.abs(timestamp - dayTime) <= 3 * 86_400_000) return { date, onGameDay: date === day };
  }
  return null;
}

export function selectAngleSuggestions(game: Game, articles: DenNewsItem[]): AngleSuggestion[] {
  const kickoff = Date.parse(game.date);
  if (!Number.isFinite(kickoff)) return [];
  const urls = new Set<string>();
  return articles.flatMap((article) => {
    const category = suggestedAngleCategory(`${article.headline} ${article.description}`);
    const published = Date.parse(article.published);
    if (!category || !article.url || !isAngleSource(article.url) || urls.has(article.url)
      || !Number.isFinite(published) || published < kickoff - 7 * 86_400_000 || published > kickoff + 86_400_000) return [];
    urls.add(article.url);
    return [{ key: `${game.id}:${article.url}`, game, category, article }];
  });
}

export function anglePublishError(angle: Pick<Angle, 'title' | 'subject' | 'narrative' | 'evidence' | 'counterpoint' | 'source_url' | 'source_label' | 'reviewed'> & { matchup?: string; section?: AngleSection; news_types?: NewsType[] }) {
  if (angle.matchup !== undefined && !angle.matchup.trim()) return 'Add the matchup before saving.';
  if (angle.section === 'news' && !angle.news_types?.length) return 'Choose Injuries, News, or both before publishing.';
  if (![angle.title, angle.narrative].every((value) => value.trim())) return 'Add a headline and storyline before publishing.';
  if (angle.source_url && !isAngleSource(angle.source_url)) return 'Use a valid HTTP or HTTPS source link.';
  if (!angle.reviewed) return 'Confirm you checked the source, matchup, and factual claims before publishing.';
  return '';
}
