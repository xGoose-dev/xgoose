import { send } from "./messages";
// Sync-feeling chrome.storage.local mirror.
// Ported verbatim from xgoose-safari/src/shared/storage.ts — the chrome
// storage surface area is identical between Safari Web Extensions and
// Chrome MV3, so this file is the same minus the `browser` polyfill
// (Chrome only ships `chrome.*`).

import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  LayoutSchema,
  SettingsSchema,
  UserSkillSchema,
  type Layout,
  type ResumePayload,
  type Settings,
  type StoredConversation,
  type UserSkill,
} from "./types";

const SETTINGS_KEY = "xgoose.settings";
const CONVERSATIONS_KEY = "xgoose.conversations";
const MEMORY_PREFIX = "xgoose.memory:";
const SKILLS_DISABLED_KEY = "xgoose.skills.disabled";
const USER_SKILLS_KEY = "xgoose.skills.user";
const LAYOUT_KEY = "xgoose.layout";
const PANEL_OPEN_PREFIX = "xgoose.panelOpen:";
const LAST_CONVO_KEY = "xgoose.lastConvo";
const RESUME_KEY = "xgoose.resume";

type Mirror = {
  settings: Settings;
  disabledSkills: Set<string>;
  userSkills: Map<string, UserSkill>;
  memory: Map<string, string>;
  panelOpen: Map<string, boolean>;
  layout: Layout;
};

const mirror: Mirror = {
  settings: { ...DEFAULT_SETTINGS },
  disabledSkills: new Set(),
  userSkills: new Map(),
  memory: new Map(),
  panelOpen: new Map(),
  layout: { ...DEFAULT_LAYOUT },
};

let loaded: Promise<void> | null = null;

export function loadAll(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    const all = await chrome.storage.local.get(null);
    if (all[SETTINGS_KEY]) {
      const parsed = SettingsSchema.safeParse(all[SETTINGS_KEY]);
      mirror.settings = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
      // One-shot migration: if the user has a legacy flat `apiKey` /
      // `baseUrl` (from before per-provider keys), seed the map slot for
      // their currently-selected provider. We don't try to attribute the
      // value to any OTHER provider — that's impossible to infer — but
      // this preserves the working credential of whoever is upgrading
      // and lets them subsequently type a different key for a different
      // provider without losing this one.
      const s = mirror.settings;
      let dirty = false;
      if (s.apiKey && !s.apiKeys?.[s.provider]) {
        s.apiKeys = { ...(s.apiKeys ?? {}), [s.provider]: s.apiKey };
        dirty = true;
      }
      if (s.baseUrl && !s.baseUrls?.[s.provider]) {
        s.baseUrls = { ...(s.baseUrls ?? {}), [s.provider]: s.baseUrl };
        dirty = true;
      }
      if (dirty) {
        void chrome.storage.local.set({ [SETTINGS_KEY]: s });
      }
    }
    if (Array.isArray(all[SKILLS_DISABLED_KEY])) {
      mirror.disabledSkills = new Set(all[SKILLS_DISABLED_KEY] as string[]);
    }
    if (Array.isArray(all[USER_SKILLS_KEY])) {
      mirror.userSkills = new Map();
      for (const raw of all[USER_SKILLS_KEY] as unknown[]) {
        const parsed = UserSkillSchema.safeParse(raw);
        if (parsed.success)
          mirror.userSkills.set(parsed.data.name, parsed.data);
      }
    }
    if (all[LAYOUT_KEY]) {
      const parsed = LayoutSchema.safeParse(all[LAYOUT_KEY]);
      if (parsed.success) mirror.layout = parsed.data;
    }
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(MEMORY_PREFIX) && typeof value === "string") {
        mirror.memory.set(key.slice(MEMORY_PREFIX.length), value);
      } else if (
        key.startsWith(PANEL_OPEN_PREFIX) &&
        typeof value === "boolean"
      ) {
        mirror.panelOpen.set(key.slice(PANEL_OPEN_PREFIX.length), value);
      }
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const [key, change] of Object.entries(changes)) {
        const v = (change as chrome.storage.StorageChange).newValue;
        if (key === SETTINGS_KEY) {
          const parsed = SettingsSchema.safeParse(v);
          mirror.settings = parsed.success
            ? parsed.data
            : { ...DEFAULT_SETTINGS };
        } else if (key === SKILLS_DISABLED_KEY) {
          mirror.disabledSkills = new Set(
            Array.isArray(v) ? (v as string[]) : [],
          );
        } else if (key === USER_SKILLS_KEY) {
          mirror.userSkills = new Map();
          if (Array.isArray(v)) {
            for (const raw of v as unknown[]) {
              const parsed = UserSkillSchema.safeParse(raw);
              if (parsed.success)
                mirror.userSkills.set(parsed.data.name, parsed.data);
            }
          }
        } else if (key === LAYOUT_KEY) {
          const parsed = LayoutSchema.safeParse(v);
          mirror.layout = parsed.success ? parsed.data : { ...DEFAULT_LAYOUT };
        } else if (key.startsWith(MEMORY_PREFIX)) {
          if (typeof v === "string")
            mirror.memory.set(key.slice(MEMORY_PREFIX.length), v);
          else mirror.memory.delete(key.slice(MEMORY_PREFIX.length));
        } else if (key.startsWith(PANEL_OPEN_PREFIX)) {
          if (typeof v === "boolean")
            mirror.panelOpen.set(key.slice(PANEL_OPEN_PREFIX.length), v);
          else mirror.panelOpen.delete(key.slice(PANEL_OPEN_PREFIX.length));
        }
      }
    });
  })();
  return loaded;
}

export function getSettings(): Settings {
  return mirror.settings;
}
export async function saveSettings(next: Settings): Promise<void> {
  mirror.settings = next;
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}

export function isSkillDisabled(name: string): boolean {
  return mirror.disabledSkills.has(name);
}
export async function setSkillDisabled(
  name: string,
  disabled: boolean,
): Promise<void> {
  if (disabled) mirror.disabledSkills.add(name);
  else mirror.disabledSkills.delete(name);
  await chrome.storage.local.set({
    [SKILLS_DISABLED_KEY]: Array.from(mirror.disabledSkills),
  });
}
export function listDisabledSkills(): string[] {
  return Array.from(mirror.disabledSkills);
}

export function listUserSkills(): UserSkill[] {
  return Array.from(mirror.userSkills.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}
export function getUserSkill(name: string): UserSkill | null {
  return mirror.userSkills.get(name) ?? null;
}
export async function saveUserSkill(skill: UserSkill): Promise<void> {
  const existing = mirror.userSkills.get(skill.name);
  const next: UserSkill = {
    ...skill,
    createdAt: existing?.createdAt ?? skill.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  mirror.userSkills.set(next.name, next);
  await chrome.storage.local.set({
    [USER_SKILLS_KEY]: Array.from(mirror.userSkills.values()),
  });
}
export async function deleteUserSkill(name: string): Promise<void> {
  if (!mirror.userSkills.delete(name)) return;
  await chrome.storage.local.set({
    [USER_SKILLS_KEY]: Array.from(mirror.userSkills.values()),
  });
}

const MAX_MEMORY_LINES = 20;
const MAX_MEMORY_BYTES = 2048;

export function getMemoryForOrigin(origin: string): string {
  return mirror.memory.get(origin) ?? "";
}
export async function appendMemoryForOrigin(
  origin: string,
  note: string,
): Promise<string> {
  const existing = mirror.memory.get(origin) ?? "";
  const cleaned = note.trim().replace(/\s+/g, " ");
  if (!cleaned) return existing;
  const ts = new Date().toISOString().split("T")[0];
  const next = (existing ? existing + "\n" : "") + `- ${ts}: ${cleaned}`;
  const trimmed = trimMemory(next);
  mirror.memory.set(origin, trimmed);
  await chrome.storage.local.set({ [MEMORY_PREFIX + origin]: trimmed });
  return trimmed;
}
export async function clearMemoryForOrigin(origin: string): Promise<void> {
  mirror.memory.delete(origin);
  await chrome.storage.local.remove(MEMORY_PREFIX + origin);
}
function trimMemory(blob: string): string {
  const lines = blob.split("\n").filter(Boolean);
  let kept = lines.slice(-MAX_MEMORY_LINES);
  while (kept.join("\n").length > MAX_MEMORY_BYTES && kept.length > 1) {
    kept = kept.slice(1);
  }
  return kept.join("\n");
}

export function getLayout(): Layout {
  return mirror.layout;
}
export async function saveLayout(next: Layout): Promise<void> {
  mirror.layout = next;
  await chrome.storage.local.set({ [LAYOUT_KEY]: next });
}

export function isPanelOpenForOrigin(origin: string): boolean {
  return mirror.panelOpen.get(origin) ?? false;
}
export async function setPanelOpenForOrigin(
  origin: string,
  open: boolean,
): Promise<void> {
  mirror.panelOpen.set(origin, open);
  await chrome.storage.local.set({ [PANEL_OPEN_PREFIX + origin]: open });
}

// Conversation snapshots are scoped to the extension's IndexedDB.
export async function listConversations(): Promise<StoredConversation[]> { return send("sw:session", { op: "list" }); }
export async function getConversation(id: string): Promise<StoredConversation | null> { return send("sw:session", { op: "get", id }); }
export async function saveConversation(value: StoredConversation): Promise<void> { await send("sw:session", { op: "save", value }); }
export async function deleteConversation(id: string): Promise<void> { await send("sw:session", { op: "delete", id }); }
export function newConversationId(): string { return crypto.randomUUID(); }
// Compatibility shims for v1 callers. Navigation never restores or runs a task.
export async function getLastConvoIdGlobal(): Promise<null> { return null; }
export async function setLastConvoIdGlobal(_id: string): Promise<void> {}
export async function getResumeGlobal(): Promise<null> { return null; }
export async function setResumeGlobal(_payload: ResumePayload): Promise<void> {}
export async function clearResumeGlobal(): Promise<void> {}
