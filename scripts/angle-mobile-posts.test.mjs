import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

test('Compact Angle styles apply only to mobile post content and preserve readable text and button sizes', () => {
  const css = postcss.parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const mobile = css.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 760px)'
    && node.nodes.some(rule => rule.selector === '.angle-cards .angle-card'));
  assert.ok(mobile);
  const rules = mobile.nodes.filter(rule => rule.selector?.startsWith('.angle-cards '));
  const value = (selector, property) => rules.find(rule => rule.selector === selector)?.nodes.find(node => node.prop === property)?.value;
  assert.equal(value('.angle-cards .angle-card', 'padding'), '10px');
  assert.equal(value('.angle-cards .angle-card-collapsible', 'gap'), '0');
  assert.equal(value('.angle-cards .angle-card h3', 'font-size'), '20px');
  assert.equal(value('.angle-cards .angle-card p', 'line-height'), '1.45');
  assert.equal(value('.angle-cards .angle-card .angle-subject', 'font-size'), '14px');
  assert.ok(rules.every(rule => !/button|angle-editor|player-mode-tabs|angle-heading/.test(rule.selector)));
  assert.ok(rules.every(rule => rule.nodes.every(node => !['zoom', 'transform', 'font-size-adjust'].includes(node.prop))));
  const paragraph = css.nodes.find(node => node.selector === '.angle-card p');
  assert.equal(paragraph.nodes.find(node => node.prop === 'font-size').value, '13px');
  const toggle = css.nodes.find(node => node.selector === '.angle-card .angle-post-toggle');
  assert.equal(toggle.nodes.find(node => node.prop === 'min-height').value, '44px');
});
