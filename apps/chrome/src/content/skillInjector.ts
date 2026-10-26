/// <reference types="chrome" />
//
// Chrome skill injector. Differs from safari's DOM-injection approach:
// Chrome MV3 sites commonly enforce script-src CSPs that block both
// `<script src="chrome-extension://...">` and blob: URLs. Using
// chrome.scripting.executeScript({world: 'MAIN'}) from the SW bypasses
// page CSP for the injection step, so built-in and user skills load
// reliably across the web.
//
// User-skill bundles run via `chrome.userScripts.execute()` (Chrome
// 135+, requires the `userScripts` manifest permission AND the
// per-extension "Allow User Scripts" toggle in chrome://extensions).
// The USER_SCRIPT injection path is exempt from page CSP, so strict
// sites like global.americanexpress.com (no `unsafe-eval`) still work.
// Before each user-skill IIFE runs we inject `skillRuntime.js` (a
// web-accessible MAIN-world file that mounts the real
// `defineSkill`/`fn`/`z` on `window.__xgooseSkillRuntime`). User-skill
// bundles reference that global so they don't have to ship their own
// copy of zod + the runtime in every IIFE (~250 KB savings per skill).

import { send } from "@/shared/messages";
import type { RegistrySkill } from "@/shared/types";
import { ensurePageBridge } from "./pageRpc";

const USER_SKILL_PREFIX = "user-skill:";
const SKILL_RUNTIME_FILE = "skillRuntime.js";

// Per-skill injection cache keyed by name → content fingerprint. The
// fingerprint changes when the skill's underlying bundle changes:
//   - User skills: `u:<updatedAt>`. `edit_skill` and `sw:save_user_skill`
//     both stamp `Date.now()` into `UserSkill.updatedAt`, so any edit
//     produces a different fingerprint and the next `injectSkills` call
//     re-runs the IIFE. The IIFE's tail does `Object.assign(window.xgoose
//     .skills[ns], __skill__)`, so re-injection cleanly replaces the
//     callable functions without a page reload.
//   - Built-in skills: `b:<filePath>` (content-addressed; their bundle
//     never changes mid-session, so the fingerprint is constant).
//
// This means `create_skill`/`edit_skill` calls during an active agent
// turn become invocable in the agent's next `js_exec` once the SW pushes
// the updated active set (or the tool itself triggers an immediate
// injection — see `editSkillTool`/`createSkillTool` in tools/index.ts).
const injectedSkills = new Map<string, string>();
// One-shot per content-script lifetime: lazy-injects `skillRuntime.js`
// into the page MAIN world right before the first user-skill IIFE runs.
// Built-in skills bundle their own runtime, so they don't trigger this.
let skillRuntimeReady: Promise<void> | null = null;

export { ensurePageBridge };

function fingerprintFor(s: RegistrySkill): string {
  if (s.filePath.startsWith(USER_SKILL_PREFIX)) {
    return `u:${s.updatedAt ?? 0}`;
  }
  return `b:${s.sha || s.filePath}`;
}

async function ensureSkillRuntime(): Promise<void> {
  if (!skillRuntimeReady) {
    skillRuntimeReady = (async () => {
      const res = await send("sw:inject_skill_files", {
        files: [SKILL_RUNTIME_FILE],
      });
      if (!res.ok) {
        skillRuntimeReady = null;
        throw new Error(`failed to inject skillRuntime.js: ${res.error}`);
      }
    })();
  }
  return skillRuntimeReady;
}

async function injectUserSkill(s: RegistrySkill): Promise<void> {
  const name = s.filePath.slice(USER_SKILL_PREFIX.length);
  const skill = await send("sw:get_user_skill", { name });
  if (!skill) throw new Error(`user-skill not found in storage: ${name}`);
  const status = await send("sw:user_scripts_status", undefined);
  if (!status.enabled) return; // Built-in injection and discovery remain available.
  const wrapped = skill.bundled;
  if (!wrapped || !wrapped.trim()) {
    throw new Error(`user-skill ${name} has no bundled IIFE`);
  }
  await ensureSkillRuntime();
  const res = await send("sw:inject_skill_code", { code: wrapped });
  if (!res.ok) throw new Error(res.error);
}

export async function injectSkills(skills: RegistrySkill[]): Promise<void> {
  await send("sw:reconcile_skills", undefined);
  for (const name of injectedSkills.keys()) if (!skills.some(s => s.name === name)) injectedSkills.delete(name);
  if (!skills.length) return;
  await ensurePageBridge();

  const builtinFiles: string[] = [];
  const builtinNames: string[] = [];
  const builtinFps: string[] = [];
  const userSkills: RegistrySkill[] = [];

  for (const s of skills) {
    const fp = fingerprintFor(s);
    if (injectedSkills.get(s.name) === fp) continue;
    if (s.filePath.startsWith(USER_SKILL_PREFIX)) {
      userSkills.push(s);
    } else {
      builtinFiles.push(s.filePath);
      builtinNames.push(s.name);
      builtinFps.push(fp);
    }
  }

  if (builtinFiles.length) {
    try {
      const res = await send("sw:inject_skill_files", { files: builtinFiles });
      if (res.ok) {
        for (let i = 0; i < builtinNames.length; i++) {
          injectedSkills.set(builtinNames[i], builtinFps[i]);
        }
      } else {
        console.warn("[xgoose] inject built-in skills failed:", res.error);
      }
    } catch (err) {
      console.warn("[xgoose] inject built-in skills threw:", err);
    }
  }

  for (const s of userSkills) {
    try {
      await injectUserSkill(s);
      if ((await send("sw:user_scripts_status", undefined)).enabled) injectedSkills.set(s.name, fingerprintFor(s));
    } catch (err) {
      console.warn(`[xgoose] failed to inject user skill ${s.name}:`, err);
    }
  }
}

/** Force the next `injectSkills` to re-run the IIFE for these skills,
 *  even if their fingerprint hasn't changed. Use after `edit_skill` to
 *  guarantee the new bundle lands on the page even if the storage
 *  watcher push arrives before the tool's own proactive injection. */
export function invalidateInjectedSkills(names: Iterable<string>): void {
  for (const n of names) injectedSkills.delete(n);
}

export function resetInjectedSkills(): void {
  injectedSkills.clear();
  skillRuntimeReady = null;
}

export function injectedSkillNames(): string[] {
  return Array.from(injectedSkills.keys());
}

/** URL matches are candidates; a bundle's @detect gate can still reject it. */
export async function detectActiveSkills(candidates: RegistrySkill[]): Promise<RegistrySkill[]> {
  let loaded: Awaited<ReturnType<typeof send<"sw:skill_snapshot">>>;
  try {
    await injectSkills(candidates);
    loaded = await send("sw:skill_snapshot", undefined);
  } catch { return []; }
  const namespaces = new Set(Object.keys(loaded));
  const byName = new Map(candidates.map(s => [s.name, s]));
  return candidates.filter(s => namespaces.has(s.namespace) && s.requires.every(ref => {
    const name = ref.replace(/@[^@]+$/, "");
    const dependency = byName.get(name) ?? candidates.find(d => d.namespace === name);
    return !!dependency && namespaces.has(dependency.namespace);
  }));
}
