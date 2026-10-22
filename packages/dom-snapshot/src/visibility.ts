/**
 * Cheap visibility checks.
 *
 * `getComputedStyle` is expensive on hot paths, so we short-circuit on the
 * cheap signals (`hidden` attr, `aria-hidden`, zero rect) first.
 */

export function isInvisible(el: Element): boolean {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;

  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;

  // `<input type="hidden">` is invisible by spec
  if (
    el.tagName === "INPUT" &&
    (el as HTMLInputElement).type?.toLowerCase() === "hidden"
  ) {
    return true;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // <pre> / <code> can have zero rect while still being meaningful, so
    // we let code blocks inside collapsed sections survive the check.
    if (!el.closest("pre, code")) {
      // Cheaper bail-out: only call getComputedStyle if the rect is zero,
      // since that's the only case where we need to distinguish
      // `display:none` from `width:0; height:0`.
      const win = el.ownerDocument?.defaultView ?? window;
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      // If width+height are 0 and it's not a code container, treat as hidden.
      return true;
    }
  }

  const win = el.ownerDocument?.defaultView ?? window;
  // Far off-screen → treat as hidden (carousels, drawer content, etc).
  if (rect.right < -1000 || rect.left > win.innerWidth + 1000) return true;
  if (rect.bottom < -1000 || rect.top > win.innerHeight + 5000) return true;

  return false;
}

/**
 * Whether an element is interactive enough that the agent should be able to
 * address it by ID. Anything in this set gets a `data-xgoose-id` annotation
 * during the walk.
 *
 * Note: this is a *tag* check; the dehydrator additionally requires the
 * element to be visible (`!isInvisible`) before annotating.
 */
export function isInteractiveTag(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A") {
    // Anchor without href is not actually interactive
    return el.hasAttribute("href");
  }
  if (
    tag === "BUTTON" ||
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    tag === "SUMMARY"
  ) {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) return true;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && tabindex !== "-1") return true;
  // Elements with explicit interactive role
  const role = el.getAttribute("role");
  if (role) {
    const first = role.trim().split(/\s+/)[0];
    if (
      first === "button" ||
      first === "link" ||
      first === "checkbox" ||
      first === "radio" ||
      first === "switch" ||
      first === "tab" ||
      first === "menuitem" ||
      first === "option" ||
      first === "textbox" ||
      first === "combobox" ||
      first === "searchbox"
    ) {
      return true;
    }
  }
  return false;
}
