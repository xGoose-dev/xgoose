// Public surface of `@xgoose/core/tools` — the host's tool-composition
// file imports these factories, calls them with its port adapters, and
// merges the result with the page-controller tools and any host-specific
// tools (e.g. skill_call on the Safari host).

export {
  defineTool,
  type XgooseBuiltTool,
  type XgooseToolDef,
  type XgooseToolMeta,
  type XgooseToolExecOptions,
  type XgooseToolContentPart,
} from "./buildTool";

export { createTodoWriteTool } from "./todoWrite";
export {
  createRememberTool,
  createForgetTool,
  type MemoryToolDeps,
} from "./memory";

import type { XgooseBuiltTool } from "./buildTool";
import { createTodoWriteTool } from "./todoWrite";
import {
  createRememberTool,
  createForgetTool,
  type MemoryToolDeps,
} from "./memory";

/**
 * One-shot helper that returns the three browser-agnostic core tools the
 * agent always wants: `todo_write`, `remember`, `forget`. The host glues
 * these into its tool array alongside `@xgoose/page-controller`'s DOM
 * tools and any host-specific tools.
 */
export function buildCoreTools(deps: MemoryToolDeps): XgooseBuiltTool[] {
  return [
    createTodoWriteTool(),
    createRememberTool(deps),
    createForgetTool(deps),
  ];
}
