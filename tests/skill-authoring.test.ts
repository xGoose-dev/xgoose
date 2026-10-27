import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the shipped skill authoring guide matches the canonical copy', () => {
  assert.equal(readFileSync('apps/chrome/skills/SKILL_AUTHORING.md', 'utf8'), readFileSync('packages/skill-runtime/SKILL_AUTHORING.md', 'utf8'));
});
