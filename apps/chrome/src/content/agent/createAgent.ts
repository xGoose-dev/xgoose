import {isSafari,hostCapabilities} from "@/shared/host";
import { normalizeHostedError } from "@/shared/hosted";
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
  onProviderResponse?: (event: {type:"model-response";requestId:string|null;status:number;firstResponseMs:number;contextTextBytes?:number;contextLimitBytes?:number;contextWindowTokens?:number;contextTargetTokens?:number;contextTargetBytes?:number}) => Promise<unknown>;
}): Promise<AgentBundle> {
  const tools = [
    ...buildCoreTools({ memory: chromeMemoryPort, origin: chromeOriginPort }),
    ...buildLegacyTools(),
  ];
  const coreSettings = await projectToCoreSettings(opts.settings);
  return coreCreateAgent({
    settings: coreSettings,
    fetchImpl: async (input, init) => {
      const started=Date.now();
      const response=await getFetchImpl()(input,init);
      // Record correlation metadata, never request headers or credentials.
      await opts.onProviderResponse?.({type:"model-response",requestId:response.headers.get("x-request-id"),status:response.status,firstResponseMs:Date.now()-started,...(response.headers.get("x-xgoose-context-unit")==="utf8_bytes"?{contextTextBytes:Number(response.headers.get("x-xgoose-context-text-bytes")),contextLimitBytes:Number(response.headers.get("x-xgoose-context-limit-bytes"))}:{ }),
        ...(response.headers.has('x-xgoose-context-window-tokens')?{contextWindowTokens:Number(response.headers.get('x-xgoose-context-window-tokens'))}:{}),
        ...(response.headers.has('x-xgoose-context-target-tokens')?{contextTargetTokens:Number(response.headers.get('x-xgoose-context-target-tokens'))}:{}),
        ...(response.headers.has('x-xgoose-context-target-bytes')?{contextTargetBytes:Number(response.headers.get('x-xgoose-context-target-bytes'))}:{})});
      return opts.settings.provider === "xgoose-hosted" ? normalizeHostedError(response) : response;
    },
    tools,
    reminder: opts.reminder,
    capabilities:hostCapabilities,
  });
}

async function projectToCoreSettings(s: Settings): Promise<{
  provider: "gemini" | "gemini-litellm" | "openai-compat";
  apiKey: string;
  model: string;
  baseUrl: string;
  thinking: boolean;
  contextWindowTokens?: number;
}> {
  if (s.provider !== "xgoose-hosted") {
    return {
      provider: s.provider,
      apiKey: isSafari ? (await send("sw:native_credentials",{provider:s.provider})).apiKey : getProviderApiKey(s),
      model: s.model,
      baseUrl: getProviderBaseUrl(s),
      thinking: s.thinking,
    };
  }
  const state = await send("sw:hosted_status", {useHosted:true});
  if (state.blocker) throw new Error(state.blocker);
  const account = await send("sw:account_get", undefined);
  if (!account) {
    throw new Error(
      "xgoose hosted AI requires you to sign in. Open the options page and sign in via xgoose.org, or pick a different provider.",
    );
  }
  // Model metadata comes from the signed-in gateway, so a future Hosted model
  // need not fall back to the bundled catalogue's conservative unknown window.
  const catalogue=await send('sw:list_xgoose_models',{}).catch(()=>null);
  const contextWindowTokens=catalogue?.ok?catalogue.contextWindows?.[s.model]:undefined;
  return {
    provider: "openai-compat",
    apiKey: account.accessToken,
    model: s.model,
    baseUrl: XGOOSE_HOSTED_AI_BASE_URL,
    thinking: false,
    ...(contextWindowTokens?{contextWindowTokens}:{}),
  };
}
