import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple as openai } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as google } from "@earendil-works/pi-ai/api/google-generative-ai";
import type { AssistantMessage, Model, Api } from "@earendil-works/pi-ai";
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
  maxSteps?: number;
  /** Injectable provider stream for deterministic acceptance tests. */
  streamFn?: StreamFn;
}
export type AgentBundle = { agent: PageAgentRuntime; tools: Record<string, XgooseBuiltTool> };
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

export function toPiMessages(messages: ChatMessage[], model: Model<Api>): AgentMessage[] {
  return messages.flatMap((m): AgentMessage[] => {
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
    if (m.role === "user") return [{ role: "user", content, timestamp: m.timestamp ?? Date.now() }];
    if (m.role === "system") return [{ role: "system", content: typeof m.content === "string" ? m.content : content.map((p: any) => p.text ?? "").join("\n") } as AgentMessage];
    if (m.role === "assistant") return [{ role: "assistant", content: content.map((p: any) => p.type === "tool-call" ? { type: "toolCall", id: p.toolCallId, name: p.toolName, arguments: p.input } : p.type === "reasoning" ? { type: "thinking", thinking: p.text } : p), api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: "stop", timestamp: m.timestamp ?? Date.now() } as AssistantMessage];
    if (m.role === "tool") return content.map((p: any) => ({ role: "toolResult", toolCallId: p.toolCallId, toolName: p.toolName, content: [{ type: "text", text: typeof p.output?.value === "string" ? p.output.value : JSON.stringify(p.output?.value ?? p.output ?? null) }], isError: p.output?.type === "error-text", timestamp: m.timestamp ?? Date.now() }));
    return [];
  });
}
export function fromPiMessages(messages: AgentMessage[]): ChatMessage[] {
  return messages.flatMap((m): ChatMessage[] => {
    if (m.role === "assistant") return [{ role: "assistant", content: m.content.map(p => p.type === "toolCall" ? { type: "tool-call", toolCallId: p.id, toolName: p.name, input: p.arguments } : p.type === "thinking" ? { type: "reasoning", text: p.thinking } : p) }];
    if (m.role === "toolResult") return [{ role: "tool", content: [{ type: "tool-result", toolCallId: m.toolCallId, toolName: m.toolName, output: { type: m.isError ? "error-text" : "json", value: m.details ?? m.content.map(p => p.type === "text" ? p.text : "[image]").join("\n") } }] }];
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
  private listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  constructor(private opts: CreateAgentOpts) {}
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  stop() { this.pi?.abort(); }
  snapshot(): RuntimeSnapshot { return { messages: fromPiMessages(this.pi?.state.messages ?? []), running: this.pi?.state.isStreaming ?? false, error: this.pi?.state.errorMessage }; }
  async stream(input: { messages: ChatMessage[]; abortSignal?: AbortSignal }) {
    if (this.pi?.signal) throw new Error("This runtime already has an active run");
    input.abortSignal?.throwIfAborted();
    const opts = this.opts, model = createModel(opts.settings), queue = new EventQueue();
    const history = toPiMessages(input.messages, model);
    let steps = 0;
    const pi = new Agent({
      initialState: {
        model, systemPrompt: buildSystemPrompt(opts.reminder ?? null), messages: history,
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
      streamFn: opts.streamFn ?? ((m, context, options) => {
        const requestOptions = { ...options, apiKey: opts.settings.apiKey, fetch: opts.fetchImpl, maxRetries: 0, maxTokens: 4096 };
        return m.api === "google-generative-ai" ? google(m as any, context, requestOptions) : openai(m as any, context, requestOptions);
      }),
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
      if (event.type === "tool_execution_end") await emit({ type: event.isError ? "tool-error" : "tool-result", toolCallId: event.toolCallId, toolName: event.toolName, output: event.result.details ?? event.result, error: event.isError ? event.result.content : undefined });
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") await emit({ type: "error", error: event.message.errorMessage ?? "Provider stream failed" });
    });
    const abort = () => pi.abort();
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    const completed = pi.continue().catch(async error => { await emit({ type: "error", error: error instanceof Error ? error.message : String(error) }); }).finally(() => {
      unsubscribe(); input.abortSignal?.removeEventListener("abort", abort); queue.close();
    });
    return {
      fullStream: queue,
      response: completed.then(() => ({ messages: fromPiMessages(pi.state.messages.slice(history.length)) })),
      usage: completed.then(() => {
        const u = pi.state.messages.slice(history.length).filter((m): m is AssistantMessage => m.role === "assistant").reduce((sum, m) => ({ input: sum.input + m.usage.input + m.usage.cacheRead + m.usage.cacheWrite, output: sum.output + m.usage.output, cacheRead: sum.cacheRead + m.usage.cacheRead, reasoning: sum.reasoning + (m.usage.reasoning ?? 0) }), { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
        return { inputTokens: u.input, outputTokens: u.output, inputTokensDetails: { cacheReadTokens: u.cacheRead }, outputTokensDetails: { reasoningTokens: u.reasoning } };
      }),
    };
  }
}
export function createAgent(opts: CreateAgentOpts): AgentBundle {
  return { agent: new PageAgentRuntime(opts), tools: Object.fromEntries(opts.tools.map(t => [t.name, t])) };
}
