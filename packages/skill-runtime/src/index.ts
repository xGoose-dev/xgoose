/**
 * Public entry point for `@xgoose/skill`. Skill authors `import` from
 * here (resolved by the build via a tsconfig path alias):
 *
 *   import { defineSkill, fn } from '@xgoose/skill';
 *   import { z } from 'zod';
 *
 * Everything in here is browser-safe; the Node-only build helpers live
 * under `scripts/skill-build/`.
 */

export { defineSkill, fn } from "./define";
export type {
  FnSpec,
  FnHelp,
  FnSummaryMap,
  SkillBundle,
  SkillHeader,
  SkillAction,
  RunAt,
} from "./types";
export { SkillHeaderSchema, SkillActionSchema, RunAtSchema } from "./types";
export {
  findHeader,
  parseDirectives,
  parseSkillFile,
  renderHeader,
  rewriteVersion,
  SkillHeaderError,
  HEADER_START_RE,
  HEADER_END_RE,
} from "./header";
