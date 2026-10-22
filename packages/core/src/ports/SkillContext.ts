import type { SkillRef } from "../types";

/**
 * View of the skill subsystem from `@xgoose/core`'s perspective. Core only
 * needs to know which skills are active on the current page (to emit the
 * "# Active skills on this page" section of the system reminder) and to
 * read the registry for tools that the host provides. The actual
 * registry storage, injection mechanics, and skill_call / help / read_skill
 * tools all live in the host.
 */
export interface SkillContext {
  /** Skills whose `@match`/`@detect` rules currently fire on this page. */
  getActiveSkills(): SkillRef[];
}

/**
 * No-op SkillContext for hosts that don't ship skills at all.
 */
export const NoSkillContext: SkillContext = {
  getActiveSkills: () => [],
};
