/**
 * DOM dehydration walker. Single recursive pass that turns a live DOM
 * subtree into a flat `{ rootIds, nodes }` map keyed by integer ID.
 *
 * The walker follows a three-tier filter:
 *
 *   1. Always keep:    interactive elements (button, a[href], input, ...)
 *   2. Keep if named:  landmarks, lists, tables, headings (structural roles)
 *   3. Otherwise:      transparent — recurse into children but don't emit a
 *                      node for this element. Free-floating text nodes
 *                      become `role: 'text'` children of the nearest kept
 *                      ancestor (or of root if none).
 *
 * Text node dedup: child text under name-from-content roles (button, link,
 * heading...) is dropped because that text is already in the parent's
 * `name` field.
 */

import { computeAccessibleName } from "./accname";
import { beginSnapshot, allocateId, setNode, getNodes } from "./registry";
import {
  EXCLUDED_TAGS,
  NAME_FROM_CONTENT_ROLES,
  STRUCTURAL_ROLES,
  resolveRole,
} from "./roles";
import type {
  DomNode,
  DomNodeState,
  DomSnapshot,
  SnapshotOptions,
} from "./types";
import { isInteractiveTag, isInvisible } from "./visibility";

const MODAL_SELECTOR =
  'dialog[open],[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]';

const TEXT_NODE_MIN_LEN = 1;
const TEXT_NODE_MAX_LEN = 500;

interface WalkState {
  prunedCount: number;
  nodeCount: number;
  maxNodes: number;
  includeHidden: boolean;
  truncated: boolean;
}

function emptyState(opts: SnapshotOptions): WalkState {
  return {
    prunedCount: 0,
    nodeCount: 0,
    maxNodes: Math.max(50, opts.maxNodes ?? 4000),
    includeHidden: !!opts.includeHidden,
    truncated: false,
  };
}

/**
 * Build a `DomSnapshot` for the subtree rooted at `root`.
 */
export function buildDomSnapshot(
  root: Element,
  opts: SnapshotOptions = {},
): DomSnapshot {
  beginSnapshot(root);
  const state = emptyState(opts);

  const doc = root.ownerDocument ?? document;
  const url = doc.URL ?? "";
  const title = doc.title ?? "";

  // Modal scoping: if exactly one visible modal dialog is open and it
  // lives inside `root`, restrict the walk to it so the agent isn't fed
  // the background page that the user can't currently interact with.
  let effectiveRoot = root;
  let modalScoped = false;
  if (opts.scopeToModal !== false) {
    const modals = Array.from(doc.querySelectorAll(MODAL_SELECTOR)).filter(
      (m) => !isInvisible(m),
    );
    if (modals.length === 1) {
      const m = modals[0]!;
      if (root.contains(m)) {
        effectiveRoot = m;
        modalScoped = true;
      } else if (m.contains(root)) {
        // Page-level walk already inside the modal; nothing to change.
      }
    }
  }

  const rootIds = walkChildren(effectiveRoot, state, null);

  // The walker returns child IDs; if `effectiveRoot` itself qualified as a
  // semantic node it's already in there. If `effectiveRoot` is the body or
  // similar generic container, we collapse its role and just use its
  // children as the snapshot roots.

  const snapshot: DomSnapshot = {
    url,
    title,
    rootIds,
    nodes: getNodes(),
  };
  if (modalScoped) snapshot.modalScoped = true;
  if (state.prunedCount > 0) snapshot.prunedCount = state.prunedCount;
  if (state.truncated) {
    // Mark the last allocated node with a sentinel — easier than threading a
    // separate flag, and the renderer can surface it.
    snapshot.nodes[-1] = {
      id: -1,
      role: "text",
      text: `[truncated: hit maxNodes=${state.maxNodes}]`,
    };
    snapshot.rootIds.push(-1);
  }
  return snapshot;
}

/**
 * Walk an element's children and return the list of semantic node IDs (plus
 * synthetic text nodes) that survive the filter.
 *
 * If `parentRole` is set and is in `NAME_FROM_CONTENT_ROLES`, raw text
 * children are dropped (already in the parent's `name`).
 */
function walkChildren(
  el: Element,
  state: WalkState,
  parentRole: string | null,
): number[] {
  const out: number[] = [];
  if (state.truncated) return out;

  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (state.truncated) break;
    if (n.nodeType === Node.ELEMENT_NODE) {
      const child = n as Element;
      if (EXCLUDED_TAGS.has(child.tagName)) continue;
      // Skip our own widget chrome if the host extension marked it.
      // Hosts (e.g. xgoose-safari) can set `data-xgoose-widget` on their
      // shadow-host roots to exclude the agent's own UI from the snapshot.
      if (child.hasAttribute("data-xgoose-widget")) continue;
      const ids = processElement(child, state, parentRole);
      out.push(...ids);
    } else if (n.nodeType === Node.TEXT_NODE) {
      const textId = processTextNode(n as Text, state, parentRole);
      if (textId != null) out.push(textId);
    }
  }
  return out;
}

/**
 * Decide whether `el` becomes its own semantic node or is transparent.
 * Returns the node IDs (this element's, or its children's) to append at the
 * caller's level.
 */
function processElement(
  el: Element,
  state: WalkState,
  parentRole: string | null,
): number[] {
  if (state.truncated) return [];

  if (!state.includeHidden && isInvisible(el)) {
    state.prunedCount++;
    return [];
  }

  // iframe / frame: emit a placeholder, no recursion. Cross-origin frames
  // would throw on contentDocument access anyway; same-origin can be reached
  // by re-running the snapshot tool with a different selector from inside
  // the frame.
  if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
    const id = allocateId(el, true);
    const src = (el as HTMLIFrameElement).src || "";
    const node: DomNode = {
      id,
      role: "frame",
      isFrame: true,
      isInteractive: true,
    };
    const name = computeAccessibleName(el, "frame");
    if (name) node.name = name;
    if (src) node.href = src;
    setNode(id, node);
    state.nodeCount++;
    if (state.nodeCount >= state.maxNodes) state.truncated = true;
    return [id];
  }

  const role = resolveRole(el);
  const interactive = isInteractiveTag(el);

  // Build a tentative node first so we can compute the accessible name once
  // (it's the expensive part) and decide whether to keep this element.
  let name = "";
  if (role || interactive) {
    name = computeAccessibleName(el, role);
  }

  const keep = shouldKeepElement(el, role, interactive, name);

  if (!keep) {
    // Transparent: pass through to children with the parent's role so they
    // attach at the right level.
    return walkChildren(el, state, parentRole);
  }

  const id = allocateId(el, interactive);
  const node: DomNode = {
    id,
    role: role ?? "generic",
  };
  if (name) node.name = name;
  if (interactive) node.isInteractive = true;

  // Heading level
  if (role === "heading") {
    const explicit = el.getAttribute("aria-level");
    const lvl =
      explicit && /^\d+$/.test(explicit)
        ? Number(explicit)
        : Number(el.tagName[1]);
    if (Number.isFinite(lvl) && lvl >= 1 && lvl <= 6) node.level = lvl;
  }

  // Link href
  if (el.tagName === "A" && (el as HTMLAnchorElement).href) {
    node.href = (el as HTMLAnchorElement).href;
  }

  // Form-control specifics
  attachFormFields(el, node);

  // ARIA states
  const state_ = readAriaStates(el);
  if (state_) node.state = state_;

  setNode(id, node);
  state.nodeCount++;
  if (state.nodeCount >= state.maxNodes) {
    state.truncated = true;
    return [id];
  }

  // Recurse into children with this node's role so they know whether to
  // suppress redundant text content.
  const childIds = walkChildren(el, state, role);
  if (childIds.length > 0) node.children = childIds;
  return [id];
}

function shouldKeepElement(
  el: Element,
  role: string | null,
  interactive: boolean,
  name: string,
): boolean {
  if (interactive) return true;
  if (!role) return false;
  // Always keep structural roles (landmarks, lists, headings, tables, dialogs)
  if (STRUCTURAL_ROLES.has(role)) return true;
  // Keep non-structural roles only if they have a meaningful name or are
  // explicitly tagged with `role=` (i.e. the page author asked for this role).
  if (name) return true;
  if (el.hasAttribute("role")) return true;
  // `<p>`, `<code>`, `<img>` etc. — keep `img` if it has an alt; otherwise
  // they collapse into the parent text.
  if (role === "img") return !!name;
  if (role === "paragraph") return false; // text nodes inside will surface
  return false;
}

function attachFormFields(el: Element, node: DomNode): void {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const inp = el as HTMLInputElement;
    const type = (inp.type || "text").toLowerCase();
    if (type !== "text") node.inputType = type;
    if (type === "checkbox" || type === "radio") {
      // Checked state is captured in ARIA states block.
    } else if (inp.value) {
      node.value = inp.value.slice(0, 200);
    }
    if (inp.placeholder && !node.name) {
      node.placeholder = inp.placeholder;
    }
  } else if (tag === "TEXTAREA") {
    const ta = el as HTMLTextAreaElement;
    if (ta.value) node.value = ta.value.slice(0, 200);
    if (ta.placeholder && !node.name) node.placeholder = ta.placeholder;
  } else if (tag === "SELECT") {
    const sel = el as HTMLSelectElement;
    const opt = sel.options[sel.selectedIndex];
    if (opt) node.value = opt.textContent?.trim().slice(0, 200);
  }
}

function readAriaStates(el: Element): DomNodeState | undefined {
  const st: DomNodeState = {};
  let any = false;

  if (
    (el as HTMLInputElement).disabled ||
    el.getAttribute("aria-disabled") === "true"
  ) {
    st.disabled = true;
    any = true;
  }
  if (
    el.hasAttribute("required") ||
    el.getAttribute("aria-required") === "true"
  ) {
    st.required = true;
    any = true;
  }
  if (
    (el as HTMLInputElement).readOnly ||
    el.getAttribute("aria-readonly") === "true"
  ) {
    st.readonly = true;
    any = true;
  }
  const checkedAttr = el.getAttribute("aria-checked");
  if (checkedAttr !== null) {
    st.checked = checkedAttr === "mixed" ? "mixed" : checkedAttr === "true";
    any = true;
  } else if (
    el.tagName === "INPUT" &&
    ((el as HTMLInputElement).type === "checkbox" ||
      (el as HTMLInputElement).type === "radio")
  ) {
    if ((el as HTMLInputElement).checked) {
      st.checked = true;
      any = true;
    }
  }
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true" || expanded === "false") {
    st.expanded = expanded === "true";
    any = true;
  }
  const pressed = el.getAttribute("aria-pressed");
  if (pressed !== null) {
    st.pressed = pressed === "mixed" ? "mixed" : pressed === "true";
    any = true;
  }
  const selected = el.getAttribute("aria-selected");
  if (selected === "true" || selected === "false") {
    st.selected = selected === "true";
    any = true;
  }
  if (el.getAttribute("aria-invalid") === "true") {
    st.invalid = true;
    any = true;
  }
  if (el.getAttribute("aria-busy") === "true") {
    st.busy = true;
    any = true;
  }
  const current = el.getAttribute("aria-current");
  if (current !== null && current !== "false") {
    st.current = current === "true" ? true : current;
    any = true;
  }

  return any ? st : undefined;
}

/**
 * Promote a `Text` node into a `role: 'text'` semantic node, unless the
 * parent already absorbs its text via name-from-content. Whitespace-only
 * nodes are dropped.
 */
function processTextNode(
  tn: Text,
  state: WalkState,
  parentRole: string | null,
): number | null {
  if (state.truncated) return null;
  if (parentRole && NAME_FROM_CONTENT_ROLES.has(parentRole)) return null;
  const raw = (tn.data ?? "").replace(/\s+/g, " ").trim();
  if (raw.length < TEXT_NODE_MIN_LEN) return null;
  const id = allocateId(tn.parentElement as Element, false);
  const node: DomNode = {
    id,
    role: "text",
    text:
      raw.length > TEXT_NODE_MAX_LEN
        ? raw.slice(0, TEXT_NODE_MAX_LEN - 1) + "…"
        : raw,
  };
  setNode(id, node);
  state.nodeCount++;
  if (state.nodeCount >= state.maxNodes) state.truncated = true;
  return id;
}
