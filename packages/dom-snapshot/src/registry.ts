/**
 * Per-snapshot mapping from integer ID -> live Element.
 *
 * Why a module-level singleton (rather than passed-through state):
 *   - The dehydration tool annotates DOM nodes with `data-xgoose-id="N"`.
 *     Action tools (`click_by_id`, `type_by_id` — TBD) run in separate
 *     LLM turns, so they need a way to recover the Element from just an
 *     integer.
 *   - We can't trust the DOM attribute alone (the page could be torn down,
 *     or the element could have been re-rendered with a new identity). A
 *     WeakMap kept in JS lets us know whether the original Element is
 *     still live, and shortcuts the DOM lookup.
 *
 * Concurrency: not safe across concurrent snapshots. The `read_page_semantic`
 * tool is declared `isConcurrencySafe: false` so the agent runtime serialises
 * calls.
 */

import type { DomNode } from "./types";

const XGOOSE_ID_ATTR = "data-xgoose-id";

/** Inverse map: id -> Element. Used by future action tools. */
const idToElement: Map<number, WeakRef<Element>> = new Map();
/** Cached node data, keyed by ID. */
let nodes: Record<number, DomNode> = {};
/** Monotonic counter, reset on every `beginSnapshot`. */
let nextId = 1;

/**
 * Start a fresh snapshot. Clears registry state and removes any leftover
 * `data-xgoose-id` attributes within `scope` from a previous snapshot.
 */
export function beginSnapshot(scope: Element): void {
  // Strip stale annotations so they don't accumulate across runs.
  const stale = scope.querySelectorAll(`[${XGOOSE_ID_ATTR}]`);
  for (const el of Array.from(stale)) el.removeAttribute(XGOOSE_ID_ATTR);
  if (scope.hasAttribute(XGOOSE_ID_ATTR)) scope.removeAttribute(XGOOSE_ID_ATTR);

  idToElement.clear();
  nodes = {};
  nextId = 1;
}

/**
 * Allocate a fresh integer ID for `el` and remember the mapping. Optionally
 * writes the `data-xgoose-id` DOM attribute so the agent can also reach the
 * element via a plain selector.
 */
export function allocateId(el: Element, annotate: boolean): number {
  const id = nextId++;
  idToElement.set(id, new WeakRef(el));
  if (annotate) {
    try {
      el.setAttribute(XGOOSE_ID_ATTR, String(id));
    } catch {
      // Some sandboxed elements (e.g. inside cross-origin iframes) throw
      // when you try to mutate their attributes; that's fine, the WeakRef
      // is still valid.
    }
  }
  return id;
}

/** Record the built `DomNode` for a previously-allocated ID. */
export function setNode(id: number, node: DomNode): void {
  nodes[id] = node;
}

export function getNodes(): Record<number, DomNode> {
  return nodes;
}

/**
 * Resolve an ID to the original Element, or `null` if the element has been
 * garbage-collected or removed from the document.
 *
 * Falls back to a DOM query for the `data-xgoose-id` attribute, since the
 * WeakRef can drop the element on a GC even while it's still in the live
 * tree (Safari is aggressive about this).
 */
export function resolveId(
  id: number,
  doc: Document = document,
): Element | null {
  const ref = idToElement.get(id);
  const el = ref?.deref();
  if (el && el.isConnected) return el;
  const fallback = doc.querySelector(`[${XGOOSE_ID_ATTR}="${id}"]`);
  if (fallback) {
    idToElement.set(id, new WeakRef(fallback));
    return fallback;
  }
  return null;
}

export const ID_ATTR = XGOOSE_ID_ATTR;
