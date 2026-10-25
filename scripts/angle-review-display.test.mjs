import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
    .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
    .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`);
}
const picksCode = compile('../src/AnglePicks.tsx')
  .replace(/from ['"].\/services\/anglePicks['"]/g, `from '${new URL('../src/services/anglePicks.ts', import.meta.url)}'`);
const picksUrl = `data:text/javascript;base64,${Buffer.from(picksCode).toString('base64')}`;
const reviewCode = compile('../src/AngleReviewPicks.tsx')
  .replace(/from ['"].\/AnglePicks['"]/g, `from '${picksUrl}'`)
  .replace(/import \{ supabase \} from [^;]+;/, 'const supabase = null;')
  .replace(/from ['"].\/services\/theAngle['"]/g, `from '${new URL('../src/services/theAngle.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/angleReviews['"]/g, `from '${new URL('../src/services/angleReviews.ts', import.meta.url)}'`);
const { AngleReviewList } = await import(`data:text/javascript;base64,${Buffer.from(reviewCode).toString('base64')}`);

test('Published attached settled picks show only pick text and hit/miss icons without review boilerplate or source metadata', () => {
  const picks = ['hit', 'miss'].map((result, index) => ({
    story_id: `story-${index}`, pick_id: `pick-${index}`, result, category: 'parlay',
    text: `Player ${index} over points\nTeam ${index} moneyline`, title: 'Original story title',
    matchup: 'Original matchup', season: 2026, week: 7, game_id: 'NBA:123',
  }));
  const html = renderToStaticMarkup(createElement(AngleReviewList, { picks }));
  assert.match(html, /Player 0 over points\nTeam 0 moneyline/);
  assert.match(html, /Player 1 over points\nTeam 1 moneyline/);
  assert.match(html, /pick-result-hit.*aria-label="Hit"/);
  assert.match(html, /pick-result-miss.*aria-label="Missed"/);
  assert.doesNotMatch(html, /Past picks|Review only|Results when attached|Our Results|Original|Admin pick|Opinion|<h4|<a /);
  assert.equal(renderToStaticMarkup(createElement(AngleReviewList, { picks: [] })), '');
});
