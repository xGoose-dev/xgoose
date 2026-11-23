// MAIN-world runtime shared by every skill bundle.
//
// Built into `dist/skillRuntime.js`. Packaged and user skills read
// `defineSkill`, `fn` and `z` from `window.__xgooseSkillRuntime` instead of
// carrying their own copy of zod and the runtime helpers. A packaged bundle
// that passes its `@detect` gate queues itself and asks for this file, so
// pages no skill applies to never receive it. Loading it again is a no-op.

import { defineSkill, fn } from "@xgoose/skill-runtime";
import * as zodNs from "zod";

(() => {
  const w = window as any;
  if (!w.__xgooseSkillRuntime) {
    // Zod's ESM exposes `z` as a named export; some bundlers also stash it
    // on the namespace's `default`. Skill authors write `import { z } from
    // 'zod'`, so any of these candidates gives them the same value.
    const z =
      (zodNs as any).z ?? (zodNs as any).default ?? (zodNs as any);
    w.__xgooseSkillRuntime = { defineSkill, fn, z };
  }
  const pending: Array<() => void> = w.__xgooseSkillPending ?? [];
  delete w.__xgooseSkillPending;
  for (const install of pending) {
    // One skill failing to load must not keep the others from loading.
    try { install(); } catch (error) { reportError(error); }
  }
})();
