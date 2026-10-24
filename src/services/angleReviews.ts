import { anglePicks, pickCategory, readAnglePicks } from './anglePicks.ts';
import type { AnglePick, PickCategory } from './anglePicks.ts';

export type AngleReviewPick = {
  story_id: string;
  pick_id: string;
  text: string;
  result: 'hit' | 'miss';
  category: PickCategory;
  title: string;
  matchup: string;
  game_id: string;
  season: number;
  week: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const angleReviewKey = (pick: Pick<AngleReviewPick, 'story_id' | 'pick_id'>) => `${pick.story_id}:${pick.pick_id}`.toLowerCase();

export function readAngleReviews(value: unknown): AngleReviewPick[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid settled-pick reviews. Please reload.');
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.story_id !== 'string' || !uuid.test(item.story_id)
      || typeof item.pick_id !== 'string' || !uuid.test(item.pick_id)
      || !['hit', 'miss'].includes(item.result) || !['straight', 'parlay', 'sprinkle'].includes(item.category)
      || !['text', 'title', 'matchup', 'game_id'].every((key) => typeof item[key] === 'string' && item[key].trim())
      || item.text.length > 500 || !Number.isInteger(item.season) || !Number.isInteger(item.week)) {
      throw new Error('Invalid settled-pick reviews. Please reload.');
    }
  }
  if (new Set(value.map(angleReviewKey)).size !== value.length) throw new Error('Duplicate settled-pick reviews. Please reload.');
  return value;
}

export function settledAngleReviews(stories: Array<{
  id: string; pick: string; picks?: AnglePick[]; title: string; matchup: string; game_id: string; season: number; week: number; status: string;
}>, excludeStoryId = ''): AngleReviewPick[] {
  return stories.filter((story) => story.status === 'published' && story.id !== excludeStoryId).flatMap((story) =>
    readAnglePicks(anglePicks(story)).flatMap((pick): AngleReviewPick[] => pick.result === 'pending' ? [] : [{
      story_id: story.id, pick_id: pick.id, text: pick.text, result: pick.result, category: pickCategory(pick),
      title: story.title, matchup: story.matchup, game_id: story.game_id, season: story.season, week: story.week,
    }]));
}
