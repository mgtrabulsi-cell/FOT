import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

test('Site copy uses provider-neutral labels without changing feed URLs or comments', () => {
  const root = new URL('../src/', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(name => /\.tsx?$/.test(name));
  const mentions = [];
  for (const name of files) {
    const path = fileURLToPath(new URL(name.replaceAll('\\', '/'), root));
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        const copy = node.text.replace(/https?:\/\/[^\s"'<>`]+/gi, '');
        if (/\bESPN\b/.test(copy)) mentions.push(`${name}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(mentions, []);
  const nba = readFileSync(new URL('../src/NBAExperience.tsx', import.meta.url), 'utf8');
  assert.ok(nba.includes('role="status">Loading data…</p>'));
});
