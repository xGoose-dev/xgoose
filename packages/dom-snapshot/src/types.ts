/**
 * Shape of a single dehydrated DOM node.
 *
 * Kept intentionally minimal for v1: string-keyed roles instead of enum
 * indices, no computed styles, no event handler indices, no SVG structure.
 *
 * Nodes are addressed by integer `id` and form a tree via `children`. The
 * mapping `id -> Element` lives in `registry.ts` so future click/type tools
 * can resolve a stale ID back to a live element within the same snapshot
 * window.
 */
export interface DomNode {
  /** Stable integer ID. Also written as `data-xgoose-id` on the live element. */
  id: number;
  /**
   * ARIA role (explicit `role=` if set, otherwise the implicit role from the
   * tag). Common values: `button`, `link`, `heading`, `textbox`, `list`,
   * `listitem`, `main`, `navigation`, `dialog`, `text`.
   */
  role: string;
  /** Accessible name (W3C AccName 1.2). Omitted when empty. */
  name?: string;
  /** Heading level (1-6) for `heading` role. */
  level?: number;
  /** Current value for inputs/selects/textareas. */
  value?: string;
  /** Absolute URL for links. */
  href?: string;
  /** Placeholder text for empty inputs. */
  placeholder?: string;
  /** Input type (`text`, `email`, `checkbox`, …) for inputs. */
  inputType?: string;
  /** Only non-default ARIA states; absent keys mean "default". */
  state?: DomNodeState;
  /** IDs of child semantic nodes (in document order). */
  children?: number[];
  /** True for `iframe` / `frame` host elements (cross-origin not recursed). */
  isFrame?: true;
  /** True if this element was annotated with `data-xgoose-id` for action use. */
  isInteractive?: true;
  /** Plain-text payload for `role: 'text'` nodes. */
  text?: string;
}

export interface DomNodeState {
  disabled?: true;
  required?: true;
  readonly?: true;
  checked?: boolean | "mixed";
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  invalid?: true;
  busy?: true;
  current?: boolean | string;
}

/**
 * Full snapshot returned by `buildDomSnapshot`. `nodes` is keyed by integer
 * ID; walk from `rootIds` via `children`.
 */
export interface DomSnapshot {
  url: string;
  title: string;
  rootIds: number[];
  nodes: Record<number, DomNode>;
  /** True if the walk was scoped to an open modal dialog. */
  modalScoped?: true;
  /** Number of nodes elided because they were hidden or excluded. */
  prunedCount?: number;
}

export interface SnapshotOptions {
  /** Include hidden elements (display:none, aria-hidden, off-screen). Default false. */
  includeHidden?: boolean;
  /**
   * If true and exactly one visible modal dialog is open, scope the walk to
   * it (background page elements are elided from the snapshot). Default true.
   */
  scopeToModal?: boolean;
  /**
   * Maximum number of nodes to emit before truncating. Default 4000 — well
   * above any reasonable LLM context budget once rendered.
   */
  maxNodes?: number;
}
