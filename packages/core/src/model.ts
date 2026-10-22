import type { Model, Api } from "@earendil-works/pi-ai";
import type { CoreSettings, Provider } from "./types";
import type { HostFetcher } from "./ports";

export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  gemini: "gemini-2.5-pro",
  "gemini-litellm": "gemini-2.5-pro",
  "openai-compat": "gpt-4o-mini",
};

export const KNOWN_MODELS: Record<Provider, string[]> = {
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
  ],
  "gemini-litellm": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "openai-compat": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
};

/** Model credentials and transport stay in the host; this object contains no secrets. */
export function createModel(s: CoreSettings, _fetchImpl?: HostFetcher): Model<Api> {
  const google = s.provider === "gemini" || s.provider === "gemini-litellm";
  let baseUrl = (s.baseUrl || (google ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com")).replace(/\/+$/, "");
  if (!google && !baseUrl.endsWith("/v1")) baseUrl += "/v1";
  return {
    id: s.model, name: s.model, provider: google ? "google" : "xgoose",
    api: google ? "google-generative-ai" : "openai-completions",
    baseUrl, reasoning: s.thinking, input: ["text", "image"],
    contextWindow: 128000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(!google ? { compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens" as const } } : {}),
  } as Model<Api>;
}

export function providerOptionsFor(_s: CoreSettings): undefined { return undefined; }
