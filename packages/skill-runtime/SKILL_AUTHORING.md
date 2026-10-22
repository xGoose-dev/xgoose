# Skill authoring guide — single-file `.xgs.js` standard

Canonical reference for the xgoose skill format. One file = one skill: a Tampermonkey-style `// ==XGooseSkill== … // ==/XGooseSkill==` header at the top, ES-module body underneath, distributed as `<name>.xgs.js`. Drop the file into any host extension (`xgoose-extension-chrome`, `xgoose-extension-safari`, …); the runtime parses the header, gates on `@match` + `@detect`, bundles the body, and assigns the module's `default` export onto `window.xgoose.skills.<namespace>`.

The `.xgs.js` extension is what each host extension watches for in the address bar: navigating to a raw skill URL pops the extension's install page automatically (the older `.user.js` extension collided with Tampermonkey / Violentmonkey, which hijacks any `*.user.js` navigation regardless of the header body).

The format is intentionally shareable — any `.xgs.js` you can point a browser at can become an installable skill, and the agent itself can edit the file at runtime to add a new `@match` host.

This doc is the source of truth shipped with `@xgoose/skill-runtime`. Both host repos copy it into their `skills/` directory; the website mirrors it under `/docs/skills`. If you change one, sync the others.

---

## TL;DR

```javascript
// ==XGooseSkill==
// @name         discourse-forum
// @namespace    discourse
// @version      0.2.0
// @description  Helpers for Discourse-powered forums (search, read, post).
// @match        *://meta.discourse.org/*
// @match        *://*.discourse.org/*
// @match        *://www.uscardforum.com/*
// @match        *://linux.do/*
// @detect       !!document.querySelector('meta[name="generator"][content^="Discourse"]')
// @primary      searchTopics
// @keyword      discourse
// @keyword      forum
// @keyword      topic
// ==/XGooseSkill==

import { defineSkill, fn } from "@xgoose/skill";
import { z } from "zod";

export default defineSkill({
  searchTopics: fn({
    summary: "Full-text search across topics. ★ primary entry.",
    input: z.object({
      query: z.string().describe('Search query, e.g. "amex platinum 175k"'),
      page: z.number().int().min(0).optional(),
      order: z
        .enum(["relevance", "latest", "views", "likes", "activity", "posts"])
        .optional()
        .describe('Default "relevance". Use "latest" for time-ordered.'),
    }),
    examples: [
      { args: { query: "chase sapphire reserve" } },
      { args: { query: "IHG ghost reservation", order: "latest" } },
    ],
    handler: async ({ query, page, order }) => {
      const params = new URLSearchParams({ q: query });
      if (page !== undefined) params.set("page", String(page));
      if (order) params.set("order", order);
      const r = await fetch(`/search.json?${params}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`search → HTTP ${r.status}`);
      return await r.json();
    },
  }),
  // …other functions
});
```

The `// ==XGooseSkill== … // ==/XGooseSkill==` block is the only metadata; everything else is a normal ESM module. Each exported function in `defineSkill({ … })` becomes `window.xgoose.skills.<namespace>.<name>` and the agent invokes it via `js_exec` (`await xgoose.skills.discourse.searchTopics({ query: "…" })`). The Zod schema is documentation: it feeds the per-turn system reminder (every active skill's full input/output JSON Schema is inlined there, so the agent doesn't need a `help()` round trip) but is NOT enforced at runtime — bad args land in your handler and the destructure throws naturally.

Skills are **dynamically loaded**. `create_skill` and `edit_skill` mid-conversation produce a fresh IIFE in the service worker and hot-inject it into the current tab; the agent's very next `js_exec` runs the new code. No page reload required, no republish through xgoose-web required for local use — see § *Dynamic loading* below.

---

## File layout

Built-in skills live alongside the host source:

```
xgoose-extension-chrome/skills/
xgoose-extension-safari/skills/
├── discourse-forum.xgs.js
├── flyertalk.xgs.js
├── …
└── SKILL_AUTHORING.md   ← this doc
```

User-installed and agent-edited skills are persisted to `chrome.storage.local` under `xgoose.skills.user`. They have the same on-disk shape; the host extension's options page is the human-facing editor.

The build pipeline (`scripts/build-skills.mjs`):

1. Walks `skills/*.xgs.js`.
2. Parses the `==XGooseSkill==` header via `@xgoose/skill-runtime`'s `parseSkillFile` → validated against `SkillHeaderSchema`.
3. esbuild-bundles the JS body as an IIFE that:
   - evaluates `@detect` in the page MAIN world
   - if truthy, instantiates the module, and assigns its `default` onto `window.xgoose.skills[<namespace>]`
4. Calls `__describe__()` on the bundled output to extract per-function summaries (used by `list_skills` and the system reminder).
5. Emits `Resources/skills/<name>.xgs.js` (header preserved + bundled body) and a slim `registry.json` for the host to load on install.

---

## Header directives

All directives are `// @key value` lines between the two markers. Repeatable keys collect into arrays; everything else is a scalar. Unknown directives are preserved on `extra` and round-trip through publish without being interpreted.

| Directive      | Repeatable | Required | Notes                                                                                                                                       |
| -------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@name`        | –          | yes      | Globally unique, kebab-case (`a-z0-9-`). Identity for storage & registry.                                                                   |
| `@namespace`   | –          | yes      | JS identifier (`[A-Za-z_$][\w$]*`). Becomes `xgoose.skills.<namespace>`. Pick a short, unique one.                                          |
| `@version`     | –          | –        | Semver. xgoose-web auto-bumps the patch on republish. Defaults to `0.0.0`.                                                                  |
| `@description` | –          | –        | One-line summary, shown verbatim to the agent in `list_skills`.                                                                             |
| `@match`       | yes        | –        | [Chrome match pattern](https://developer.chrome.com/docs/extensions/mv3/match_patterns/). Skill activates when `location.href` matches any. |
| `@include`     | yes        | –        | Simple glob (`*` / `?`). Looser syntax than `@match`.                                                                                       |
| `@exclude`     | yes        | –        | Subtracts from the match set.                                                                                                               |
| `@detect`      | –          | –        | Single-line JS expression evaluated in MAIN world. Must be truthy for the skill to mount. Falsy / thrown = skip.                            |
| `@run-at`      | –          | –        | `document_start` / `document_end` / `document_idle` (default).                                                                              |
| `@all-frames`  | –          | –        | `true` to also inject into iframes. Default `false`.                                                                                        |
| `@require`     | yes        | –        | Other skill names this depends on. Loaded first (topological sort).                                                                         |
| `@connect`     | yes        | –        | Declared cross-origin hosts. `"<self>"` = same-origin only. Currently informational.                                                        |
| `@primary`     | –          | –        | Name of the ★ primary exported function. List_skills surfaces its signature; other functions are name-only until the agent calls `help`.    |
| `@keyword`     | yes        | –        | Surfaced by `search_skills({ query })` even when the skill isn't active on the current page. Include site nicknames + slang.                |
| `@homepage`    | –          | –        | Author docs URL.                                                                                                                            |
| `@author`      | –          | –        | Author display name.                                                                                                                        |

### Things that will silently waste your day

- `@match` doesn't match the URL → skill never activates. Verify in `list_skills` with `scope: 'page'`.
- `@detect` throws → treated as falsy → skill never activates. Wrap risky property reads (`?.` everywhere; `try { … } catch { return false }` if you must).
- `@namespace` collides with another skill → the second install wins. Choose a unique short namespace.
- Forgetting `@primary` → agents only see name + summaries; they always pay a `help` round-trip before their first call.
- `@detect` referencing DOM that isn't ready → set `@run-at document_idle` (the default) or have the detect check `document.readyState`.

---

## `defineSkill` and `fn`

```typescript
import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

export default defineSkill({
  fnName: fn({
    summary: string;             // shown to the agent in list_skills + help + the per-turn system reminder
    input: ZodSchema;            // documentation-only: rendered as JSON Schema inline in the system reminder. NOT validated at runtime.
    output?: ZodSchema;          // documentation-only: rendered as JSON Schema inline in the system reminder.
    examples?: Array<{ args; note?; returns? }>; // inlined verbatim into the system reminder for every active skill
    handler: async (args) => { … };  // receives the raw args object the caller passed
  }),
  // …
});
```

What `defineSkill` returns:

- **Each function name on the result is the handler.** Args are passed through as-is — the runtime does NOT validate. If the agent hands you a bad shape, your destructure throws and the error reaches the agent's `js_exec` result, which it interprets and self-corrects (usually after one `help` round-trip).
- **`__describe__(fnName?)`** is the CLI-style help payload. With no argument: a `{ [fnName]: { summary, signature, invocation, primary? } }` map. With a name: the full `{ name, summary, invocation, input (JSON Schema), output? (JSON Schema), examples }` envelope.
- **`__meta__`** carries `{ name, namespace, primary, functions[] }` for callers that need to introspect without re-parsing the header.

The `__isXgooseSkill__: true` marker lets the runtime distinguish a real skill bundle from a hand-rolled object.

The `invocation` field in `__describe__` is a copy-pasteable `js_exec` snippet (e.g. `await xgoose.skills.discourse.searchTopics({...})`); the per-turn system reminder surfaces it next to each function's signature so the agent doesn't have to re-derive `xgoose.skills.<ns>.<fn>` from the namespace + name on every call.

As of the **schemas-in-context** change, `__describe__()` (the no-arg form) now also returns each function's full input/output JSON Schema and authored examples. `build-skills.mjs` ships all of that into `registry.json`, and the extension's per-turn system reminder inlines the schema for every active skill — so for any skill that's loaded on the current page, the agent has the entire call shape (no `help()` call needed). `help()` remains useful only for skills that are installed but **not** active on the current page (those don't appear in the reminder).

---

## How the agent invokes your skill

Skills are exposed as plain in-page helpers on `window.xgoose.skills.<namespace>.<fnName>`. The agent invokes them by writing a `js_exec` snippet — there is **no dedicated `skill_call` tool**. A typical call looks like:

```js
return await xgoose.skills.discourse.searchTopics({ query: "amex platinum 175k", order: "latest" });
```

Two consequences fall out of this design:

1. **The runtime does not validate args.** The `input`/`output` Zod schemas you pass to `fn(...)` exist only as documentation — they become JSON Schema that the per-turn system reminder inlines next to each function for every active skill. If the agent passes a bad shape, the handler's destructure (or first property access) throws naturally; that error bubbles back to `js_exec` and the agent self-corrects after re-reading the reminder's schema. This matches xgoose's fail-fast philosophy.
2. **The agent can compose freely.** Because every call is just JS, the agent can chain three skill calls in one `Promise.all`, splice in a raw `fetch` for something the skill doesn't cover, or transform args/results inline — all in one tool call. Quick-recipe blocks in your handler JSDoc / file-top comments are valuable because the agent often copies them verbatim.

## The agent-facing CLI surface

The host extension exposes seven registry tools on top of the skill set. **Optimize your skill for these tools, not for free-text docs** — that's how agents pay attention. Invocation is `js_exec`, not a tool.

| Tool                                       | What it returns                                                                                                                                                                                                              | When the agent reaches for it                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `list_skills({ scope?: 'all' \| 'page' })` | Compact rows: name, namespace, description, matches, keywords, enabled, activeOnThisPage, primary function (signature + `invocation` snippet + summary), names of other functions.                                            | When the agent wants to discover what's installed but not active. (Active skills are already inlined in the per-turn system reminder with full schemas — no `list_skills` call needed for those.) |
| `search_skills({ query, limit? })`         | Same compact rows, scored, ranked by relevance.                                                                                                                                                                              | When the user asks for something the active skills don't cover ("any forum skill?", "anything for hotels?").                     |
| `help({ skill, function? })`               | Full input/output JSON Schema, ready-to-paste `invocation` snippet, and verbatim `examples`. Falls back to compact static summaries when the skill isn't loaded on the current page.                                          | Only needed for skills **not** active on the current page (active ones are inlined in the reminder). Also useful when an active user-skill couldn't be statically introspected and the reminder marks its schema as "unavailable inline". |
| `read_skill({ name })`                     | Raw `.xgs.js` source.                                                                                                                                                                                                        | When the agent intends to `edit_skill` (needs the full text to modify it).                                                       |
| `edit_skill({ name, source })`             | `{ name, namespace, version, bodyChanged, activeOnThisPage, hint }`. **Hot-reloads the new IIFE into the current tab immediately** if the skill matches this URL — the agent's next `js_exec` runs the new code. Other open matching tabs hot-reload async via the storage watcher. | When the agent wants to add a `@match` for a new host, bump a version, or rewrite a handler. Built-in skills clone to a user override on first edit. |
| `create_skill({ source })`                 | `{ name, namespace, version, activeOnThisPage, hint }`. Header is parsed client-side; fails if the name already exists (use `edit_skill` for that). **Hot-loaded into the current tab** if `@match` covers it.                                                                                  | When the agent has a brand-new `.xgs.js` it wants to register. Pair with `skill_help()` first.                                   |
| `skill_help()`                             | This document, returned verbatim as a string.                                                                                                                                                                                | Before writing a new skill or substantially editing one.                                                                         |

The single biggest mental shift from old-style skills is that **per-turn context carries the full input/output JSON Schema and examples for every function of every active skill** — no `help()` round trip needed. The trade-off: every byte you spend on `.describe()`, schema refinement, and `examples` ends up in the system reminder. For a typical 5–10-function active skill that's ~3–8 KB per turn (≈ 0.7–2 K tokens), and the reminder is in the prompt cache so the steady-state cost is near-zero. Be deliberate but not stingy — the schema is what lets the agent get the call right on the first try.

So the highest-ROI parts of your skill file are:

1. A short `@description` (one sentence).
2. An obvious `@primary` (the ★ entry) — the system reminder lists it first for each skill.
3. Each `fn`'s `summary` (one line) + tight Zod schema with `.describe()` on non-obvious fields — these go inline into the system reminder for every active skill.
4. One or two `examples` per function — also inlined into the reminder verbatim. The agent usually copies these as the args object inside its `js_exec` snippet.

Long-form caveats, failure-mode notes, and quick-recipe `js_exec` bodies live in JS code comments at the top of the file. The agent reads them via `read_skill` when it wants to edit. They do **not** end up in the per-turn reminder.

---

## The eight rules that decide whether the agent succeeds first try

Distilled from the bake-off across the built-in skills (`alaska-awards`, `aa-awards`, `hyatt-awards`, `discourse-forum`, `vbulletin-forum`, `flyertalk`, `uscardforum`, `uscreditcardguide`):

1. **Declare a single ★ `@primary`.** One clear entrypoint the agent reaches for first. Mark it in the header. Use other entrypoints for lower-level access. The system reminder lists this function first for the skill, marked with ★.
2. **Every function takes one options object.** No positional args, no overloads. The agent will copy your shape exactly. `z.object({…})` always; never `z.tuple([…])` at the top level. (The schemas are pure documentation — the runtime doesn't enforce them — but the agent reads them as the source of truth.)
3. **No `z.any()` in inputs unless you mean it.** If a field is a URL, use `z.string().url()`. If it's a date, `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. Every loose schema is a guess the agent has to make.
4. **Declare concrete return shapes via `output` (or in the function `summary` if you can't).** "Returns a list of search results" is useless; "Returns `{ topic_list: { topics: TopicListItem[] } }` where `TopicListItem.id` is the topic id passed to `getTopic`" is gold.
5. **Use `.describe()` on tricky inputs.** The system reminder surfaces this verbatim inline for every active skill. The agent reads it like CLI flag help — it's the only signal there is, since args aren't validated at runtime.
6. **Provide ≥ 1 example per function.** Real, copy-pasteable args (and a `returns` hint if it's surprising). The agent literally copies these inside its `js_exec` snippet.
7. **Throw on real errors; return shaped status on expected ones.** "Akamai blocked", "sold_out", "no results" are values the caller will branch on. "Property code is empty" is an exception. Don't swallow errors with bare `try {…} catch {}` — let real errors bubble all the way back through `js_exec`.
8. **Date format is `YYYY-MM-DD`. Currency is the property's local currency unless you explicitly normalize.** Stick to ISO; document the currency field; never silently mix units.

---

## Runtime conventions

- **Same-origin first.** The skill runs in the page MAIN world. `fetch(url, { credentials: 'include' })` carries the user's cookies and CSRF tokens. Prefer that over CORS dances.
- **Use `URLSearchParams` for query strings.** Saves encoding bugs.
- **Concurrency control belongs in the skill.** If you fan out per-night fetches, throttle with a small in-skill semaphore. The hotel skills default to 4–6 in flight.
- **No `chrome.*` from `skill.ts`.** It runs in MAIN world; `chrome` isn't defined. If you need extension APIs, that's a host tool, not a skill.
- **No `eval` / `new Function` / string `setTimeout`.** Most modern sites disallow `unsafe-eval` and there's no legitimate reason a skill needs runtime code generation.
- **No secrets in source.** The bundled JS ships to every user's machine and is visible in DevTools.
- **Don't patch globals** (`fetch`, `console`, `window`). The page bridge already patches them; double-patching collides.
- **Zod is documentation, not validation.** The runtime hands your handler the raw args object the agent passed via `js_exec`. If you need to coerce or default a value, do it inside the handler. If the shape is wrong, let your destructure or property access throw — the error reaches the agent, which re-reads `help` and self-corrects. Do not write defensive `if (!args.foo) return …` paths; do throw clear errors.

Skill _injection_ (loading your code into MAIN world while satisfying page CSP) is a runtime concern, not a skill concern. The host extension picks the right injection strategy for the browser. Write your skill as if every host had a friendly CSP; the runtime deals with the hostile ones.

---

## Cross-skill dependencies

Declare in the header:

```
// @require   vbulletin-forum
```

The injector topologically sorts requires, so by the time your skill mounts, `window.xgoose.skills.vbulletin.*` is populated. Don't `import` other skills — they live in separate ESM realms; reference them through the page global:

```js
const v = window.xgoose?.skills?.vbulletin;
if (!v)
  throw new Error("flyertalk.searchAll: vbulletin-forum skill not loaded");
```

---

## Cross-origin and `@connect`

If your skill fetches a host that isn't the page's origin, declare it:

```
// @connect   <self>
// @connect   apis.ihg.com
```

CORS handles the actual permission today; `@connect` is currently informational. The injector may start enforcing an allowlist later, so declare honestly.

---

## Reverse-engineering checklist (new vendor skill)

The playbook that produced the hotel + airline pilots:

1. **Use the site UI as your spec.** Open the property/topic/award calendar page in a logged-in session, do the action, record DevTools Network.
2. **Identify the smallest URL + body that reproduces the data.** Strip query params and headers one at a time until you have the minimum that still 200s.
3. **Note the auth model.** Anonymous? Cookie-based? CSRF token from a meta tag? Header-based bearer? Are some fields gated behind login?
4. **Document the captured shape inline.** Put the request body + observed response keys in code comments near the function that uses them so the next maintainer (or the agent doing `edit_skill`) doesn't have to re-capture from scratch.
5. **Document failure modes you observed.** 403 patterns, rate limits, sensor cookies, persisted-query signatures. The agent's user benefits more from "the tab needs a refresh" than from a generic error.
6. **Write the skill with one ★ `@primary`** that takes a date range / query, fans out internally, and returns the flattened summary the user wants. Raw entrypoints are fine but secondary.

---

## Publishing

Once installed, click **Publish to xgoose-web** on the skill chip in the panel (or use the upload form at [xgoose.org/publish/](https://xgoose.org/publish/)). The host POSTs the canonical `.xgs.js` source to `POST /skills` with your bearer token. If you republish the same name with a non-greater `@version`, the registry auto-bumps the patch (e.g. `0.2.0` → `0.2.1`) and the response tells you the assigned version. Subsequent installs always pull a `.xgs.js` whose `@version` line matches the registry.

The publisher (UI under `xgoose-web/web/components/SkillUploader.tsx`) parses the same header schema this doc describes, bundles your body via esbuild-wasm right in the browser, runs `__describe__()` on the bundle to extract per-function summaries, and ships those alongside the raw source. The marketplace card on `xgoose.org/skill?slug=…` shows the resulting function list with ★ markers.

---

## Dynamic loading — `create_skill` and `edit_skill` are hot

The host extension's skill registry is **fully dynamic**. The agent's `create_skill` / `edit_skill` tools don't require a page reload or a republish through xgoose-web for the new bundle to become invocable on the current page. The flow:

1. Agent calls `create_skill({ source })` (or `read_skill` → modify → `edit_skill`).
2. Service worker parses the header, calls `bundleUserSkill(body, header)` to produce the install-ready IIFE, and writes it to `chrome.storage.local` (`xgoose.skills.user`). `UserSkill.updatedAt` is stamped to `Date.now()`.
3. The tool, before returning to the agent, calls `sw:active_skills_for_url` for the current tab's URL, invalidates the skill's entry in the content-script-side injection cache, and re-runs `injectSkills([thatSkill])`. The bundle's IIFE re-executes; its tail does `Object.assign(window.xgoose.skills[ns], __skill__)`, so the callable functions replace cleanly without a page reload.
4. The agent's very next `js_exec` snippet can invoke `await xgoose.skills.<ns>.<fn>(args)` against the new code.
5. Asynchronously, the SW's storage watcher fires and pushes `cs:set_active_skills` to every other open tab. Tabs whose URLs match see a fingerprint change (`u:<updatedAt>`) and re-inject too; tabs that already saw the proactive injection no-op because the fingerprint already matches.

If the new skill's `@match` patterns don't cover the current URL, the response carries `activeOnThisPage: false` and a hint to navigate. The skill is still installed and will hot-load the moment the user lands on a matching page.

Built-in skills get cloned to a user-skill copy on first edit, so the original ships value is preserved. Subsequent edits update the override in place. This is the canonical way to make the discourse / vBulletin / iCloud-style "one skill, many sites" pattern actually scale — rather than hard-coding N hosts, the skill grows when the user (or the agent) lands on a new site, and the new `@match` host takes effect immediately.

**Publishing via xgoose-web is independent of local use.** Republishing is only required when you want to share the skill with other users (the marketplace pulls the canonical source). For your own session, `create_skill` / `edit_skill` are enough.

---

## Quick checklist before committing a skill

- [ ] `// ==XGooseSkill== / ==/XGooseSkill==` block present with valid `@name`, `@namespace`, at least one `@match`.
- [ ] `@primary` points at the ★ entry function.
- [ ] Every `fn(...)` has a Zod input schema (not `z.any()`), a one-line `summary`, and ≥ 1 example.
- [ ] Tricky inputs use `.describe(...)` so the inline reminder schema isn't just `{ type: "string" }`.
- [ ] Return shape is documented in `summary` or via an `output` schema (the eight rules, #4).
- [ ] Failure modes (rate-limits, Akamai, login-gated fields) are noted in `// comments at the top of the body` for the agent to read via `read_skill`.
- [ ] No `chrome.*`, no `eval`, no `new Function`, no string `setTimeout`.
- [ ] No secrets in source.
- [ ] `npm run build:skills` succeeds and the skill appears in `Resources/skills/registry.json`.
- [ ] Manual smoke: open a matching URL, open the panel, see the chip, run the primary fn via `js_exec` (`return await xgoose.skills.<ns>.<fn>({…});`) and confirm it returns the documented shape.

If the agent succeeds first try (one `js_exec`, no `help` round-trip, no flailing), you wrote a good skill.
