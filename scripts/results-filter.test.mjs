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
    export const fixture = (rows, sport, category = null) => { states = [rows, false, true, '', '', '', '', false, 0, sport, category]; index = 0; };
    const useEffect = () => {}; const useState = () => [states[index++], () => {}];`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/import \{ supabase \} from [^;]+;/, 'const supabase = null;')
  .replace(/from ['"]\.\/services\/theAngle['"]/g, `from '${new URL('../src/services/theAngle.ts', import.meta.url)}'`)
  .replace(/from ['"]\.\/services\/anglePicks['"]/g, `from '${new URL('../src/services/anglePicks.ts', import.meta.url)}'`)
  .replace(/import \{ PickResult \} from [^;]+;/, 'const PickResult = () => null;');
const { default: Results, fixture } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rows = ['NFL', 'NBA', 'NHL', 'UCL'].flatMap((sport) => [6, 7].map((week) => ({
  id: `${sport}-${week}`, game_id: `${sport}:0`, matchup: `${sport} fixture`, title: `${sport} story`,
  season: 2026, week, status: 'published', pick: '',
  picks: ['hit', 'miss', 'pending'].map((result) => ({ id: `${sport}-${week}-${result}`, text: `${sport} ${week} ${result}`, result })),
})));
test('Sport records filter all-week picks without changing records, losing pending picks, or dropping story links', () => {
  for (const sport of [null, 'NFL', 'NBA', 'NHL', 'UCL', 'SOCCER', 'COMBO']) {
    fixture(rows, sport);
    const html = renderToStaticMarkup(createElement(Results, { user: null }));
    const feed = html.slice(html.indexOf('id="results-picks-feed"'));
    assert.equal((feed.match(/<article /g) ?? []).length, sport === null ? 24 : ['SOCCER', 'COMBO'].includes(sport) ? 0 : 6);
    assert.match(html, /8 Wins/);
    assert.match(html, /8 Losses/);
    if (sport && !['SOCCER', 'COMBO'].includes(sport)) {
      assert.match(feed, new RegExp(`${sport} 6 pending`));
      assert.match(feed, new RegExp(`${sport} 7 hit`));
      for (const other of ['NFL', 'NBA', 'NHL', 'UCL'].filter((value) => value !== sport)) assert.ok(!feed.includes(`${other} fixture`));
      assert.equal((feed.match(/View story/g) ?? []).length, 6);
    }
    if (sport) assert.match(html, /Show all sports/);
    if (sport === 'SOCCER') assert.match(html, /No published Soccer picks yet/);
    if (sport === 'COMBO') assert.match(html, /No published Combo picks yet/);
  }
});

test('Separate Straight and Parlay records exclude Sprinkles while type and sport filters preserve every pick', () => {
  const stories = [{
    ...rows[0], picks: [
      { id: 'straight-hit', text: 'Straight win', result: 'hit', category: 'straight' },
      { id: 'parlay-miss', text: 'Three leg parlay', result: 'miss', category: 'parlay' },
      { id: 'sprinkle-hit', text: 'Sprinkle win', result: 'hit', category: 'sprinkle' },
      { id: 'sprinkle-miss', text: 'Sprinkle loss', result: 'miss', category: 'sprinkle' },
    ],
  }];
  for (const [category, count] of [[null, 4], ['straight', 1], ['parlay', 1], ['sprinkle', 2]]) {
    fixture(stories, 'NFL', category);
    const html = renderToStaticMarkup(createElement(Results, { user: null }));
    assert.match(html, /Straight record/);
    assert.match(html, /Parlay record/);
    assert.equal((html.match(/1 Wins/g) ?? []).length, 1, 'Sprinkle win is not counted');
    assert.equal((html.match(/1 Losses/g) ?? []).length, 1, 'Sprinkle loss is not counted');
    const feed = html.slice(html.indexOf('id="results-picks-feed"'));
    assert.equal((feed.match(/<article /g) ?? []).length, count);
    if (category === 'sprinkle') assert.match(feed, /Sprinkle win/);
  }
});

test('CFB and UFC retain independent results and selectable record filters', () => {
  const stories = ['CFB', 'UFC'].map((sport) => ({ ...rows[0], id: `${sport}-story`, game_id: `${sport}:0`,
    title: `${sport} bet`, matchup: `${sport} matchup`, picks: [
      { id: `${sport}-win`, text: `${sport} winning pick`, result: 'hit', category: 'straight' },
      { id: `${sport}-loss`, text: `${sport} losing parlay`, result: 'miss', category: 'parlay' },
    ] }));
  for (const sport of ['CFB', 'UFC']) {
    fixture(stories, sport);
    const html = renderToStaticMarkup(createElement(Results, { user: null }));
    const feed = html.slice(html.indexOf('id="results-picks-feed"'));
    assert.equal((feed.match(/<article /g) ?? []).length, 2);
    assert.match(feed, new RegExp(`${sport} winning pick`));
    assert.match(feed, new RegExp(`${sport} losing parlay`));
    assert.ok(!feed.includes(`${sport === 'CFB' ? 'UFC' : 'CFB'} matchup`));
    assert.equal((html.match(/2 Wins/g) ?? []).length, 1);
    assert.equal((html.match(/2 Losses/g) ?? []).length, 1);
  }
});

test('Combo sport filter displays multi-sport parlays with their own sport label and record row', () => {
  const stories = [{ ...rows[0], game_id: 'COMBO:0', matchup: 'NBA + NFL + NHL',
    picks: [{ id: 'combo', text: 'Multi-sport parlay', result: 'hit', category: 'parlay' }] }, rows[0]];
  fixture(stories, 'COMBO', 'parlay');
  const html = renderToStaticMarkup(createElement(Results, { user: null }));
  assert.match(html, /Combo picks/);
  assert.match(html, /Parlay record/);
  const feed = html.slice(html.indexOf('id="results-picks-feed"'));
  assert.equal((feed.match(/<article /g) ?? []).length, 1);
  assert.match(feed, /Combo/);
  assert.match(feed, /Multi-sport parlay/);
  assert.doesNotMatch(feed, /NFL fixture/);
});
