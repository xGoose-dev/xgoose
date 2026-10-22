/**
 * `defineSkill` and `fn` — the helpers a skill author imports from
 * `@xgoose/skill` (resolved by the build to this module).
 *
 *   import { defineSkill, fn } from '@xgoose/skill';
 *   import { z } from 'zod';
 *
 *   export default defineSkill({
 *     searchTopics: fn({
 *       summary: 'Search topics on a Discourse forum',
 *       input: z.object({ query: z.string() }),
 *       examples: [{ args: { query: 'Sapphire Reserve' } }],
 *       handler: async ({ query }) => fetch(`/search.json?q=${query}`).then(r => r.json()),
 *     }),
 *   });
 *
 * The returned `SkillBundle` is what the build pipeline assigns to
 * `window.xgoose.skills[<namespace>]`. The agent invokes functions
 * exclusively via `js_exec` — e.g. `await xgoose.skills.discourse.searchTopics({...})`.
 *
 * Zod schemas are **documentation only**: they feed `__describe__()` (which
 * the agent reaches via `help`) and produce JSON Schema for the agent's
 * planning, but they do NOT validate at call time. Handlers receive raw
 * args verbatim — fail fast on bad shapes inside your handler, or just
 * let the destructure throw naturally. This matches the rest of xgoose's
 * fail-fast philosophy and keeps the call path identical to a hand-written
 * `js_exec` snippet.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  FnHelp,
  FnSpec,
  FnSummaryMap,
  SkillAction,
  SkillBundle,
} from "./types";

/** Identity-typed `fn(...)` helper — purely a tag so TS keeps generics. */
export function fn<I, O>(spec: FnSpec<I, O>): FnSpec<I, O> {
  return spec;
}

export interface DefineSkillOptions {
  /**
   * Build-time metadata stamped into the bundle (`__meta__`). Authors
   * don't pass this directly; the build pipeline injects a known-good
   * meta block into the bundle's outer scope so `defineSkill` can pick
   * it up via `__XGOOSE_SKILL_META__` (or, if absent, the bundle just
   * carries an empty meta).
   */
  meta?: { name?: string; namespace?: string; primary?: string };
  /**
   * Author-declared clickable actions surfaced in the chat panel. Unlike the
   * header `@action` directive (prompt-only), these can carry `js` that runs
   * in the page first and feeds its JSON result into the agent's context.
   */
  actions?: SkillAction[];
  /**
   * Multi-line, agent-facing usage guidance for this skill. Surfaced verbatim
   * in the per-turn system reminder under the skill's heading — the place for
   * site-specific research/workflow discipline (keyword variations, pagination,
   * recency, cross-referencing, …) that shouldn't bloat the generic prompt.
   */
  instructions?: string;
}

/**
 * Take a record of `FnSpec`s, return the runtime `SkillBundle` that
 * gets attached to `window.xgoose.skills.<namespace>`. Handlers receive
 * raw args verbatim — no runtime Zod parsing. The agent calls each
 * function by writing a `js_exec` snippet (`await xgoose.skills.<ns>.<fn>(args)`)
 * just like it would any other in-page helper.
 *
 * The Zod schemas on each `FnSpec` are still surfaced through
 * `__describe__`, where `help` turns them into JSON Schema + examples
 * — that's the contract with the agent for "how should I shape my
 * args?". The actual call path stays as thin as possible.
 */
export function defineSkill<T extends Record<string, FnSpec<any, any>>>(
  spec: T,
  opts: DefineSkillOptions = {},
): SkillBundle {
  // Allow the build pipeline to stamp meta via a free global. Authors
  // never set this themselves; the wrapper IIFE that the build emits
  // assigns `__XGOOSE_SKILL_META__` right before invoking the module so
  // the meta is in scope when `defineSkill` runs.
  const globalMeta =
    typeof globalThis !== "undefined" &&
    (globalThis as any).__XGOOSE_SKILL_META__
      ? ((globalThis as any)
          .__XGOOSE_SKILL_META__ as DefineSkillOptions["meta"])
      : undefined;
  const meta = { ...(globalMeta ?? {}), ...(opts.meta ?? {}) };

  const fnNames = Object.keys(spec);
  const callables: Record<string, (raw: any) => Promise<any> | any> = {};

  for (const [name, f] of Object.entries(spec)) {
    // Pass raw args straight to the handler. If the agent passes a bad
    // shape, the handler's destructure or first property access throws —
    // that error bubbles back to `js_exec` and the agent self-corrects
    // by reading `help({ skill, function })`.
    callables[name] = (rawArgs: any) => {
      if (meta.namespace && (globalThis as any).xgoose?.skills?.[meta.namespace] !== bundle) {
        throw new Error(`Skill ${meta.namespace} has been disabled or replaced; refresh may be needed to clear prior side effects.`);
      }
      return f.handler(f.input.parse(rawArgs ?? {}));
    };
  }

  const summarize = (): FnSummaryMap => {
    const out: FnSummaryMap = {};
    for (const [name, f] of Object.entries(spec)) {
      const entry: FnSummaryMap[string] = {
        summary: f.summary,
        signature: oneLineSignature(name, f),
        invocation: invocationFor(meta.namespace, name),
        input: zodToJsonSchema(f.input, { target: "jsonSchema7" }),
      };
      if (f.output) {
        entry.output = zodToJsonSchema(f.output, { target: "jsonSchema7" });
      }
      if (f.examples && f.examples.length) {
        entry.examples = f.examples as FnSummaryMap[string]["examples"];
      }
      if (meta.primary && meta.primary === name) {
        entry.primary = true;
      }
      out[name] = entry;
    }
    return out;
  };

  const describe = (
    fnName?: string,
  ): FnHelp | FnSummaryMap | { error: string } => {
    if (!fnName) return summarize();
    const f = spec[fnName];
    if (!f) return { error: `unknown function: ${fnName}` };
    const help: FnHelp = {
      name: fnName,
      summary: f.summary,
      invocation: invocationFor(meta.namespace, fnName),
      input: zodToJsonSchema(f.input, { target: "jsonSchema7" }),
      examples: (f.examples ?? []) as FnHelp["examples"],
    };
    if (f.output) {
      help.output = zodToJsonSchema(f.output, { target: "jsonSchema7" });
    }
    return help;
  };

  const bundle = {
    ...callables,
    __isXgooseSkill__: true as const,
    __describe__: describe,
    __meta__: {
      name: meta.name,
      namespace: meta.namespace,
      primary: meta.primary,
      functions: fnNames,
      actions: opts.actions ?? [],
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
    },
  } as SkillBundle;
  return bundle;
}

/** Render a copy-pasteable `js_exec` snippet for one skill function. */
function invocationFor(namespace: string | undefined, name: string): string {
  const ns = namespace ?? "<namespace>";
  return `await xgoose.skills.${ns}.${name}({...})`;
}

/**
 * Produce a compact `name(arg: shape): out` string from a Zod schema —
 * not exhaustive, just enough that the agent can glance at the system
 * reminder and know the call shape without a `help` round-trip.
 */
function oneLineSignature(name: string, f: FnSpec<any, any>): string {
  const inDef = (f.input as any)?._def;
  const inShape = describeZodShape(inDef);
  const outShape = f.output
    ? describeZodShape((f.output as any)?._def)
    : "unknown";
  return `${name}(${inShape}): ${outShape}`;
}

function describeZodShape(def: any): string {
  if (!def) return "any";
  const t = def.typeName as string | undefined;
  switch (t) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodAny":
    case "ZodUnknown":
      return "any";
    case "ZodArray":
      return `${describeZodShape(def.type?._def)}[]`;
    case "ZodEnum":
      return (
        def.values?.map((v: string) => JSON.stringify(v)).join(" | ") || "enum"
      );
    case "ZodOptional":
      return `${describeZodShape(def.innerType?._def)}?`;
    case "ZodNullable":
      return `${describeZodShape(def.innerType?._def)} | null`;
    case "ZodDefault":
      return describeZodShape(def.innerType?._def);
    case "ZodObject": {
      const shape =
        typeof def.shape === "function" ? def.shape() : (def.shape ?? {});
      const fields = Object.entries(shape).map(([k, v]: [string, any]) => {
        const inner = v?._def;
        const isOpt =
          inner?.typeName === "ZodOptional" || inner?.typeName === "ZodDefault";
        return `${k}${isOpt ? "?" : ""}: ${describeZodShape(inner)}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    case "ZodRecord":
      return "Record<string, any>";
    case "ZodUnion":
      return (def.options ?? [])
        .map((o: any) => describeZodShape(o?._def))
        .join(" | ");
    case "ZodLiteral":
      return JSON.stringify(def.value);
    default:
      return "any";
  }
}
