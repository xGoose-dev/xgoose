/**
 * Two ways to serialise a `DomSnapshot` for an LLM:
 *
 *   - `renderText`   : indented YAML-ish lines, Playwright-aria-snapshot style.
 *                       Best for showing the agent the page shape with
 *                       minimal tokens.
 *   - `renderJson`   : structured `{rootIds, nodes}` shape (just returns the
 *                       same object). Best when a downstream tool will
 *                       resolve element IDs to act on.
 *
 * The text renderer is intentionally line-oriented and stable — the agent
 * will see the same string layout for the same DOM, which helps it write
 * diffs in its head.
 */

import type { DomNode, DomNodeState, DomSnapshot } from "./types";

export function renderJson(snapshot: DomSnapshot): DomSnapshot {
  return snapshot;
}

/**
 * Render the snapshot as indented text. Each line has the form:
 *
 *     <indent><role> "<name>"[ extras] [id=N]
 *
 * `extras` includes heading level, link href, input value, ARIA states.
 * `[id=N]` is only shown for nodes that were annotated as interactive.
 */
export function renderText(snapshot: DomSnapshot): string {
  const lines: string[] = [];
  if (snapshot.modalScoped) {
    lines.push("# scope: modal dialog (background page elided)");
  }
  if (snapshot.url) lines.push(`# url: ${snapshot.url}`);
  if (snapshot.title) lines.push(`# title: ${snapshot.title}`);
  if (lines.length > 0) lines.push("");

  const seen = new Set<number>();
  for (const rootId of snapshot.rootIds) {
    renderNode(snapshot, rootId, 0, lines, seen);
  }

  if (snapshot.prunedCount) {
    lines.push("");
    lines.push(`# (${snapshot.prunedCount} hidden nodes elided)`);
  }
  return lines.join("\n");
}

function renderNode(
  snapshot: DomSnapshot,
  id: number,
  depth: number,
  out: string[],
  seen: Set<number>,
): void {
  if (seen.has(id)) return;
  seen.add(id);
  const node = snapshot.nodes[id];
  if (!node) return;

  const indent = "  ".repeat(depth);
  out.push(indent + formatNode(node));

  if (node.children) {
    for (const childId of node.children) {
      renderNode(snapshot, childId, depth + 1, out, seen);
    }
  }
}

function formatNode(node: DomNode): string {
  if (node.role === "text") {
    const t = (node.text ?? "").replace(/"/g, '\\"');
    return `text "${t}"`;
  }

  const parts: string[] = [node.role];
  if (node.role === "heading" && node.level) {
    parts[0] = `heading h${node.level}`;
  }
  if (node.name) {
    parts.push(`"${node.name.replace(/"/g, '\\"')}"`);
  }
  if (node.href) {
    parts.push(node.href);
  }
  if (node.inputType) {
    parts.push(`type=${node.inputType}`);
  }
  if (node.value) {
    parts.push(`value="${node.value.replace(/"/g, '\\"')}"`);
  } else if (node.placeholder) {
    parts.push(`placeholder="${node.placeholder.replace(/"/g, '\\"')}"`);
  }
  if (node.state) {
    const tags = formatState(node.state);
    if (tags) parts.push(tags);
  }
  if (node.isInteractive) {
    parts.push(`[id=${node.id}]`);
  } else if (node.isFrame) {
    parts.push(`[id=${node.id} frame]`);
  }
  return parts.join(" ");
}

function formatState(st: DomNodeState): string {
  const tags: string[] = [];
  if (st.disabled) tags.push("disabled");
  if (st.required) tags.push("required");
  if (st.readonly) tags.push("readonly");
  if (st.invalid) tags.push("invalid");
  if (st.busy) tags.push("busy");
  if (st.checked === true) tags.push("checked");
  else if (st.checked === "mixed") tags.push("checked=mixed");
  if (st.pressed === true) tags.push("pressed");
  else if (st.pressed === "mixed") tags.push("pressed=mixed");
  if (st.expanded === true) tags.push("expanded");
  else if (st.expanded === false) tags.push("collapsed");
  if (st.selected === true) tags.push("selected");
  if (st.current === true) tags.push("current");
  else if (typeof st.current === "string") tags.push(`current=${st.current}`);
  if (tags.length === 0) return "";
  return `{${tags.join(",")}}`;
}
