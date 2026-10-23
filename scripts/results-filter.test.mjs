import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/OurResults.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
  .replace(/import \{ useEffect, useState \} from ['"]react['"];/, `let states = [], index = 0;
    export const fixture = (rows, sport) => { states = [rows, false, true, '', '', '', '', false, 0, sport]; index = 0; };
    const useEffect = () => {}; const useState = () => [states[index++], () => {}];`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/import \{ supabase \} from [^;]+;/, 'const supabase = null;')
  .replace(/from ['"]\.\/services\/theAngle['"]/g, `from '${new URL('../src/services/theAngle.ts', import.meta.url)}'`)
  .replace(/import \{ PickResult \} from [^;]+;/, 'const PickResult = () => null;');
const { default: Results, fixture } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rows = ['NFL', 'NBA', 'NHL', 'UCL'].flatMap((sport) => [6, 7].map((week) => ({
  id: `${sport}-${week}`, game_id: `${sport}:0`, matchup: `${sport} fixture`, title: `${sport} story`,
  season: 2026, week, status: 'published', pick: '',
  picks: ['hit', 'miss', 'pending'].map((result) => ({ id: `${sport}-${week}-${result}`, text: `${sport} ${week} ${result}`, result })),
})));
test('Sport records filter all-week picks without changing records, losing pending picks, or dropping story links', () => {
  for (const sport of [null, 'NFL', 'NBA', 'NHL', 'UCL', 'SOCCER']) {
    fixture(rows, sport);
    const html = renderToStaticMarkup(createElement(Results, { user: null }));
    const feed = html.slice(html.indexOf('id="results-picks-feed"'));
    assert.equal((feed.match(/<article /g) ?? []).length, sport === null ? 24 : sport === 'SOCCER' ? 0 : 6);
    assert.match(html, /8 Wins/);
    assert.match(html, /8 Losses/);
    if (sport && sport !== 'SOCCER') {
      assert.match(feed, new RegExp(`${sport} 6 pending`));
      assert.match(feed, new RegExp(`${sport} 7 hit`));
      for (const other of ['NFL', 'NBA', 'NHL', 'UCL'].filter((value) => value !== sport)) assert.ok(!feed.includes(`${other} fixture`));
      assert.equal((feed.match(/View story/g) ?? []).length, 6);
    }
    if (sport) assert.match(html, /Show all sports/);
    if (sport === 'SOCCER') assert.match(html, /No published Soccer picks yet/);
  }
});
