import type { RegistrySkill } from "@/shared/types";

let activeSkills: RegistrySkill[] = [];

export function setActiveSkills(next: RegistrySkill[]): void {
  activeSkills = next;
}

export function getActiveSkills(): RegistrySkill[] {
  return activeSkills;
}

export function getCurrentOrigin(): string | null {
  try {
    const u = new URL(location.href);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function getCurrentPageUrl(): string {
  return location.href;
}

export function getCurrentPageTitle(): string {
  return document.title;
}
