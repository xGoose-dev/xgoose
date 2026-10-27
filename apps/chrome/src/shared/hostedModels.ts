/** Persist this choice, rather than the current server model, to follow future defaults. */
export const HOSTED_DEFAULT_CHOICE = "default";
export const HOSTED_FALLBACK_MODEL = "deepseek-flash";

export interface HostedModelCatalogue {
  models: string[];
  defaultModel?: string;
  contextWindows?: Record<string, number>;
}

export function parseHostedModelCatalogue(payload: unknown): HostedModelCatalogue {
  const body = payload as {default_model?: unknown; data?: Array<{id?: unknown; context_window?: unknown}>} | null;
  const data = Array.isArray(body?.data) ? body.data : [];
  const models = [...new Set(data.flatMap(m => typeof m?.id === "string" && m.id ? [m.id] : []))].sort();
  const defaultModel = typeof body?.default_model === "string" && models.includes(body.default_model)
    ? body.default_model : undefined;
  const contextWindows = Object.fromEntries(data.flatMap(m => typeof m?.id === "string"
    && typeof m.context_window === "number" && Number.isSafeInteger(m.context_window)
    && m.context_window >= 8192 && m.context_window <= 16_000_000 ? [[m.id, m.context_window]] : []));
  return {models, ...(defaultModel ? {defaultModel} : {}), contextWindows};
}

/** Resolve once per turn. A specific saved model always wins over the server default. */
export function resolveHostedModel(choice: string | undefined, catalogue?: HostedModelCatalogue | null): string {
  if (choice && choice !== HOSTED_DEFAULT_CHOICE) return choice;
  if (catalogue?.defaultModel && catalogue.models.includes(catalogue.defaultModel)) return catalogue.defaultModel;
  if (catalogue?.models.includes(HOSTED_FALLBACK_MODEL)) return HOSTED_FALLBACK_MODEL;
  return catalogue?.models[0] ?? HOSTED_FALLBACK_MODEL;
}

export function hostedModelLabel(id: string): string {
  return id === "deepseek-flash" ? "DeepSeek Flash" : id === "deepseek-purge" ? "DeepSeek Purge (experimental)" : id;
}
