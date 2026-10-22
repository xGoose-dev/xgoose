// MAIN-world helper for dynamically-installed user skills.
//
// Built into `dist/skillRuntime.js` and injected on-demand by
// `skillInjector.ts` right before evaluating a user-skill IIFE.
// Idempotent: re-injection is a no-op once `window.__xgooseSkillRuntime`
// is populated.
//
// User-skill IIFEs reference the runtime via the global so they don't
// need to ship their own copy of zod + the runtime helpers in every
// bundle (a 250 KB savings per skill). Built-in skills continue to
// ship a fully self-contained bundle and do NOT depend on this global.

import { defineSkill, fn } from "@xgoose/skill-runtime";
import * as zodNs from "zod";

(() => {
  const w = window as any;
  if (w.__xgooseSkillRuntime) return;
  // Zod's ESM exposes `z` as a named export; some bundlers also stash it
  // on the namespace's `default`. Skill authors write `import { z } from
  // 'zod'`, so any of these candidates gives them the same value.
  const z =
    (zodNs as any).z ?? (zodNs as any).default ?? (zodNs as any);
  w.__xgooseSkillRuntime = { defineSkill, fn, z };
})();
