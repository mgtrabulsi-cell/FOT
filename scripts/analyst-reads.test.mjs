import assert from 'node:assert/strict';
import test from 'node:test';
import { analystGuestKey, analystReceiptKey, guestAnalystReads, picksReadKey, readAnalystItems } from '../src/services/analystReads.ts';
import { angleCategories, angleLeadGroup, angleLeadGroups } from '../src/services/theAngle.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('Individual Angle dots follow persisted receipts, clear only after successful reads and stay account scoped', async () => {
  const source = readFileSync(new URL('../src/useAnalystUnread.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
  const items = [{ kind: 'angle', key: first }, { kind: 'angle', key: second }];
  const stored = new Set(), states = [], refs = [], effects = [], calls = [];
  let stateIndex = 0, refIndex = 0, initial = true, failed = false;
  const context = vm.createContext({
    exports: {}, analystGuestKey, analystReceiptKey, guestAnalystReads, readAnalystItems,
    useState(value) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = value;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value }; },
    useCallback: (callback) => callback,
    useEffect: (effect) => { if (initial) effects.push(effect); },
    navigator: { onLine: true }, console: { error() {} },
    window: { setInterval() {}, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    supabase: { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'fantasy_unread_items') return { data: items.filter((item) => !stored.has(analystReceiptKey(item))), error: null };
      if (failed) return { error: new Error('Offline') };
      stored.add(`${args.item_kind}:${args.item_key}`);
      return { error: null };
    } },
  });
  vm.runInContext(code, context);
  const render = (account = 'member') => {
    stateIndex = 0; refIndex = 0;
    return context.exports.useAnalystUnread(account, true, 2026, 7);
  };
  render(); initial = false; effects.forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  let hook = render();
  assert.deepEqual([...hook.unreadKeys], items.map(analystReceiptKey), 'Loading the feed alone does not read any post');
  assert.deepEqual(calls, ['fantasy_unread_items']);
  failed = true;
  await assert.rejects(hook.markRead('angle', first), /Offline/);
  assert.equal(render().unreadKeys.length, 2, 'Failed receipt leaves the red dot');
  failed = false;
  await hook.markRead('angle', first);
  hook = render();
  assert.deepEqual([...hook.unreadKeys], [`angle:${second}`], 'Opening one post leaves the others unread');
  assert.equal(hook.angle, true);
  await hook.markRead('angle', second);
  hook = render();
  assert.equal(hook.unreadKeys.length, 0);
  assert.equal(hook.angle, false);
  assert.equal(stored.size, 2, 'Receipts persist via the existing server RPC');
  assert.equal(render('different-account').unreadKeys.length, 0, 'No prior-account state is exposed');
});

test('Unread dot is accessible on each collapsed Angle title; only opened post content is observed as read', () => {
  const source = readFileSync(new URL('../src/TheAngle.tsx', import.meta.url), 'utf8');
  assert.match(source, /unreadKeys\.includes\(`angle:\$\{angle\.id\}`\)/);
  assert.match(source, /className="angle-post-unread" role="img" aria-label="Unread post"/);
  assert.match(source, /\(news \|\| expandedPosts\.includes\(angle\.id\)\) && <div className="angle-post-content" data-post-id=\{angle\.id\}/);
  assert.match(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), /unreadKeys=\{analystUnread\.unreadKeys\}/);
});

test('published picks versions and individual players have independent receipt keys', () => {
  assert.equal(picksReadKey(2026,6,1,'123'), '2026:6:1:123');
  const keys = ['123','456','empty'].flatMap((player) => [1,2].map((revision) => analystReceiptKey({kind:'picks',key:picksReadKey(2026,6,revision,player)})));
  assert.equal(new Set(keys).size,6);
  assert.notEqual(picksReadKey(2026,6,1,'123'),picksReadKey(2026,7,1,'123'));
  assert.notEqual(analystReceiptKey({kind:'picks',key:'2026:6:1:123'}), analystReceiptKey({kind:'hate',key:'2026:6:1:123'}));
});

test('unread payloads reject malformed keys rather than silently clear the indicator', () => {
  const valid = [{kind:'angle',key:'11111111-1111-4111-8111-111111111111'},{kind:'news',key:'22222222-2222-4222-8222-222222222222'},{kind:'picks',key:'2026:6:2:123'},{kind:'picks',key:'2026:6:2:empty'},{kind:'hate',key:'2026:6:2:123'},{kind:'hate',key:'2026:6:2:empty'}];
  assert.deepEqual(readAnalystItems(valid),valid);
  assert.deepEqual(readAnalystItems([]),[]);
  for (const invalid of [null,{},[{kind:'draft',key:'x'}],[{kind:'picks',key:'2026:6:0:123'}],[{kind:'hate',key:'2026:6:0:123'}],[{kind:'angle',key:123}],[{kind:'angle',key:'bad'}]]) {
    assert.throws(()=>readAnalystItems(invalid),/invalid Analyst Desk/);
  }
});

test('guest receipts persist separately, filter seen items, and report corrupt storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)}});
  try {
    assert.equal(guestAnalystReads().size,0);
    const item = {kind:'picks',key:picksReadKey(2026,6,1,'123')};
    localStorage.setItem(analystGuestKey,JSON.stringify([analystReceiptKey(item)]));
    assert.ok(guestAnalystReads().has(analystReceiptKey(item)));
    assert.ok(!guestAnalystReads().has(analystReceiptKey({...item,key:picksReadKey(2026,6,2,'123')})));
    localStorage.setItem(analystGuestKey,'{}');
    assert.throws(()=>guestAnalystReads(),/invalid/);
    localStorage.setItem(analystGuestKey,'not json');
    assert.throws(()=>guestAnalystReads());
  } finally {
    if(original)Object.defineProperty(globalThis,'localStorage',original);
    else delete globalThis.localStorage;
  }
});

test('admin lead sections preserve every category and separate birthdays from game trends and milestones', () => {
  assert.deepEqual(angleLeadGroups.slice(0,3),['Birthdays','Game trends','Milestones & comebacks']);
  assert.equal(angleLeadGroup('Birthday'),'Birthdays');
  for (const category of ['Former team','Head-to-head history','Rivalry / rematch']) assert.equal(angleLeadGroup(category),'Game trends');
  for (const category of ['Milestone / comeback','Public life event']) assert.equal(angleLeadGroup(category),'Milestones & comebacks');
  assert.equal(angleLeadGroup('Other'),'Other storylines');
  assert.ok(angleCategories.every(category=>angleLeadGroups.includes(angleLeadGroup(category))));
});
