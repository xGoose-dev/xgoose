import {createSearchTool} from "./searchTool";
import {isSafari,hostCapabilities} from "@/shared/host";
import {isAgentPage} from "@/shared/peers";
import type {XgooseBuiltTool} from "@xgoose/core";
import { normalizeHostedError } from "@/shared/hosted";
import {resolveHostedModel} from "@/shared/hostedModels";
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

/** Hosted requests are session-managed in the worker, including compaction.
 * The runtime carries only the original account ID and a non-secret SDK marker;
 * each HTTP request reads current credentials and can recover one rejected 401.
 * BYOK retains its own provider key and transport without account recovery.
 */
export async function createAgent(opts: {
  settings: Settings;
  reminder?: string | null;
  peerTools?: XgooseBuiltTool[];
  shouldYield?: () => boolean;
  onProviderResponse?: (event: {type:"model-response";requestId:string|null;status:number;firstResponseMs:number;contextTextBytes?:number;contextLimitBytes?:number;contextWindowTokens?:number;contextTargetTokens?:number;contextTargetBytes?:number}) => Promise<unknown>;
}): Promise<AgentBundle> {
  const coreSettings = await projectToCoreSettings(opts.settings);
  const searchAccountId=coreSettings.hostedAccountId ?? (await send("sw:account_get",undefined).catch(()=>null))?.user.id;
  const tools = [
    ...buildCoreTools({ memory: chromeMemoryPort, origin: chromeOriginPort }),
    ...(isAgentPage() ? [] : buildLegacyTools()),
    ...(opts.peerTools ?? []),
    createSearchTool(searchAccountId),
  ];
  const fetchProvider=opts.settings.provider==="xgoose-hosted"?createChromeProviderFetch({hostedAccountId:coreSettings.hostedAccountId}):getFetchImpl();
  return coreCreateAgent({
    settings: coreSettings,
    fetchImpl: async (input, init) => {
      const started=Date.now();
      const response=await fetchProvider(input,init);
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
    shouldYield: opts.shouldYield,
  });
}

async function projectToCoreSettings(s: Settings): Promise<{
  provider: "gemini" | "gemini-litellm" | "openai-compat";
  apiKey: string;
  model: string;
  baseUrl: string;
  thinking: boolean;
  contextWindowTokens?: number;
  hostedAccountId?:string;
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
  const model=resolveHostedModel(s.model,catalogue?.ok?catalogue:null);
  const contextWindowTokens=catalogue?.ok?catalogue.contextWindows?.[model]:undefined;
  return {
    provider: "openai-compat",
    apiKey: "hosted-session-managed",
    hostedAccountId:account.user.id,
    model,
    baseUrl: XGOOSE_HOSTED_AI_BASE_URL,
    thinking: false,
    ...(contextWindowTokens?{contextWindowTokens}:{}),
  };
}
