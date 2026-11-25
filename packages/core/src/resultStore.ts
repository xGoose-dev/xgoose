import {clipBytes,textBytes} from "./contextWindow";

const MAX_STORED_RESULTS = 20;
const stored = new Map<string, unknown>();
let budgetBytes = 400_000;

/** A single tool result may use about 15% of the model window (≈3 UTF-8 bytes per token). */
export function setResultBudget(contextWindowTokens: number): void {
  budgetBytes = Math.max(60_000, Math.floor(contextWindowTokens * 0.15 * 3));
}

export function resultBudgetBytes(): number {
  return budgetBytes;
}

export function storeResult(id: string, value: unknown): void {
  stored.delete(id);
  stored.set(id, value);
  while (stored.size > MAX_STORED_RESULTS) stored.delete(stored.keys().next().value!);
}

export function storedResult(id: string): unknown {
  if (!stored.has(id)) throw new Error(`No stored result "${id}". Use result_transform({}) to find available result IDs in this conversation.`);
  return stored.get(id);
}

export function clearStoredResults(): void {
  stored.clear();
}

export type ToolResultEntry = { resultId: string; toolName: string; value: unknown; isError: boolean };

/** Scoped to one run and seeded from that conversation's full transcript. */
export class ToolResultStore {
  private entries = new Map<string, ToolResultEntry>();
  private pageResults = new Map<string, unknown>();

  add(entry: ToolResultEntry): void {
    this.entries.set(entry.resultId, entry);
    const output = entry.value as { ok?: boolean; resultId?: string; result?: unknown } | null;
    if (entry.toolName === "js_exec" && output?.ok && typeof output.resultId === "string") {
      this.pageResults.set(output.resultId, output.result);
    }
  }

  get(id: string): ToolResultEntry | undefined {
    return this.entries.get(id);
  }

  read(id: string): unknown {
    const entry = this.get(id);
    if (entry) return entry.value;
    if (this.pageResults.has(id)) return this.pageResults.get(id);
    return storedResult(id);
  }

  list(): Omit<ToolResultEntry, "value">[] {
    return Array.from(this.entries.values(), ({ resultId, toolName, isError }) => ({ resultId, toolName, isError }));
  }
}

function shapeOf(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  if (depth > 1) return "object";
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
}

export function modelResultText(value: unknown, text: string, id: string, pageHandle = false): string {
  const bytes = textBytes(text);
  if (bytes <= budgetBytes) return text;
  return JSON.stringify({
    oversized: true,
    resultId: id,
    sizeBytes: bytes,
    shape: shapeOf(value),
    preview: clipBytes(text, Math.floor(budgetBytes / 4)),
    next: `Full result stored as "${id}". \`shape\` describes the stored value and \`preview\` is a clipped excerpt. ` +
      `Use result_transform with this ID for local transformations, or result_query to inspect specific fields.` +
      (pageHandle ? ` The page value is also available as xgoose.results["${id}"] inside js_exec.` : ""),
  });
}

/** Keep saved preview evidence when its full result is unavailable. */
export function withoutPreviewHandle(text: string, id?: string): string {
  const marker = `Result ID: ${JSON.stringify(id)}`;
  if (id && text === marker) return "";
  const evidence = id && text.endsWith(`\n${marker}`) ? text.slice(0, -marker.length - 1) : text;
  if (!evidence.startsWith('{"oversized":true,')) return evidence;
  const newline = evidence.indexOf("\n");
  const end = newline < 0 ? evidence.length : newline;
  try {
    const { resultId, next: _next, ...preview } = JSON.parse(evidence.slice(0, end));
    if (typeof resultId === "string" && typeof preview.preview === "string" && typeof preview.sizeBytes === "number") {
      return JSON.stringify(preview) + evidence.slice(end);
    }
  } catch {
    // A partial excerpt may no longer contain a complete preview envelope.
  }
  return evidence;
}

/** Handles results produced by host actions outside the agent tool loop. */
export function boundedModelText(value: unknown, text: string, opts: { id?: string; pageHandle?: boolean } = {}): string {
  const id = opts.id ?? Math.random().toString(36).slice(2, 10);
  const display = modelResultText(value, text, id, opts.pageHandle);
  if (display !== text) storeResult(id, value);
  return display;
}
