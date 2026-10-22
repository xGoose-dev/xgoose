/**
 * Curated subset of W3C HTML-AAM implicit role mappings, scoped to the
 * elements that actually carry semantic value for an LLM agent reading a
 * page.
 *
 * Tags not in `IMPLICIT_ROLE` and not bearing an explicit `role=` attribute
 * are treated as `presentation` / `generic` and only kept if they have
 * children worth keeping (see `dehydrate.ts:processElement`).
 *
 * @see https://www.w3.org/TR/html-aam-1.0/#html-element-role-mappings
 */
export const IMPLICIT_ROLE: Record<string, string> = {
  // Headings
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",

  // Landmarks
  MAIN: "main",
  NAV: "navigation",
  HEADER: "banner",
  FOOTER: "contentinfo",
  ASIDE: "complementary",
  SECTION: "region",
  ARTICLE: "article",
  FORM: "form",
  SEARCH: "search",

  // Interactive
  A: "link",
  BUTTON: "button",
  SELECT: "combobox",
  TEXTAREA: "textbox",
  SUMMARY: "button",
  DETAILS: "group",

  // Structural / content
  UL: "list",
  OL: "list",
  LI: "listitem",
  DL: "list",
  DT: "term",
  DD: "definition",
  P: "paragraph",
  BLOCKQUOTE: "blockquote",
  PRE: "group",
  CODE: "code",
  IMG: "img",
  PICTURE: "img",
  FIGURE: "figure",
  FIGCAPTION: "caption",

  // Tables
  TABLE: "table",
  THEAD: "rowgroup",
  TBODY: "rowgroup",
  TFOOT: "rowgroup",
  TR: "row",
  TD: "cell",
  TH: "columnheader",
  CAPTION: "caption",

  // Misc
  HR: "separator",
  DIALOG: "dialog",
  LABEL: "label",
  OPTION: "option",
  OPTGROUP: "group",
  FIELDSET: "group",
  LEGEND: "legend",
  PROGRESS: "progressbar",
  METER: "meter",
};

/**
 * `<input type=…>` → ARIA role.
 * @see https://www.w3.org/TR/html-aam-1.0/#input-type-text-input-type-search-input-type-tel-input-type-url-and-input-type-email-and-textarea-element-accessibility-api-mappings
 */
export const INPUT_TYPE_ROLE: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  text: "textbox",
  tel: "textbox",
  url: "textbox",
  email: "textbox",
  password: "textbox",
  date: "textbox",
  "datetime-local": "textbox",
  time: "textbox",
  month: "textbox",
  week: "textbox",
  color: "textbox",
  file: "button",
  hidden: "presentation",
};

/**
 * Roles where the visible text content already contributes to the accessible
 * name. Free-floating child text nodes under these roles are dropped from the
 * snapshot to avoid duplicating the same string twice (once in `name`, once
 * in a `text` child).
 *
 * @see https://www.w3.org/TR/accname-1.2/#mapping_additional_nd_te
 */
export const NAME_FROM_CONTENT_ROLES = new Set<string>([
  "button",
  "link",
  "heading",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "cell",
  "columnheader",
  "rowheader",
  "gridcell",
  "caption",
  "legend",
  "term",
  "definition",
  "label",
]);

/**
 * Roles that are always worth emitting even if they have no children — they
 * carry intrinsic semantic value (the agent needs to know an `<input>` is
 * there even before it has a label).
 */
export const INTERACTIVE_ROLES = new Set<string>([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "treeitem",
]);

/**
 * Landmark + document-structure roles. Always kept even when they have no
 * accessible name, because their position is informative for the agent.
 */
export const STRUCTURAL_ROLES = new Set<string>([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "article",
  "form",
  "search",
  "dialog",
  "alertdialog",
  "list",
  "listitem",
  "table",
  "row",
  "rowgroup",
  "cell",
  "columnheader",
  "rowheader",
  "heading",
  "figure",
  "separator",
  "tablist",
  "tabpanel",
  "tab",
  "tree",
  "treeitem",
  "grid",
  "gridcell",
]);

/**
 * Tag names we never want to descend into.
 */
export const EXCLUDED_TAGS = new Set<string>([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
  "HEAD",
  "TITLE",
  "BASE",
]);

/**
 * Resolve the ARIA role for an element: explicit `role=` first (validated
 * loosely — we keep whatever string is there), then implicit mapping, then
 * `<input type=…>` lookup, then `null` (caller decides whether to skip or
 * treat as generic).
 */
export function resolveRole(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first;
  }
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type?.toLowerCase() || "text";
    return INPUT_TYPE_ROLE[type] ?? "textbox";
  }
  return IMPLICIT_ROLE[tag] ?? null;
}
