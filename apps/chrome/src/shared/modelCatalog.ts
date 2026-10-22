// Curated catalogue of model "choices" surfaced in the options page
// dropdown. Each entry is `(provider, model, thinking)` where `thinking`
// is the per-call Gemini reasoning flag that core's `providerOptionsFor`
// reads.
//
// Why entries instead of plain model names: we want the model dropdown
// itself to spell out the thinking variant — e.g. "gemini-2.5-pro" and
// "gemini-2.5-pro (thinking)" appear as separate items — instead of
// hanging a side-channel checkbox off the model selector. The persisted
// `settings.model` stays a clean SDK model id and `settings.thinking`
// stays a boolean, so nothing downstream (createAgent, core,
// providerOptionsFor) has to change.

import type { Provider } from "./types";

export type ModelEntry = {
  /** The wire-format model id passed to `google(...)` / `openai.chat(...)`. */
  id: string;
  /** Whether to enable Gemini "thinking" providerOptions for this entry.
   *  Always `false` for openai-compat / xgoose-hosted (the core
   *  `providerOptionsFor` only emits the thinking config for the gemini
   *  family today). */
  thinking: boolean;
  /** Human-friendly label shown in the dropdown. */
  label: string;
};

const GEMINI_ENTRIES: ModelEntry[] = [
  { id: "gemini-2.5-pro", thinking: false, label: "gemini-2.5-pro" },
  {
    id: "gemini-2.5-pro",
    thinking: true,
    label: "gemini-2.5-pro (thinking)",
  },
  { id: "gemini-2.5-flash", thinking: false, label: "gemini-2.5-flash" },
  {
    id: "gemini-2.5-flash",
    thinking: true,
    label: "gemini-2.5-flash (thinking)",
  },
  {
    id: "gemini-2.5-flash-lite",
    thinking: false,
    label: "gemini-2.5-flash-lite",
  },
  {
    id: "gemini-2.5-flash-lite",
    thinking: true,
    label: "gemini-2.5-flash-lite (thinking)",
  },
  { id: "gemini-2.0-flash", thinking: false, label: "gemini-2.0-flash" },
  {
    id: "gemini-2.0-flash-lite",
    thinking: false,
    label: "gemini-2.0-flash-lite",
  },
];

const OPENAI_COMPAT_ENTRIES: ModelEntry[] = [
  { id: "gpt-4o", thinking: false, label: "gpt-4o" },
  { id: "gpt-4o-mini", thinking: false, label: "gpt-4o-mini" },
  { id: "gpt-4.1", thinking: false, label: "gpt-4.1" },
  { id: "gpt-4.1-mini", thinking: false, label: "gpt-4.1-mini" },
  { id: "gpt-4.1-nano", thinking: false, label: "gpt-4.1-nano" },
  { id: "o1", thinking: false, label: "o1" },
  { id: "o1-mini", thinking: false, label: "o1-mini" },
  { id: "o3-mini", thinking: false, label: "o3-mini" },
  { id: "o4-mini", thinking: false, label: "o4-mini" },
];

export const MODEL_ENTRIES: Record<Provider, ModelEntry[]> = {
  gemini: GEMINI_ENTRIES,
  "gemini-litellm": GEMINI_ENTRIES,
  "openai-compat": OPENAI_COMPAT_ENTRIES,
  // Populated dynamically from the worker (`sw:list_xgoose_models`). The
  // hosted route collapses to openai-compat over the wire so no thinking
  // variants are emitted server-side either.
  "xgoose-hosted": [],
};

const THINK_SUFFIX = "::thinking";

/** Encode an entry as the `<option value>` for the dropdown. We can't use
 *  the raw model id alone because two entries share it (with vs without
 *  thinking) and `<select>` needs distinct values. */
export function encodeEntry(e: ModelEntry): string {
  return e.thinking ? `${e.id}${THINK_SUFFIX}` : e.id;
}

/** Inverse of `encodeEntry`. */
export function decodeValue(v: string): { id: string; thinking: boolean } {
  if (v.endsWith(THINK_SUFFIX)) {
    return { id: v.slice(0, -THINK_SUFFIX.length), thinking: true };
  }
  return { id: v, thinking: false };
}

/** Look up the catalogue entry that matches a stored `(model, thinking)`
 *  pair, or `undefined` if the user is on a custom (non-curated) model. */
export function findEntry(
  provider: Provider,
  model: string,
  thinking: boolean,
): ModelEntry | undefined {
  const list = MODEL_ENTRIES[provider] ?? [];
  return list.find((e) => e.id === model && e.thinking === thinking);
}
