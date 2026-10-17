import type { DenNewsItem, Game } from './sportsData';

export const angleCategories = ['Former team', 'Head-to-head history', 'Rivalry / rematch', 'Milestone / comeback', 'Other'] as const;
export type AngleCategory = typeof angleCategories[number];
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
  source_url: string;
  source_label: string;
  reviewed: boolean;
  status: 'draft' | 'published';
  revision: number;
};
export type AngleSuggestion = { key: string; game: Game; category: AngleCategory; article: DenNewsItem };

export function angleWriteFields(angle: Angle, status: Angle['status']) {
  return {
    game_id: angle.game_id, matchup: angle.matchup, kind: angle.kind, subject: angle.subject.trim(),
    category: angle.category, title: angle.title.trim(), narrative: angle.narrative, evidence: angle.evidence,
    counterpoint: angle.counterpoint, pick: angle.pick, source_url: angle.source_url.trim(),
    source_label: angle.source_label.trim(), reviewed: angle.reviewed, status,
  };
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
      && 'reviewed' in row && typeof row.reviewed === 'boolean';
  };
  if (!Array.isArray(value) || !value.every(isAngle)) throw new Error('The server returned invalid angle data. Please reload.');
  return value;
}

export function isAngleSource(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !/\s/.test(value);
  } catch { return false; }
}

export function suggestedAngleCategory(text: string): AngleCategory | null {
  if (/\b(former team|former club|old team|reunion|reunites|revenge|homecoming)\b/i.test(text)) return 'Former team';
  if (/\b(head.to.head|historically|history against|career against|success against|dominat(?:e[sd]?|ing|ion))\b/i.test(text)) return 'Head-to-head history';
  if (/\b(rivalry|rivals?|rematch|aveng(?:e|ing))\b/i.test(text)) return 'Rivalry / rematch';
  if (/\b(milestone|comeback|record.breaking|returns? from injury)\b/i.test(text)) return 'Milestone / comeback';
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

export function anglePublishError(angle: Pick<Angle, 'title' | 'subject' | 'narrative' | 'evidence' | 'counterpoint' | 'source_url' | 'source_label' | 'reviewed'>) {
  if (![angle.title, angle.subject, angle.narrative, angle.evidence, angle.counterpoint, angle.source_label].every((value) => value.trim())) return 'Add a title, subject, storyline, supporting context, counterpoint, and source name before publishing.';
  if (!isAngleSource(angle.source_url)) return 'Add a valid HTTP or HTTPS source link before publishing.';
  if (!angle.reviewed) return 'Confirm you checked the source, matchup, and factual claims before publishing.';
  return '';
}
