import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
import {bundleUserSkill} from '../apps/chrome/src/background/skillBundler.ts';
import {parseSkillFile} from '../packages/skill-runtime/src/header.ts';

test('the shipped skill authoring guide matches the canonical copy', () => {
  assert.equal(readFileSync('apps/chrome/skills/SKILL_AUTHORING.md', 'utf8'), readFileSync('packages/skill-runtime/SKILL_AUTHORING.md', 'utf8'));
});

test('the LinkedIn marketplace source bundles and loads in the extension', () => {
  const {body, header} = parseSkillFile(readFileSync('apps/chrome/skills/linkedin.xgs.js', 'utf8'));
  const {bundled} = bundleUserSkill(body, header);
  const window = {
    __xgooseSkillRuntime: {z, defineSkill: (functions: object) => functions, fn: (spec: {handler: unknown}) => spec.handler},
    xgoose: {skills: {} as Record<string, Record<string, unknown>>},
  };
  runInNewContext(bundled, {window});
  assert.equal(typeof window.xgoose.skills.linkedin.searchPeople, 'function');
});
