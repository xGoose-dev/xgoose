import { z } from "zod";

// ---------------------------------------------------------------------------
// Provider + settings
//
// The host (Safari, Chrome, …) is free to extend `Settings` with its own
// preferences. `@xgoose/core` only reads the fields below; everything else
// is opaque to it.
// ---------------------------------------------------------------------------

export const ProviderSchema = z.enum([
  "gemini", // native Gemini API
  "gemini-litellm", // Gemini via a LiteLLM proxy (baseURL override on the Google provider)
  "openai-compat", // any OpenAI Chat-Completions-compatible endpoint
]);
export type Provider = z.infer<typeof ProviderSchema>;

/**
 * Subset of host settings consumed by `@xgoose/core`. Hosts pass these
 * via `SettingsPort.getSettings()` and can layer additional keys on top
 * for their own tools / UI.
 */
export interface CoreSettings {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl: string;
  thinking: boolean;
}

// ---------------------------------------------------------------------------
// Todo store (drives `todo_write` and the per-turn system reminder)
// ---------------------------------------------------------------------------

export type TodoItem = {
  id: string;
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
};

// ---------------------------------------------------------------------------
// Conversation usage / metrics (mirrors webagent's status-bar surface).
//
// `cachedInputTokens` is the share of `inputTokens` that the provider
// reported as a prompt-cache hit (Gemini `cachedContentTokenCount`,
// OpenAI `prompt_tokens_details.cached_tokens`). Tracking this lets the
// status bar show a live cache-hit % so users can see whether prompt
// caching is actually kicking in for them.
// ---------------------------------------------------------------------------

export type ConversationUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  turns: number;
  /**
   * Cumulative USD spent on this conversation, summed from per-turn usage
   * times per-model pricing in `pricing.ts`. Turns on models that we don't
   * have prices for bump `unpricedTurns` instead.
   */
  costUsd: number;
  unpricedTurns: number;
};

export const EMPTY_USAGE: ConversationUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  turns: 0,
  costUsd: 0,
  unpricedTurns: 0,
};

// ---------------------------------------------------------------------------
// Skill summaries (consumed by the system-reminder builder + skill tools).
//
// Hosts that don't expose skills can pass `activeSkills: []` and these
// types are unused. The build-pipeline schema lives in the host (it's
// tied to the host's on-disk skill registry).
// ---------------------------------------------------------------------------

export type SkillFnSummary = {
  name: string;
  summary: string;
  signature: string;
  /**
   * Copy-pasteable `js_exec` snippet — e.g. `await xgoose.skills.discourse.searchTopics({...})`.
   * Optional for backward compatibility with older registry rows; the reminder
   * falls back to constructing one from `namespace.name` when missing.
   */
  invocation?: string;
  /**
   * Full JSON Schemas + worked examples for the function. Built into the
   * registry by `build-skills.mjs` (or extracted client-side by
   * `SkillUploader` for marketplace uploads). When present, the per-turn
   * system reminder emits these inline so the agent can shape its
   * `js_exec` args without a `help()` round trip. Optional because user
   * skills bundled inside the extension SW can't currently statically
   * extract them — `help()` is still the fallback for those.
   */
  input?: unknown;
  output?: unknown;
  // `args` is `unknown` (effectively optional) to match what `z.unknown()`
  // infers in the per-host SkillFnSummarySchema — Zod treats `z.unknown()`
  // as implicitly optional, so hoisting the inferred type into `SkillRef`
  // would otherwise fail an `args: unknown` annotation here.
  examples?: Array<{ args?: unknown; note?: string; returns?: unknown }>;
  primary?: boolean;
};

/**
 * Minimum surface the system-reminder builder needs from a skill. Hosts
 * are free to use a richer struct internally; the reminder reads only the
 * fields below.
 */
export type SkillRef = {
  name: string;
  namespace: string;
  description?: string;
  /** Multi-line, agent-facing usage guidance authored on the skill
   *  (`defineSkill(spec, { instructions })`). Rendered in the per-turn
   *  system reminder under the skill heading. */
  instructions?: string;
  matches?: string[];
  keywords?: string[];
  primary?: string;
  functions?: SkillFnSummary[];
};
