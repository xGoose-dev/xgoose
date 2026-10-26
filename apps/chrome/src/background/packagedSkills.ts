import { activeSkillsForUrl } from "./skillRegistry";

/** Only reviewed, packaged files use scripting. Dynamic code stays in userScripts. */
export function pageTarget(sender: chrome.runtime.MessageSender) {
  if (typeof sender.tab?.id !== "number" || !sender.documentId) throw new Error("A live page document is required");
  return { tabId: sender.tab.id, documentIds: [sender.documentId] };
}

export async function executableSkillsForUrl(url: string) {
  const candidates = await activeSkillsForUrl(url);
  let scriptsEnabled = false;
  try { await chrome.userScripts.getScripts(); scriptsEnabled = true; } catch { /* optional permission */ }
  const byName = new Map(candidates.map(s => [s.name, s]));
  const usable = (skill: typeof candidates[number], seen = new Set<string>()): boolean => {
    if (seen.has(skill.name) || (!scriptsEnabled && skill.filePath.startsWith("user-skill:"))) return false;
    const next = new Set(seen).add(skill.name);
    return skill.requires.every(ref => {
      const name = ref.replace(/@[^@]+$/, "");
      const dep = byName.get(name) ?? candidates.find(s => s.namespace === name);
      return !!dep && usable(dep, next);
    });
  };
  return candidates.filter(s => usable(s));
}

export async function reconcileSkills(sender: chrome.runtime.MessageSender) {
  const allowed = (await executableSkillsForUrl(sender.url ?? "")).map(s => s.namespace);
  await chrome.scripting.executeScript({target: pageTarget(sender), world: "MAIN", func: (names: string[]) => {
    const root = (globalThis as any).xgoose?.skills;
    if (root) for (const ns of Object.keys(root)) if (!names.includes(ns)) delete root[ns];
  }, args: [allowed]});
}

export async function injectPackagedSkills(sender: chrome.runtime.MessageSender, files: string[]) {
  const active = await executableSkillsForUrl(sender.url ?? "");
  const allowed = new Set(["skillRuntime.js", ...active.filter(s => !s.filePath.startsWith("user-skill:")).map(s => s.filePath)]);
  if (!files.length || files.some(file => !allowed.has(file))) throw new Error("Packaged skill is disabled or unavailable on this page");
  await chrome.scripting.executeScript({target: pageTarget(sender), world: "MAIN", files});
}

/** A fixed metadata reader, never arbitrary JS supplied by a model or website. */
export async function skillSnapshot(sender: chrome.runtime.MessageSender) {
  const active = await executableSkillsForUrl(sender.url ?? "");
  const results = await chrome.scripting.executeScript({target: pageTarget(sender), world: "MAIN", func: (names: string[]) => {
    const root = (globalThis as any).xgoose?.skills;
    return Object.fromEntries(names.filter(ns => Object.hasOwn(root ?? {}, ns)).map(ns => {
      const skill = root[ns];
      return [ns, {functions: skill.__describe__?.(), instructions: skill.__meta__?.instructions}];
    }));
  }, args: [active.map(s => s.namespace)]});
  return results.find(r => r.documentId === sender.documentId)?.result ?? {};
}
