// Per-million-token USD pricing for the models we support, used by the panel
// status bar to roll up cumulative USD per conversation.
//
// Numbers are list price for the public APIs as of mid-2025; close enough to
// give the user a directional cost estimate without pretending to be billing.
// "cached" is the discounted cache-read rate (Gemini implicit cache / OpenAI
// prompt caching). When a model is missing here we mark the turn `unpriced`
// and surface a `*` next to the cost in the status bar.
//
// Pricing for newly-released models can drift; users who want exact numbers
// should look at their provider's billing dashboard. This is a heuristic.

import type { Provider } from "./types";

export type ModelCosts = {
  /** USD per 1M input (uncached) tokens. */
  inputPerMTok: number;
  /** USD per 1M input tokens that hit the prompt cache. Usually ~25% of input. */
  cachedInputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** USD per 1M reasoning / thinking tokens; defaults to `outputPerMTok` when undefined. */
  reasoningPerMTok?: number;
};

// Keys are normalised to lower-case; lookup also strips trailing `-latest`,
// `-001`, dates, and provider prefixes (e.g. `models/`) so model strings the
// user might paste in still match.
const PRICES: Record<string, ModelCosts> = {
  // ── Gemini 2.5 family ──
  "gemini-2.5-pro": {
    inputPerMTok: 1.25,
    cachedInputPerMTok: 0.31,
    outputPerMTok: 10.0,
  },
  "gemini-2.5-flash": {
    inputPerMTok: 0.3,
    cachedInputPerMTok: 0.075,
    outputPerMTok: 2.5,
  },
  "gemini-2.5-flash-lite": {
    inputPerMTok: 0.1,
    cachedInputPerMTok: 0.025,
    outputPerMTok: 0.4,
  },
  "gemini-2.0-flash": {
    inputPerMTok: 0.1,
    cachedInputPerMTok: 0.025,
    outputPerMTok: 0.4,
  },

  // ── OpenAI ──
  "gpt-4o": {
    inputPerMTok: 2.5,
    cachedInputPerMTok: 1.25,
    outputPerMTok: 10.0,
  },
  "gpt-4o-mini": {
    inputPerMTok: 0.15,
    cachedInputPerMTok: 0.075,
    outputPerMTok: 0.6,
  },
  "gpt-4.1": {
    inputPerMTok: 2.0,
    cachedInputPerMTok: 0.5,
    outputPerMTok: 8.0,
  },
  "gpt-4.1-mini": {
    inputPerMTok: 0.4,
    cachedInputPerMTok: 0.1,
    outputPerMTok: 1.6,
  },
  "o4-mini": {
    inputPerMTok: 1.1,
    cachedInputPerMTok: 0.275,
    outputPerMTok: 4.4,
  },

  // ── xgoose Hosted (base tier of the gateway's HOSTED_PRICES; long-context
  // and DeepSeek peak-hour surcharges are not modelled) ──
  "gpt-6.1-sol": { inputPerMTok: 2.0, cachedInputPerMTok: 0.1, outputPerMTok: 10.0 },
  "gpt-6.1-terra": { inputPerMTok: 1.0, cachedInputPerMTok: 0.05, outputPerMTok: 5.0 },
  "claude-sonnet-5-5": { inputPerMTok: 2.0, cachedInputPerMTok: 0.1, outputPerMTok: 10.0 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
  "deepseek-purge": { inputPerMTok: 0.15, cachedInputPerMTok: 0.003, outputPerMTok: 0.6 },
  "deepseek-flash": { inputPerMTok: 0.15, cachedInputPerMTok: 0.003, outputPerMTok: 0.6 },
};

function normaliseModelId(model: string): string {
  let m = model.toLowerCase().trim();
  // Strip a provider prefix some Gemini callers prepend.
  if (m.startsWith("models/")) m = m.slice("models/".length);
  // Drop versioned suffixes (`-001`, `-002`, …, `-latest`).
  m = m.replace(/-(?:\d{3,4}|latest|preview(?:-\d{2}-\d{2})?)$/, "");
  return m;
}

export function costsFor(
  _provider: Provider,
  model: string,
): ModelCosts | null {
  if (!model) return null;
  const key = normaliseModelId(model);
  if (PRICES[key]) return PRICES[key];
  // Best-effort prefix match: handle e.g. `gemini-2.5-pro-exp-03-25` →
  // `gemini-2.5-pro`. We pick the longest matching prefix.
  let bestKey: string | null = null;
  for (const k of Object.keys(PRICES)) {
    if (key.startsWith(k) && (bestKey === null || k.length > bestKey.length))
      bestKey = k;
  }
  return bestKey ? PRICES[bestKey] : null;
}

export type PriceableTurn = {
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
};

/** USD spent on one turn given its provider-reported usage. */
export function priceTurn(c: ModelCosts, u: PriceableTurn): number {
  const inputTotal = Math.max(0, u.inputTokens ?? 0);
  const cached = Math.min(Math.max(0, u.cachedInputTokens ?? 0), inputTotal);
  const fresh = inputTotal - cached;
  const output = Math.max(0, u.outputTokens ?? 0);
  const reasoning = Math.max(0, u.reasoningTokens ?? 0);
  const reasoningRate = c.reasoningPerMTok ?? c.outputPerMTok;
  return (
    (fresh * c.inputPerMTok +
      cached * c.cachedInputPerMTok +
      output * c.outputPerMTok +
      reasoning * reasoningRate) /
    1_000_000
  );
}
