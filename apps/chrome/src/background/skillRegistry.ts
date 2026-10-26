import {isSafari} from "@/shared/host";
import builtinCatalogIdentities from "@/shared/builtinCatalog.json";
/// <reference types="chrome" />
//
// Chrome skill registry. Ported verbatim from
// xgoose-safari/src/background/skillRegistry.ts — same chrome.storage
// keys, same registry.json shape, same user-skill override semantics.

import { skillUrlActive } from "@/shared/patterns";
import {
  RegistrySkillSchema,
  UserSkillSchema,
  type RegistrySkill,
  type UserSkill,
} from "@/shared/types";
import { parseSkillFile, SkillHeaderError } from "@xgoose/skill-runtime/header";
import { bundleUserSkill, introspectFunctions } from "./skillBundler";

export const USER_SKILL_FILEPATH_PREFIX = "user-skill:";

let cachedBuiltin: RegistrySkill[] | null = null;

async function loadBuiltinRegistry(): Promise<RegistrySkill[]> {
  if (cachedBuiltin) return cachedBuiltin;
  const url = chrome.runtime.getURL("skills/registry.json");
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[xgoose] registry fetch failed", res.status);
      cachedBuiltin = [];
      return cachedBuiltin;
    }
    const raw = (await res.json()) as unknown[];
    cachedBuiltin = [];
    for (const r of raw) {
      const parsed = RegistrySkillSchema.safeParse(r);
      if (parsed.success) cachedBuiltin.push(parsed.data);
      else
        console.warn("[xgoose] invalid registry entry", parsed.error.format());
    }
    return cachedBuiltin;
  } catch (err) {
    console.warn("[xgoose] registry load error", err);
    cachedBuiltin = [];
    return cachedBuiltin;
  }
}

const DISABLED_KEY = "xgoose.skills.disabled";
const USER_SKILLS_KEY = "xgoose.skills.user";

async function getDisabledSet(): Promise<Set<string>> {
  const data = await chrome.storage.local.get(DISABLED_KEY);
  const raw = data[DISABLED_KEY];
  return new Set(Array.isArray(raw) ? (raw as string[]) : []);
}

async function getUserSkills(): Promise<UserSkill[]> {
  const data = await chrome.storage.local.get(USER_SKILLS_KEY);
  const raw = data[USER_SKILLS_KEY];
  if (!Array.isArray(raw)) return [];
  const out: UserSkill[] = [];
  for (const r of raw) {
    const parsed = UserSkillSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function userSkillAsRegistry(u: UserSkill): RegistrySkill {
  return {
    name: u.name,
    version: u.version,
    namespace: u.namespace,
    description: u.description,
    matches: u.matches,
    include: u.include,
    exclude: u.exclude,
    detect: u.detect,
    runAt: u.runAt,
    allFrames: u.allFrames,
    requires: u.requires,
    connect: u.connect,
    primary: u.primary,
    keywords: u.keywords,
    homepage: u.homepage,
    author: u.author,
    actions: u.actions,
    extra: u.extra,
    functions: u.functions,
    instructions: u.instructions,
    sha: "",
    // Carry the user-skill's last-write timestamp through to the content
    // script's injection cache so `edit_skill` / republish hot-reloads
    // in any already-open tab — see `skillInjector.ts` fingerprintFor().
    updatedAt: u.updatedAt,
    filePath: `${USER_SKILL_FILEPATH_PREFIX}${u.name}`,
  };
}

export async function loadRegistry(): Promise<RegistrySkill[]> {
  const [builtin, users] = await Promise.all([
    loadBuiltinRegistry(),
    getUserSkills(),
  ]);
  const byName = new Map<string, RegistrySkill>();
  for (const s of builtin) byName.set(s.name, s);
  for (const u of (isSafari ? [] : users)) byName.set(u.name, userSkillAsRegistry(u));
  return Array.from(byName.values());
}

export async function listSkillsWithEnabled(): Promise<
  Array<RegistrySkill & { enabled: boolean; userAuthored: boolean }>
> {
  const [all, disabled, users] = await Promise.all([
    loadRegistry(),
    getDisabledSet(),
    getUserSkills(),
  ]);
  const userNames = new Set(users.map((u) => u.name));
  return all.map((s) => ({
    ...s,
    enabled: !disabled.has(s.name),
    userAuthored: userNames.has(s.name),
  }));
}

/** URL candidates only. The content host must filter by the loaded @detect result. */
export async function activeSkillsForUrl(
  url: string,
): Promise<RegistrySkill[]> {
  const [all, disabled] = await Promise.all([loadRegistry(), getDisabledSet()]);
  const byName = new Map(all.map(s => [s.name, s]));
  const usable = (skill: RegistrySkill, seen = new Set<string>()): boolean => {
    if (disabled.has(skill.name) || seen.has(skill.name)) return false;
    const next = new Set(seen).add(skill.name);
    return skill.requires.every(ref => {
      const name = ref.replace(/@[^@]+$/, "");
      const dep = byName.get(name) ?? all.find(s => s.namespace === name);
      return !!dep && usable(dep, next);
    });
  };
  const chosen = new Map<string, RegistrySkill>();
  const add = (s: RegistrySkill) => {
    for (const ref of s.requires) {
      const name = ref.replace(/@[^@]+$/, "");
      const dep = byName.get(name) ?? all.find(x => x.namespace === name);
      if (dep && !chosen.has(dep.name)) add(dep);
    }
    chosen.set(s.name, s);
  };
  for (const skill of all) if (usable(skill) && skillUrlActive({url,matches:skill.matches,include:skill.include,exclude:skill.exclude})) add(skill);
  return Array.from(chosen.values());
}

export async function getDisabledSkills(): Promise<string[]> {
  const set = await getDisabledSet();
  return Array.from(set);
}

export async function setSkillDisabled(
  name: string,
  disabled: boolean,
): Promise<void> {
  const set = await getDisabledSet();
  if (disabled) set.add(name);
  else set.delete(name);
  await chrome.storage.local.set({ [DISABLED_KEY]: Array.from(set) });
}

export async function getUserSkillCode(
  name: string,
): Promise<UserSkill | null> {
  const users = await getUserSkills();
  return users.find((u) => u.name === name) ?? null;
}

export async function saveUserSkill(skill: UserSkill): Promise<void> {
  const users = await getUserSkills();
  if (["__proto__","prototype","constructor"].includes(skill.namespace)) throw new Error("Reserved skill namespace");
  const all = await loadRegistry();
  const conflict = all.find(s => s.namespace === skill.namespace && s.name !== skill.name);
  if (conflict) throw new Error(`Namespace ${skill.namespace} already belongs to ${conflict.name}`);
  const idx = users.findIndex((u) => u.name === skill.name);
  const merged: UserSkill = {
    ...skill,
    createdAt:
      idx >= 0 ? users[idx].createdAt : (skill.createdAt ?? Date.now()),
    updatedAt: Date.now(),
  };
  if (idx >= 0) users[idx] = merged;
  else users.push(merged);
  await chrome.storage.local.set({ [USER_SKILLS_KEY]: users });
}

export async function deleteUserSkill(name: string): Promise<void> {
  const users = await getUserSkills();
  const next = users.filter((u) => u.name !== name);
  if (next.length === users.length) return;
  await chrome.storage.local.set({ [USER_SKILLS_KEY]: next });
}

export async function listUserSkills(): Promise<UserSkill[]> {
  return getUserSkills();
}

export async function getSkillSource(name: string): Promise<{
  source: string;
  origin: "user" | "builtin";
} | null> {
  const user = await getUserSkillCode(name);
  if (user) return { source: user.source, origin: "user" };
  const builtin = (await loadBuiltinRegistry()).find((s) => s.name === name);
  if (!builtin) return null;
  try {
    if (!builtin.sourcePath) return null;
    const url = chrome.runtime.getURL(builtin.sourcePath);
    const res = await fetch(url);
    if (!res.ok) return null;
    return { source: await res.text(), origin: "builtin" };
  } catch {
    return null;
  }
}

function stripHeader(source: string): string | null {
  try {
    const parsed = parseSkillFile(source);
    return parsed.body;
  } catch {
    return null;
  }
}

export async function editSkillFromSource(args: {
  name: string;
  source: string;
}): Promise<
  | {
      ok: true;
      name: string;
      namespace: string;
      version: string;
      bodyChanged: boolean;
    }
  | { ok: false; error: string }
> {
  let parsed;
  try {
    parsed = parseSkillFile(args.source);
  } catch (err) {
    if (err instanceof SkillHeaderError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
  if (parsed.header.name !== args.name) {
    return {
      ok: false,
      error: `Header @name "${parsed.header.name}" doesn't match edit target "${args.name}". Rename via a separate install rather than rename-on-edit.`,
    };
  }

  const existing = await getUserSkillCode(args.name);
  if (existing?.readOnly) return {ok:false,error:"This legacy bundle has no editable source. Install an updated source package."};
  const previousSource = existing
    ? existing.source
    : (await loadBuiltinRegistry()).find((s) => s.name === args.name)
      ? await fetchBuiltinSource(args.name).catch(() => null)
      : null;
  const previousBody = previousSource ? stripHeader(previousSource) : null;
  const bodyChanged = parsed.body !== (previousBody ?? "");

  // Bundle the body into a self-contained IIFE that the skill injector
  // can run via `chrome.scripting.executeScript`. If the body is
  // unchanged we keep the existing bundle to avoid drifting the
  // function summaries on a header-only edit.
  let bundled = existing?.bundled ?? "";
  let functions = existing?.functions ?? [];
  if (bodyChanged || !bundled) {
    try {
      const out = bundleUserSkill(parsed.body, parsed.header);
      bundled = out.bundled;
      functions = introspectFunctions(out.bundled, parsed.header);
    } catch (err) {
      return {
        ok: false,
        error: `bundle failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  const builtinOrigin = !existing ? (await loadBuiltinRegistry()).find(s => s.name === args.name) : undefined;
  const next: UserSkill = UserSkillSchema.parse({
    ...existing,
    ...parsed.header,
    identity: existing?.identity ?? (builtinOrigin ? (builtinCatalogIdentities as Record<string,{authorId:string;skillId:string}>)[args.name] : undefined),
    sourceSha: existing?.sourceSha ?? builtinOrigin?.sourceSha,
    source: args.source,
    bundled,
    functions,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  await saveUserSkill(next);

  return {
    ok: true,
    name: next.name,
    namespace: next.namespace,
    version: next.version,
    bodyChanged,
  };
}

async function fetchBuiltinSource(name: string): Promise<string | null> {
  const built = (await loadBuiltinRegistry()).find((s) => s.name === name);
  if (!built) return null;
  if (!built.sourcePath) return null;
  const url = chrome.runtime.getURL(built.sourcePath);
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

async function fetchBuiltinBundled(name: string): Promise<string> {
  const src = await fetchBuiltinSource(name);
  if (!src) return "";
  return stripHeader(src) ?? "";
}
