// Chrome host wrapper around `@xgoose/core`'s `createAgent`. Composes the
// core agent, the page-controller DOM tools, and the host-specific skill
// tools (list_skills, skill_call, etc.) so content/index.ts can spin up
// turns with a single import.
//
// Mirrors xgoose-safari/src/content/agent/createAgent.ts shape — the
// projection from the rich `Settings` onto the smaller `CoreSettings`
// surface is identical, and the fetch impl is cached the same way.

import {
  createAgent as coreCreateAgent,
  buildCoreTools,
  type AgentBundle,
} from "@xgoose/core";
import {
  XGOOSE_HOSTED_AI_BASE_URL,
  getProviderApiKey,
  getProviderBaseUrl,
  type Settings,
} from "@/shared/types";
import {
  chromeMemoryPort,
  chromeOriginPort,
  createChromeProviderFetch,
} from "@/content/hostPorts";
import { send } from "@/shared/messages";
import { buildLegacyTools } from "./tools";

export type { AgentBundle };

let cachedFetch: ReturnType<typeof createChromeProviderFetch> | null = null;
function getFetchImpl(): ReturnType<typeof createChromeProviderFetch> {
  if (!cachedFetch) cachedFetch = createChromeProviderFetch();
  return cachedFetch;
}

/**
 * Async because the `'xgoose-hosted'` provider has to fetch the current
 * account access token from the background SW before it can construct
 * the equivalent `openai-compat` settings. For every other provider
 * this is a fast pass-through.
 *
 * The xgoose-hosted virtual provider is collapsed to `'openai-compat'`
 * + the gateway base URL + the user's bearer token here, so the core
 * `createAgent` never has to know about it. If the user picks hosted
 * but isn't signed in we throw an actionable error — the content panel
 * surfaces it to the user with a "Sign in" CTA in the options page.
 */
export async function createAgent(opts: {
  settings: Settings;
  reminder?: string | null;
}): Promise<AgentBundle> {
  const tools = [
    ...buildCoreTools({ memory: chromeMemoryPort, origin: chromeOriginPort }),
    ...buildLegacyTools(),
  ];
  const coreSettings = await projectToCoreSettings(opts.settings);
  return coreCreateAgent({
    settings: coreSettings,
    fetchImpl: getFetchImpl(),
    tools,
    reminder: opts.reminder,
  });
}

async function projectToCoreSettings(s: Settings): Promise<{
  provider: "gemini" | "gemini-litellm" | "openai-compat";
  apiKey: string;
  model: string;
  baseUrl: string;
  thinking: boolean;
}> {
  if (s.provider !== "xgoose-hosted") {
    return {
      provider: s.provider,
      apiKey: getProviderApiKey(s),
      model: s.model,
      baseUrl: getProviderBaseUrl(s),
      thinking: s.thinking,
    };
  }
  const account = await send("sw:account_get", undefined);
  if (!account) {
    throw new Error(
      "xgoose hosted AI requires you to sign in. Open the options page and sign in via xgoose.org, or pick a different provider.",
    );
  }
  return {
    provider: "openai-compat",
    apiKey: account.accessToken,
    model: "luna",
    baseUrl: XGOOSE_HOSTED_AI_BASE_URL,
    thinking: false,
  };
}
