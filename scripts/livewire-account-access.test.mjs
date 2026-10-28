import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/AccountRequired.tsx', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {}, require(name) {
  assert.equal(name, 'react/jsx-runtime');
  return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
} });
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const AccountRequired = context.exports.default;
const walk = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat().flatMap(walk)];
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : '';

for (const section of ['Analyst Desk', 'GamewAIre']) {
  test(`guests see an account message instead of ${section} content, with a working sign-in action`, () => {
    let clicked = false;
    const content = { type: 'private-content', props: {} };
    const tree = AccountRequired({ hasAccount: false, section, online: true, onSignIn: () => { clicked = true; }, children: content });
    assert.ok(!walk(tree).includes(content));
    assert.ok(text(tree).includes(`Sign in to access ${section}`));
    assert.ok(text(tree).includes('create an account'));
    const button = walk(tree).find((node) => node.type === 'button');
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(clicked, true);
  });
}

test('signed-in accounts retain their content across tabs and offline transitions', () => {
  const content = { type: 'saved-content', props: {} };
  for (const section of ['Analyst Desk', 'GamewAIre', null]) {
    for (const online of [true, false]) {
      assert.equal(AccountRequired({ hasAccount: true, section, online, children: content }), content);
    }
  }
});

test('offline guests are prompted to reconnect, and public tabs have no account gate', () => {
  const tree = AccountRequired({ hasAccount: false, section: 'Analyst Desk', online: false });
  assert.match(text(tree), /Reconnect to the internet/);
  assert.equal(walk(tree).find((node) => node.type === 'button').props.disabled, true);
  assert.equal(AccountRequired({ hasAccount: false, section: null, online: true }), null);
});

test('every Analyst Desk content surface is inside the account gate', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const protectedNames = new Set(['TheAngle', 'FantasyStartSit', 'FavorableMatchups', 'OurResults']);
  const found = new Set();
  const visit = (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && protectedNames.has(opening.tagName.getText(source))) {
      const name = opening.tagName.getText(source);
      found.add(name);
      let ancestor = node.parent;
      while (ancestor && !(ts.isJsxElement(ancestor) && ancestor.openingElement.tagName.getText(source) === 'AccountRequired')) ancestor = ancestor.parent;
      assert.ok(ancestor, `${name} must never mount for guests, including direct links and cached content`);
      const attributes = ancestor.openingElement.attributes.getText(source);
      assert.match(attributes, /hasAccount=\{!!sessionUser\}/, 'Retain verified account sessions offline');
      assert.match(attributes, /view === 'Analyst'/);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.deepEqual(found, protectedNames);
});

test('guest entry cannot enable member feed preloads or unread polling', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /useLivewireUnread|fetchLivewirePosts/);
  assert.match(source, /useAnalystUnread\(authUser\?\.id \?\? null,\s*deletedAccount === null && !authLoading && !!authUser,/);
});
