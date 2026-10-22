/**
 * `@xgoose/dom-snapshot` — compact DOM dehydration for the xgoose agent.
 *
 * Walks a live DOM subtree and produces a flat, LLM-friendly semantic
 * snapshot with stable element IDs.
 *
 * Typical usage (from a tool definition):
 *
 *     import { buildDomSnapshot, renderText, awaitDomQuiet } from '@xgoose/dom-snapshot';
 *
 *     await awaitDomQuiet({ debounceMs: 250 });
 *     const snap = buildDomSnapshot(document.body);
 *     const text = renderText(snap);
 *
 * Action tools (TBD) resolve `[id=N]` back to a live element via
 * `resolveId(N)`.
 */

export { buildDomSnapshot } from "./dehydrate";
export { renderText, renderJson } from "./render";
export { awaitDomQuiet, type DomQuietOptions } from "./stabilize";
export { resolveId, ID_ATTR } from "./registry";
export type {
  DomNode,
  DomNodeState,
  DomSnapshot,
  SnapshotOptions,
} from "./types";
