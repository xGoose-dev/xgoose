# @xgoose/dom-snapshot

Compact DOM dehydration for the xgoose agent.

Walks the live DOM and produces a flat, LLM-friendly semantic snapshot:

- One integer ID per kept node (used both as a tree key and as the value of
  the `data-xgoose-id="N"` attribute written on the live element).
- W3C-aligned **ARIA role** for every node (explicit `role=`, implicit HTML
  mapping, or `<input type=…>` lookup).
- W3C AccName 1.2-style **accessible name** (`aria-labelledby` ▸ `aria-label`
  ▸ associated `<label>` ▸ alt/value ▸ text content ▸ placeholder ▸ title).
- ARIA **states** (`disabled`, `checked`, `expanded`, `pressed`,
  `selected`, …) — only the ones that differ from defaults.
- A choice of two **renderers**: indented YAML-ish text (token-efficient,
  Playwright-aria-snapshot style) or structured JSON.
- An optional MutationObserver-based **stabilisation** helper that waits for
  the DOM to be quiet before snapshotting.

Pure DOM. No deps.

Scoped to the ideas that matter for a Safari content script: no event
listener instrumentation, no framework metadata, no computed-style
preservation, no cross-origin frame realms.

## Usage

```ts
import {
  buildDomSnapshot,
  renderText,
  awaitDomQuiet,
  resolveId,
} from "@xgoose/dom-snapshot";

await awaitDomQuiet({ debounceMs: 250 });
const snap = buildDomSnapshot(document.body);
const text = renderText(snap);

// Later turn: resolve [id=42] from the snapshot back to a live element
const button = resolveId(42);
button?.click();
```

## Text format

```
# url: https://example.com/products
# title: Pricing
landmark "Site nav" [navigation]
  link "Home" https://example.com/ [id=1]
  link "Pricing" https://example.com/pricing [id=2]
main
  heading h1 "Pricing plans"
  list
    listitem
      heading h3 "Pro"
      text "$10/mo"
      button "Subscribe" [id=7]
    listitem
      heading h3 "Team"
      button "Subscribe" [id=8] {disabled}
```

Roles, `"accessible name"`, the link href / heading level / input value,
ARIA state tags in `{…}`, and a `[id=N]` marker on every interactive
element are all the agent needs to plan its next action.

## Three-tier element filter

The walker keeps:

1. **Always**: interactive elements — `<button>`, `<a href>`, `<input>`,
   `<select>`, `<textarea>`, anything with an interactive `role=`,
   contenteditable, or focusable `tabindex`. These are annotated with a
   stable `data-xgoose-id`.
2. **If structural**: landmarks (`main`, `navigation`, `banner`, …),
   `dialog`, `list`, `listitem`, `table`, `row`, `heading`, `figure`.
3. **Otherwise**: transparent. Generic `<div>` / `<span>` soup is collapsed;
   the walker recurses into them but does not emit a node. Free-floating
   text becomes a `role: 'text'` child of the nearest kept ancestor.

Hidden elements (`display:none`, `aria-hidden`, off-screen) are pruned by
default. Text already absorbed into an ancestor's accessible name (button
labels, link text, headings) is dropped to avoid duplication.

## Modal scoping

When exactly one visible `<dialog open>` or `[role=dialog][aria-modal=true]`
is present and lives inside the snapshot root, the walk is automatically
scoped to it and the rest of the page is elided. The snapshot's
`modalScoped: true` flag tells the agent why the background went missing.

## Stable IDs (single-snapshot)

IDs are stable **only within the snapshot they were generated for**. Each
call to `buildDomSnapshot` clears the registry and starts at 1. Action
tools (e.g. a future `click_by_id`) call `resolveId(N)` to recover the
original `Element` via a WeakRef + `data-xgoose-id` fallback query.

## Public API

```ts
buildDomSnapshot(root: Element, opts?: SnapshotOptions): DomSnapshot
renderText(snap: DomSnapshot): string
renderJson(snap: DomSnapshot): DomSnapshot
awaitDomQuiet({ debounceMs, maxWaitMs, doc }): Promise<boolean>
resolveId(id: number, doc?: Document): Element | null
ID_ATTR: 'data-xgoose-id'
```

See [`src/types.ts`](src/types.ts) for the full `DomNode` /
`DomSnapshot` / `SnapshotOptions` shapes.
