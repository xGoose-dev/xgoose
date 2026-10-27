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
  if (!stored.has(id)) throw new Error(`No stored result "${id}". Only the latest ${MAX_STORED_RESULTS} oversized results of the current conversation are kept.`);
  return stored.get(id);
}

export function clearStoredResults(): void {
  stored.clear();
}

function shapeOf(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  if (depth > 1) return "object";
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
}

/** Full text when it fits; otherwise the value is stored and the model gets its shape, a preview and a handle. */
export function boundedModelText(value: unknown, text: string, opts: { id?: string; pageHandle?: boolean } = {}): string {
  const bytes = textBytes(text);
  if (bytes <= budgetBytes) return text;
  const id = opts.id ?? Math.random().toString(36).slice(2, 10);
  storeResult(id, value);
  return JSON.stringify({
    oversized: true,
    resultId: id,
    sizeBytes: bytes,
    shape: shapeOf(value),
    preview: clipBytes(text, Math.floor(budgetBytes / 4)),
    next: `Full result stored as "${id}". \`shape\` lists the stored value's real paths; \`preview\` is a compact rendering whose keys may differ. ` +
      `Filter or page it with result_query({id:"${id}", path, match, fields, offset, limit})` +
      (opts.pageHandle ? `, or aggregate it in code via xgoose.results["${id}"] inside js_exec.` : "."),
  });
}
