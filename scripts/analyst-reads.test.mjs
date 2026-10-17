import assert from 'node:assert/strict';
import test from 'node:test';
import { analystGuestKey, analystReceiptKey, guestAnalystReads, picksReadKey, readAnalystItems } from '../src/services/analystReads.ts';
import { angleCategories, angleLeadGroup, angleLeadGroups } from '../src/services/theAngle.ts';

test('published picks versions and individual players have independent receipt keys', () => {
  assert.equal(picksReadKey(2026,6,1,'123'), '2026:6:1:123');
  const keys = ['123','456','empty'].flatMap((player) => [1,2].map((revision) => analystReceiptKey({kind:'picks',key:picksReadKey(2026,6,revision,player)})));
  assert.equal(new Set(keys).size,6);
  assert.notEqual(picksReadKey(2026,6,1,'123'),picksReadKey(2026,7,1,'123'));
});

test('unread payloads reject malformed keys rather than silently clear the indicator', () => {
  const valid = [{kind:'angle',key:'11111111-1111-4111-8111-111111111111'},{kind:'picks',key:'2026:6:2:123'},{kind:'picks',key:'2026:6:2:empty'}];
  assert.deepEqual(readAnalystItems(valid),valid);
  assert.deepEqual(readAnalystItems([]),[]);
  for (const invalid of [null,{},[{kind:'draft',key:'x'}],[{kind:'picks',key:'2026:6:0:123'}],[{kind:'angle',key:123}],[{kind:'angle',key:'bad'}]]) {
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
