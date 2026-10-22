/**
 * Shared types for the Tampermonkey-style single-file skill format.
 *
 * Skills are authored as a single `.xgs.js` file with:
 *
 *   1. A Tampermonkey-style header block:
 *
 *        // ==XGooseSkill==
 *        // @name         …
 *        // @namespace    …
 *        // @match        …
 *        // ==/XGooseSkill==
 *
 *   2. A JS body that ends with `export default defineSkill({ … })`.
 *
 * The build pipeline parses the header (validated against `SkillHeaderSchema`)
 * and bundles the body. At runtime the IIFE assigns its `.default` (a
 * `SkillBundle`) onto `window.xgoose.skills[<namespace>]`.
 */

import { z } from "zod";
import type { ZodTypeAny } from "zod";

/** A single Tampermonkey-style `@directive` value (or repeated array). */
export const RunAtSchema = z.enum([
  "document_start",
  "document_end",
  "document_idle",
]);
export type RunAt = z.infer<typeof RunAtSchema>;

/**
 * An author-declared clickable action surfaced in the chat panel.
 *
 *   - `label`  — button text.
 *   - `prompt` — the message sent to the agent when clicked.
 *   - `js`     — optional code run in the page MAIN world first; its JSON
 *                result is embedded into the message before `prompt` is sent.
 *
 * Header `@action Label | prompt` declares prompt-only actions (no `js`);
 * the `defineSkill(spec, { actions })` body array can add `js`.
 */
export const SkillActionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  prompt: z.string().min(1),
  js: z.string().optional(),
});
export type SkillAction = z.infer<typeof SkillActionSchema>;

/**
 * Parsed Tampermonkey-style header. Mirrors the canonical Tampermonkey
 * directives but uses our own marker (`// ==XGooseSkill==`) so userscript
 * managers don't try to install our files.
 *
 *   @name         — display name; uniqueness scoped per owner on the registry
 *   @namespace    — JS namespace under `window.xgoose.skills.<namespace>`
 *   @version      — semver; auto-bumped on republish by the registry
 *   @description  — one-line summary; shown verbatim to the agent
 *   @match        — Chrome match pattern, repeatable
 *   @include      — simple glob, repeatable
 *   @exclude      — Chrome match pattern OR glob, repeatable; subtracts from
 *                   matches + include
 *   @detect       — JS expression eval'd in the page MAIN world before mount;
 *                   if falsy or throws, the skill skips this page
 *   @run-at       — document_start | document_end | document_idle (default)
 *   @all-frames   — true to also inject into iframes (default false)
 *   @require      — name of another skill this depends on, repeatable
 *   @connect      — declared host the skill fetches from (informational),
 *                   repeatable; "<self>" = same-origin only
 *   @primary      — name of the ★ primary exported function. The system
 *                   reminder shows its full schema; other functions are
 *                   name-only until the agent calls `help()`.
 *   @keyword      — keyword for `search_skills`, repeatable
 *   @homepage     — author docs URL (optional)
 *   @author       — display name (optional)
 *
 * Unknown directives are preserved on `extra` so registries can extend
 * without code changes.
 */
export const SkillHeaderSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  version: z.string().default("0.0.0"),
  description: z.string().default(""),
  matches: z.array(z.string()).default([]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  detect: z.string().optional(),
  runAt: RunAtSchema.default("document_idle"),
  allFrames: z.boolean().default(false),
  requires: z.array(z.string()).default([]),
  connect: z.array(z.string()).default([]),
  primary: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  author: z.string().optional(),
  /** Author-declared clickable actions (header `@action Label | prompt`). */
  actions: z.array(SkillActionSchema).default([]),
  /** Unknown / vendor `@xxx` directives, preserved verbatim. */
  extra: z.record(z.array(z.string())).default({}),
});
export type SkillHeader = z.infer<typeof SkillHeaderSchema>;

/**
 * What `defineSkill` produces on the page: callable functions plus a
 * `__describe__` introspector and a `__meta__` block with the header info
 * that was passed in at build time. The build pipeline can also stash a
 * `__primary` name here if the header set one.
 */
export interface SkillBundle {
  /** Internal marker so we can distinguish a properly-built skill from
   *  a hand-written object that the user accidentally exposed. */
  readonly __isXgooseSkill__: true;
  /**
   * CLI-style help. Pass no args for a summary of every function (name +
   * one-line summary + signature) or a name for the full schema + examples.
   * Both shapes are JSON-serialisable and safe to ship straight back to
   * the agent without further marshalling.
   */
  __describe__: (fn?: string) => FnHelp | FnSummaryMap | { error: string };
  __meta__: {
    name?: string;
    namespace?: string;
    primary?: string;
    functions: string[];
    /** Body-declared actions (`defineSkill(spec, { actions })`). Merged with
     *  header `@action`s at build time onto the registry entry. */
    actions?: SkillAction[];
    /** Optional multi-line, agent-facing usage guidance for this skill
     *  (`defineSkill(spec, { instructions })`). Surfaced verbatim in the
     *  per-turn system reminder under the skill's heading. Use it for
     *  site-specific research/workflow discipline that doesn't belong in the
     *  generic system prompt. */
    instructions?: string;
  };
  [name: string]: unknown;
}

/**
 * A single function's `help()` payload — what `help({ skill, function })`
 * returns to the agent. Everything here is JSON-Schema-friendly so the
 * agent can pattern-match types without parsing prose.
 */
export interface FnHelp {
  name: string;
  summary: string;
  /** Copy-pasteable `js_exec` snippet — e.g. `await xgoose.skills.discourse.searchTopics({...})`. */
  invocation: string;
  input: unknown; // JSON Schema (from `zod-to-json-schema`)
  output?: unknown; // JSON Schema, if author declared an output schema
  examples: Array<{ args: unknown; note?: string; returns?: unknown }>;
}

/** Compact map returned by `__describe__()` with no fn name.
 *
 *  As of the "schemas in context" change, every entry includes the full
 *  input / output JSON Schemas and authored examples. The per-turn system
 *  reminder ships these inline for every active skill, so the agent
 *  doesn't need a `help()` round trip to know the call shape. `help()`
 *  remains useful only for installed-but-not-active skills (which the
 *  reminder doesn't enumerate). */
export type FnSummaryMap = Record<
  string,
  {
    summary: string;
    signature: string;
    /** Copy-pasteable `js_exec` snippet for this function. */
    invocation: string;
    /** Input JSON Schema (from `zod-to-json-schema`). */
    input: unknown;
    /** Output JSON Schema, present only when the author declared one. */
    output?: unknown;
    /** Worked examples; present only when the author declared them.
     *  (`args?` rather than `args` to align with the inferred type of the
     *  per-host SkillFnSummarySchema, where Zod treats `z.unknown()` as
     *  implicitly optional.) */
    examples?: Array<{ args?: unknown; note?: string; returns?: unknown }>;
    primary?: boolean;
  }
>;

/**
 * What a skill author passes to `fn(...)`. Generic so authors can keep
 * their TypeScript types end-to-end. The `input` / `output` Zod schemas
 * are documentation-only: they feed `help` and let the agent see a JSON
 * Schema before writing its `js_exec` call. The runtime does NOT
 * validate against them — the `handler` receives the raw args object the
 * caller passed.
 */
export interface FnSpec<I = unknown, O = unknown> {
  /** One-line agent-facing description. */
  summary: string;
  /** Zod schema for the input object. Surfaced via `help` as JSON Schema. Not enforced at runtime. */
  input: ZodTypeAny;
  /** Optional Zod schema for the return shape. Surfaced via `help`. Not enforced at runtime. */
  output?: ZodTypeAny;
  /** Worked examples — verbatim into the `help()` response. */
  examples?: Array<{ args: I; note?: string; returns?: O }>;
  /** Actual implementation. Called with the raw args object (no Zod parsing). */
  handler: (input: I) => O | Promise<O>;
}
