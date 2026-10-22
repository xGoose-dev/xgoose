import type { CoreSettings, SettingsPort } from "@xgoose/core";
import { getSettings } from "@/shared/storage";
import {
  XGOOSE_HOSTED_AI_BASE_URL,
  getProviderApiKey,
  getProviderBaseUrl,
} from "@/shared/types";

/**
 * Project Chrome's rich settings onto the smaller `CoreSettings` surface
 * the core consumes. Read on demand so popup edits flow through on the
 * next turn without re-bootstrapping the content script.
 *
 * The host-only `'xgoose-hosted'` virtual provider is collapsed here to
 * `'openai-compat'` + the gateway base URL so any code path that reads
 * settings via this port sees a value the core can interpret. The apiKey
 * stays empty because the live account token is injected at agent
 * creation time in `agent/createAgent.ts`. Anything reading the port for
 * pricing or telemetry only needs `provider` + `model` — both of which
 * are accurate after this projection.
 */
export const chromeSettingsPort: SettingsPort = {
  getSettings(): CoreSettings {
    const s = getSettings();
    if (s.provider === "xgoose-hosted") {
      return {
        provider: "openai-compat",
        apiKey: "",
        model: s.model,
        baseUrl: XGOOSE_HOSTED_AI_BASE_URL,
        thinking: false,
      };
    }
    return {
      provider: s.provider,
      apiKey: getProviderApiKey(s),
      model: s.model,
      baseUrl: getProviderBaseUrl(s),
      thinking: s.thinking,
    };
  },
};
