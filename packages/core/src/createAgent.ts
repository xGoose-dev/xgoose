import {requestContextTokens,estimateTextTokens} from './contextTokens';
import {requestTextBytes,textBytes,clipBytes,textChunks,omitImageBytes,modelOnlyMessage,collapsedSystem,excerptSummary} from "./contextWindow";
import {inputTokenBudget,requestByteBudget,OUTPUT_RESERVE_TOKENS} from './contextPolicy';
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { Agent, type AgentMessage, type StreamFn, type AgentContext } from "@earendil-works/pi-agent-core";
import { streamSimple as openai } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as google } from "@earendil-works/pi-ai/api/google-generative-ai";
import type { AssistantMessage, Model, Api } from "@earendil-works/pi-ai";
import {AssistantMessageEventStream} from "@earendil-works/pi-ai/utils/event-stream";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CoreSettings } from "./types";
import type { HostFetcher } from "./ports";
import { buildSystemPrompt } from "./systemPrompt";
import { createModel } from "./model";
import type { XgooseBuiltTool } from "./tools/buildTool";

/** Stable host contract. Persisted v1 messages are converted at the PI boundary. */
export interface ChatMessage { role: string; content: any; [key: string]: any }
export interface RuntimeEvent { type: string; [key: string]: any }
export interface RuntimeSnapshot { messages: ChatMessage[]; running: boolean; error?: string }
export interface CreateAgentOpts {
  settings: CoreSettings;
  fetchImpl: HostFetcher;
  tools: XgooseBuiltTool[];
  reminder?: string | null;
  capabilities?: {dynamicJavaScript:boolean;customSkills:boolean};
  maxSteps?: number;
  contextBudgetChars?: number;
  requestBudgetBytes?: number;
  maxContextMessages?: number;
  /** Injectable provider stream for deterministic acceptance tests. */
  streamFn?: StreamFn;
}
export type AgentBundle = { agent: PageAgentRuntime; tools: Record<string, XgooseBuiltTool> };
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
function capContextImages(messages:AgentMessage[]):AgentMessage[] {
  let left=8;
  return messages.slice().reverse().map(message=>!Array.isArray(message.content)?message:{...message,content:message.content.slice().reverse().map(part=>part.type==='image'&&left--<=0?{type:'text' as const,text:'[Earlier source image omitted from model context; read it again if needed.]'}:part).reverse()} as AgentMessage).reverse();
}

export function toPiMessages(messages: ChatMessage[], model: Model<Api>): AgentMessage[] {
  // Keep recent image context bounded without deleting local conversation history.
  let imagesLeft=8;
  const bounded=messages.slice().reverse().map(message=>{
    if(!["user","tool"].includes(message.role)||!Array.isArray(message.content))return message;
    const boundImage=(part:any)=>part?.type==="image"?(imagesLeft-->0?part:{type:"text",text:"[Earlier image omitted from model context. Ask the user to reattach it if needed.]"}):part;
    const content=message.content.slice().reverse().map((part:any)=>part?.type==='tool-result'&&Array.isArray(part.images)?{...part,images:part.images.slice().reverse().map(boundImage).reverse()}:boundImage(part)).reverse();
    return {...message,content};
  }).reverse();
  return bounded.flatMap((m): AgentMessage[] => {
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
    if (m.role === "user") return [{ role: "user", content, timestamp: m.timestamp ?? Date.now() }];
    if (m.role === "system") return [{ role: "system", content: typeof m.content === "string" ? m.content : content.map((p: any) => p.text ?? "").join("\n"),timestamp:m.timestamp??0 } as AgentMessage];
    if (m.role === "assistant") return [{ role: "assistant", content: content.map((p: any) => p.type === "tool-call" ? { type: "toolCall", id: p.toolCallId, name: p.toolName, arguments: p.input, ...(p.thoughtSignature ? {thoughtSignature:p.thoughtSignature} : {}) } : p.type === "reasoning" ? { type: "thinking", thinking: p.text, ...(p.thinkingSignature ? {thinkingSignature:p.thinkingSignature} : {}) } : p), api: m.api ?? model.api, provider: m.provider ?? model.provider, model: m.model ?? model.id, usage: emptyUsage(), stopReason: "stop", timestamp: m.timestamp ?? Date.now() } as AssistantMessage];
    if (m.role === "tool") return content.map((p: any) => ({ role: "toolResult", toolCallId: p.toolCallId, toolName: p.toolName, content: [{ type: "text", text: typeof p.output?.value === "string" ? p.output.value : JSON.stringify(p.output?.value ?? p.output ?? null) },...(p.images??[])], isError: p.output?.type === "error-text", timestamp: m.timestamp ?? Date.now() }));
    return [];
  });
}
export function fromPiMessages(messages: AgentMessage[], forModel = false): ChatMessage[] {
  return messages.flatMap((m): ChatMessage[] => {
    if (m.role === "user") return [{ role: "user", content: m.content }];
    if (m.role === "assistant") return [{ role: "assistant", api:m.api, provider:m.provider, model:m.model, content: m.content.map(p => p.type === "toolCall" ? { type: "tool-call", toolCallId: p.id, toolName: p.name, input: p.arguments, ...(p.thoughtSignature ? {thoughtSignature:p.thoughtSignature} : {}) } : p.type === "thinking" ? { type: "reasoning", text: p.thinking, ...(p.thinkingSignature ? {thinkingSignature:p.thinkingSignature} : {}) } : p) }];
    if (m.role === "toolResult") return [{ role: "tool", content: [{ type: "tool-result", toolCallId: m.toolCallId, toolName: m.toolName, output: { type: m.isError ? "error-text" : "json", value: (!forModel && !m.isError ? m.details : undefined) ?? m.content.map(p => p.type === "text" ? p.text : "[image]").join("\n") },...(m.content.some(p=>p.type==='image')?{images:m.content.filter(p=>p.type==='image')}:{}) }] }];
    return [];
  });
}

class EventQueue implements AsyncIterable<RuntimeEvent> {
  private items: RuntimeEvent[] = [];
  private wake?: () => void;
  private done = false;
  push(event: RuntimeEvent) { this.items.push(event); this.wake?.(); }
  close() { this.done = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    while (!this.done || this.items.length) {
      if (this.items.length) yield this.items.shift()!;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}

export class PageAgentRuntime {
  private pi?: Agent;
  private modelMessages: AgentMessage[] = [];
  private listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  constructor(private opts: CreateAgentOpts) {}
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  stop() { this.pi?.abort(); }
  snapshot(): RuntimeSnapshot { return { messages: fromPiMessages(this.modelMessages, true), running: this.pi?.state.isStreaming ?? false, error: this.pi?.state.errorMessage }; }
  async stream(input: { messages: ChatMessage[]; abortSignal?: AbortSignal }) {
    if (this.pi?.signal) throw new Error("This runtime already has an active run");
    input.abortSignal?.throwIfAborted();
    const opts = this.opts, model = createModel(opts.settings), queue = new EventQueue();
    const history = toPiMessages(input.messages, model);
    this.modelMessages = history;
    let steps = 0;
    const completedMessages: AgentMessage[] = [];
    const summaryUsage: AssistantMessage[] = [];
    let gatewayBudget=opts.requestBudgetBytes??requestByteBudget(model.contextWindow);
    let tokenBudget=inputTokenBudget(model.contextWindow);
    let activeContext:AgentContext|undefined;
    const rawStream: StreamFn = opts.streamFn ?? ((m, context, options) => {
      const requestOptions = { ...options, apiKey: opts.settings.apiKey, fetch: async (input:any,init:any)=>{
        const response=await opts.fetchImpl(input,init);
        // A newer successful gateway policy may replace a legacy small cap.
        // Error targets still tighten the current request, and explicit host
        // overrides remain caps. Never permanently latch the smallest policy
        // observed during a rollout into a million-token conversation.
        const window=Number(response.headers.get('x-xgoose-context-window-tokens'));
        if(response.ok&&Number.isSafeInteger(window)&&window>=8192&&window<=16_000_000)model.contextWindow=window;
        const target=Number(response.headers.get("x-xgoose-context-target-bytes"));
        if(Number.isFinite(target)&&target>=32000)gatewayBudget=Math.min(response.ok?(opts.requestBudgetBytes??requestByteBudget(model.contextWindow)):gatewayBudget,target);
        const tokens=Number(response.headers.get('x-xgoose-context-target-tokens'));
        if(Number.isFinite(tokens)&&tokens>=1024)tokenBudget=Math.min(response.ok?inputTokenBudget(model.contextWindow):tokenBudget,tokens);
        return response;
      }, maxRetries: 0, maxTokens: options?.maxTokens ?? 4096 };
      if (m.api === "google-generative-ai") {
        // PI rejects its top-level fetch option for Google. The underlying
        // Google SDK supports a per-request transport through httpOptions.
        // Keep the host's background proxy (CSP, streaming and cancellation)
        // rather than falling back to the page's global fetch.
        const { fetch: hostFetch, ...googleOptions } = requestOptions;
        return google(m as any, context, {
          ...googleOptions,
          onPayload: async (payload: any, model) => {
            const next = await googleOptions.onPayload?.(payload, model) ?? payload;
            return { ...next, config: { ...next.config, httpOptions: {
              ...next.config?.httpOptions, fetch: hostFetch,
            } } };
          },
        });
      }
      return openai(m as any, context, requestOptions);
    });
    const compactContext = async (context:AgentContext,signal?:AbortSignal,force=false) => {
        this.modelMessages = context.messages;
        const budget=gatewayBudget;
        const size=requestTextBytes(context.messages,model);
        const tokens=requestContextTokens(context.messages,model);
        const legacyTrigger=opts.contextBudgetChars!==undefined&&JSON.stringify(context.messages.map(modelOnlyMessage),omitImageBytes).length>opts.contextBudgetChars;
        if(size<=budget&&tokens<=tokenBudget&&!legacyTrigger&&!force&&context.messages.length<(opts.maxContextMessages??4800))return;
        await emit({type:"context-compacting",beforeBytes:size,estimatedInputTokens:tokens,
          contextWindowTokens:model.contextWindow,inputTokenBudget:tokenBudget,requestBudgetBytes:budget,
          model:model.id,messageCount:context.messages.length,
          reason:force?'gateway_rejection':size>budget?'byte_limit':tokens>tokenBudget?'token_limit':legacyTrigger?'legacy_override':'message_limit'});
        signal?.throwIfAborted();
        const system=collapsedSystem(context.messages);
        const transcript=context.messages.filter(message=>message.role!=="system");
        const latestUserIndex=transcript.map((message,index)=>message.role==="user"?index:-1).filter(index=>index>=0).at(-1)??-1;
        let latestUser=latestUserIndex>=0?transcript[latestUserIndex]:undefined;
        const older=transcript.filter((_message,index)=>index!==latestUserIndex);
        const goal=latestUser?clipBytes(JSON.stringify(latestUser,omitImageBytes),Math.min(6000,Math.max(512,Math.floor(tokenBudget*.5)))):"Continue the user's task.";
        let summaryFailed=false;
        const summarize=async (text:string):Promise<string>=>{
          const summaries:string[]=[];
          const chunks=textChunks(text,Math.min(1_200_000,Math.floor(budget*.3),Math.max(512,Math.floor((tokenBudget-2048)*1.2))));
          for(let index=0;index<chunks.length;index++){
            const chunk=chunks[index];
            // Dense Unicode/code can tokenize differently from ordinary prose.
            // Split an overfull candidate before dispatching the summary call.
            if(textBytes(chunk)>512&&estimateTextTokens(chunk)>Math.max(128,(tokenBudget-1536)*.8)){
              chunks.splice(index,1,...textChunks(chunk,Math.ceil(textBytes(chunk)/2)));index--;continue;
            }
            signal?.throwIfAborted();
            if(summaryFailed){summaries.push(clipBytes(chunk,2000));continue;}
            const summaryStream=await rawStream(model,normalizeContext({messages:[{role:"user",timestamp:Date.now(),content:
              "Summarize this browser-agent history for continuation in at most 1200 words. Preserve the user's goal, findings, titles, IDs, URLs, dates, numeric fields, completed queries, pages/cursors, failed endpoints and actions already performed. Keep the handoff focused on continuing the task from its current state. Current request: "+goal+"\nHistory:\n"+chunk}]}),{signal,apiKey:opts.settings.apiKey,fetch:opts.fetchImpl,maxTokens:2048,maxRetries:0});
            const result=await summaryStream.result();
            signal?.throwIfAborted();
            const text=result.content.filter(part=>part.type==="text").map(part=>part.text).join("\n");
            if(result.stopReason==="error"||result.stopReason==="aborted"||!text){summaryFailed=true;summaries.push(clipBytes(chunk,2000));continue;}
            summaryUsage.push(result);
            summaries.push(clipBytes(text,12000));
          }
          let combined=summaries.join("\n\n");
          // Hierarchical merge: every source chunk is seen, but no summary call
          // can exceed the same gateway limit it is intended to avoid.
          if(textBytes(combined)>36000&&!summaryFailed){
            const merged=await summarize(combined);combined=merged;
          }
          return combined;
        };
        const originalText=JSON.stringify(older.map(modelOnlyMessage),omitImageBytes);
        let summary=older.length?await summarize(originalText):"";
        if(summaryFailed)summary=excerptSummary(older);
        // Preserve the current request and its image attachments separately.
        if(latestUser&&(textBytes(JSON.stringify(latestUser,omitImageBytes))>32000||requestContextTokens([latestUser],model)>tokenBudget*.6)){
          const parts=Array.isArray(latestUser.content)?latestUser.content:[];
          const images=parts.filter((part:any)=>part.type==="image") as any[];
          const condensed=await summarize(JSON.stringify(latestUser,omitImageBytes));
          latestUser={...latestUser,content:[{type:"text",text:"Current request condensed automatically; exact full text remains in local history.\n"+clipBytes(condensed,Math.min(20000,Math.max(512,Math.floor(tokenBudget*.8))))},...images]};
        }
        const recentImages=older.flatMap((message:any)=>Array.isArray(message.content)?message.content.filter((part:any)=>part.type==="image"):[]);
        const latestImages=latestUser&&Array.isArray(latestUser.content)?latestUser.content.filter((part:any)=>part.type==="image").length:0;
        const imageSlots=Math.max(0,8-latestImages);
        const preservedImages=imageSlots?recentImages.slice(-imageSlots):[];
        const marker="Earlier context summary (preserve usable findings and continue from completed work; never repeat mutations; read omitted details only when needed for the answer):\n";
        const summaryMessage:AgentMessage={role:"user",content:[{type:"text",text:marker+clipBytes(summary,36000)},...preservedImages],timestamp:Date.now()};
        let messages:AgentMessage[]=[...system,summaryMessage,...(latestUser?[latestUser]:[])];
        // Normally the bounded system reminder + summary are far below budget.
        // Retain the original latest request if a summary needs a tighter cap.
        if(requestTextBytes(messages,model)>budget){
          (summaryMessage.content as any[])[0].text=marker+clipBytes(summary,8000);
        }
        for(let limit=4000;requestContextTokens(messages,model)>tokenBudget&&limit>=250;limit=Math.floor(limit/2)){
          (summaryMessage.content as any[])[0].text=marker+clipBytes(summary,limit);
        }
        if(requestTextBytes(messages,model)>budget||requestContextTokens(messages,model)>tokenBudget)throw new Error("Installed tool documentation exceeds the request budget. Disable oversized custom skills and try again.");
        this.modelMessages=messages;
        await emit({type:"context-summary",text:summary,beforeBytes:size,afterBytes:requestTextBytes(messages,model),modelContext:fromPiMessages(messages,true)});
        return {...context,messages};
    };


    const streamProvider:StreamFn=(m,context,options)=>{
      const output=new AssistantMessageEventStream();
      void (async()=>{
        let current=context;
        for(let attempt=0;attempt<2;attempt++){
          const source=await rawStream(m,current,options);let retry=false,committed=false;
          for await(const event of source){
            if(event.type==="error"&&!committed&&attempt===0&&activeContext&&/context.{0,35}(?:too (?:large|long)|limit|exceed)|context_length_exceeded|maximum context length/i.test(event.error.errorMessage??"")){
              tokenBudget=Math.min(tokenBudget,Math.max(16000,requestContextTokens(collapsedSystem(current.messages),model)+4096,Math.floor(requestContextTokens(current.messages,model)*.6)));
              const compacted=await compactContext(activeContext,options?.signal,true);
              if(compacted){activeContext.messages=compacted.messages;this.modelMessages=compacted.messages;current=normalizeContext({messages:compacted.messages as any});retry=true;break;}
            }
            if(event.type.endsWith("_delta")||event.type==="toolcall_start")committed=true;
            output.push(event);
          }
          if(!retry)return;
        }
      })().catch(error=>{
        const message:AssistantMessage={role:"assistant",content:[],api:m.api,provider:m.provider,model:m.id,usage:emptyUsage(),stopReason:options?.signal?.aborted?"aborted":"error",errorMessage:error instanceof Error?error.message:String(error),timestamp:Date.now()};
        output.push({type:"error",reason:message.stopReason as "error"|"aborted",error:message});
      });
      return output;
    };
    const pi = new Agent({
      initialState: {
        model, systemPrompt: buildSystemPrompt(opts.reminder ?? null,opts.capabilities), messages: history,
        thinkingLevel: opts.settings.thinking ? "medium" : "off",
        tools: opts.tools.map(({ name, definition: def }) => ({
          name, label: name, description: def.description,
          parameters: zodToJsonSchema(def.inputSchema, { $refStrategy: "none" }) as any,
          replay: "never" as const,
          execute: async (id: string, args: unknown, signal?: AbortSignal) => {
            signal?.throwIfAborted();
            const parsed = def.inputSchema.parse(args);
            const output = await def.execute(parsed, { abortSignal: signal, toolCallId: id });
            signal?.throwIfAborted();
            const parts = def.toModelOutput?.(output, parsed);
            const content = parts?.length ? parts.map(p => p.type === "text" ? p : { type: "image" as const, data: p.data, mimeType: p.mediaType }) : [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output ?? null) }];
            return { content, details: output };
          },
        })),
      },
      toolExecution: "sequential",
      streamFn: streamProvider,
      prepareRequest: async ({context},signal)=>{
        const bounded={...context,messages:capContextImages(context.messages)};
        activeContext=bounded;
        const compacted=await compactContext(bounded,signal);
        const chosen=compacted??bounded;
        await emit({type:'context-usage',tokens:requestContextTokens(chosen.messages,model),contextWindow:model.contextWindow,outputReserve:OUTPUT_RESERVE_TOKENS,estimated:true,model:model.id});
        if(compacted){activeContext=compacted;return {context:compacted};}
        return {context:bounded};
      },
      finishTurn: () => ++steps >= (opts.maxSteps ?? 50) ? { action: "end" } : undefined,
    });
    this.pi = pi;
    const emit = async (event: RuntimeEvent) => { for (const listener of this.listeners) await listener(event); queue.push(event); };
    const unsubscribe = pi.subscribe(async event => {
      if (event.type === "turn_start") await emit({ type: "start-step" });
      if (event.type === "message_update") {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") await emit({ type: "text-delta", text: e.delta });
        if (e.type === "thinking_start") await emit({ type: "reasoning-start" });
        if (e.type === "thinking_delta") await emit({ type: "reasoning-delta", text: e.delta });
        if (e.type === "thinking_end") await emit({ type: "reasoning-end" });
      }
      if (event.type === "tool_execution_start") await emit({ type: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, input: event.args });
      if (event.type === "tool_execution_end") await emit({ type: event.isError ? "tool-error" : "tool-result", toolCallId: event.toolCallId, toolName: event.toolName, output: event.result.details ?? event.result, error: event.isError ? event.result.content.filter((p:{type:string})=>p.type==="text").map((p:{text?:string})=>p.text).join("\n") : undefined });
      if (event.type === "message_end") completedMessages.push(event.message);
      if(event.type==='message_end'&&event.message.role==='assistant'&&event.message.stopReason!=='error'){
        const usage=event.message.usage;
        const tokens=usage.input+usage.cacheRead+usage.cacheWrite+usage.output;
        if(tokens>0)await emit({type:'context-usage',tokens,contextWindow:model.contextWindow,outputReserve:OUTPUT_RESERVE_TOKENS,estimated:false,model:model.id});
      }
      if (event.type === "message_end") await emit({ type: "message-end", messages: fromPiMessages([event.message]) });
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") await emit({ type: "error", error: event.message.errorMessage ?? "Provider stream failed" });
    });
    const abort = () => pi.abort();
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    const completed = pi.continue().catch(async error => { await emit({ type: "error", error: error instanceof Error ? error.message : String(error) }); }).finally(() => {
      unsubscribe(); input.abortSignal?.removeEventListener("abort", abort); queue.close();
    });
    return {
      fullStream: queue,
      response: completed.then(() => ({ messages: fromPiMessages(completedMessages), modelContext: fromPiMessages(this.modelMessages, true) })),
      usage: completed.then(() => {
        const u = [...completedMessages,...summaryUsage].filter((m): m is AssistantMessage => m.role === "assistant").reduce((sum, m) => ({ input: sum.input + m.usage.input + m.usage.cacheRead + m.usage.cacheWrite, output: sum.output + m.usage.output, cacheRead: sum.cacheRead + m.usage.cacheRead, reasoning: sum.reasoning + (m.usage.reasoning ?? 0) }), { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
        return { inputTokens: u.input, outputTokens: u.output, inputTokensDetails: { cacheReadTokens: u.cacheRead }, outputTokensDetails: { reasoningTokens: u.reasoning } };
      }),
    };
  }
}
export function createAgent(opts: CreateAgentOpts): AgentBundle {
  return { agent: new PageAgentRuntime(opts), tools: Object.fromEntries(opts.tools.map(t => [t.name, t])) };
}
