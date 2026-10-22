/**
 * W3C AccName 1.2 subset — enough to give the LLM the right "what would a
 * screen reader say" string without dragging in the full 1000+ line spec
 * implementation.
 *
 * Priority (highest wins):
 *   1. aria-labelledby — concatenated text of referenced elements
 *   2. aria-label
 *   3. <label for=...> / wrapping <label>            (form controls only)
 *   4. Element-specific name source (alt for <img>, value for buttons, …)
 *   5. visible text content (for name-from-content roles)
 *   6. placeholder
 *   7. title
 *
 * @see https://www.w3.org/TR/accname-1.2/#mapping_additional_nd_name
 */
import { NAME_FROM_CONTENT_ROLES } from "./roles";

const NAME_MAX_LEN = 200;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clamp(s: string): string {
  if (s.length <= NAME_MAX_LEN) return s;
  return s.slice(0, NAME_MAX_LEN - 1) + "…";
}

function textOf(el: Element | null): string {
  if (!el) return "";
  // Prefer innerText (respects display:none); fall back to textContent for
  // SVG / detached nodes where innerText is undefined.
  const txt = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return collapse(txt);
}

function resolveLabelledBy(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  const doc = el.ownerDocument || document;
  const parts: string[] = [];
  for (const id of ids.trim().split(/\s+/)) {
    const ref = doc.getElementById(id);
    const t = textOf(ref);
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function resolveAssociatedLabel(el: Element): string {
  if (!(el instanceof HTMLElement)) return "";
  const id = el.id;
  if (id) {
    const doc = el.ownerDocument || document;
    // Querying every <label for=…> in the document is fine: there are rarely
    // more than a few dozen on a real page.
    const lbl = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl) {
      const t = textOf(lbl);
      if (t) return t;
    }
  }
  // <input> inside <label>...</label>
  const parentLabel = el.closest("label");
  if (parentLabel) {
    // Exclude the input's own value from the label text so we don't
    // accidentally echo "Username johndoe" as the name.
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input,textarea,select").forEach((n) => n.remove());
    const t = collapse(clone.textContent ?? "");
    if (t) return t;
  }
  return "";
}

function elementSpecificName(el: Element): string {
  const tag = el.tagName;
  if (tag === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt) return alt;
  }
  if (tag === "INPUT") {
    const inp = el as HTMLInputElement;
    const t = inp.type?.toLowerCase();
    if (t === "button" || t === "submit" || t === "reset") {
      if (inp.value) return inp.value;
      // Default labels per HTML spec
      if (t === "submit") return "Submit";
      if (t === "reset") return "Reset";
    }
    if (t === "image" && inp.alt) return inp.alt;
  }
  if (tag === "FIGURE") {
    const cap = el.querySelector(":scope > figcaption");
    if (cap) return textOf(cap);
  }
  if (tag === "FIELDSET") {
    const legend = el.querySelector(":scope > legend");
    if (legend) return textOf(legend);
  }
  if (tag === "TABLE") {
    const cap = el.querySelector(":scope > caption");
    if (cap) return textOf(cap);
  }
  return "";
}

/**
 * Compute the accessible name for `el`, given its resolved `role`. Returns
 * an empty string when nothing meaningful is available.
 */
export function computeAccessibleName(
  el: Element,
  role: string | null,
): string {
  // 1. aria-labelledby
  const byRef = resolveLabelledBy(el);
  if (byRef) return clamp(byRef);

  // 2. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return clamp(collapse(ariaLabel));

  // 3. <label for=...>  (only for form controls)
  const tag = el.tagName;
  const isFormControl =
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (isFormControl) {
    const lbl = resolveAssociatedLabel(el);
    if (lbl) return clamp(lbl);
  }

  // 4. element-specific
  const elemSpecific = elementSpecificName(el);
  if (elemSpecific) return clamp(collapse(elemSpecific));

  // 5. text content (for name-from-content roles)
  if (role && NAME_FROM_CONTENT_ROLES.has(role)) {
    // Build the name from child text — but exclude descendant form-control
    // values so a button containing an <input> doesn't pick up the input's
    // current value.
    const clone = el.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("input,textarea,select,style,script")
      .forEach((n) => n.remove());
    const t = collapse(clone.textContent ?? "");
    if (t) return clamp(t);
  }

  // 6. placeholder
  if (isFormControl) {
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return clamp(collapse(ph));
  }

  // 7. title (tooltip fallback)
  const title = el.getAttribute("title");
  if (title?.trim()) return clamp(collapse(title));

  return "";
}
