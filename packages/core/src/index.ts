// Public entry point for `@xgoose/core`. Hosts (xgoose-safari today,
// xgoose-extension-chrome / xgoose-firefox in the future) import everything they need
// from here:
//
//   import {
//     createAgent,
//     buildSystemReminder,
//     buildCoreTools,
//     buildProviderFetch,
//     type CoreSettings,
//   } from '@xgoose/core';
//
// The browser-only DOM tools live in `@xgoose/page-controller`; the shadow-
// DOM chat panel lives in `@xgoose/ui`.

export {
  createAgent,
  type AgentBundle,
  type CreateAgentOpts,
} from "./createAgent";
export {
  buildSystemPrompt,
  buildSystemReminder,
  type SystemReminderOpts,
} from "./systemPrompt";
export {
  createModel,
  normalizeProviderBaseUrl,
  providerOptionsFor,
  DEFAULT_MODEL_BY_PROVIDER,
  KNOWN_MODELS,
} from "./model";
export {
  buildProviderFetch,
  type ProviderFetchTransport,
  type StreamingHandle,
  type NonStreamingResponse,
  type HeaderBag,
} from "./providerFetch";

export {
  costsFor,
  priceTurn,
  type ModelCosts,
  type PriceableTurn,
} from "./pricing";

export { getTodos, recordTodos, clearTodos, subscribeTodos } from "./todoStore";

export {
  defineTool,
  buildCoreTools,
  createTodoWriteTool,
  createRememberTool,
  createForgetTool,
  type XgooseBuiltTool,
  type XgooseToolDef,
  type XgooseToolMeta,
  type XgooseToolExecOptions,
  type XgooseToolContentPart,
  type MemoryToolDeps,
} from "./tools";

export type {
  Provider,
  CoreSettings,
  TodoItem,
  ConversationUsage,
  SkillRef,
  SkillFnSummary,
} from "./types";
export { ProviderSchema, EMPTY_USAGE } from "./types";

export type {
  HostFetcher,
  MemoryPort,
  SettingsPort,
  OriginPort,
  SkillContext,
} from "./ports";
export { NoSkillContext } from "./ports";
export {websiteEvidence} from './websiteEvidence';
