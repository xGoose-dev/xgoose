import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "./buildTool";
import { clipBytes, textBytes } from "../contextWindow";
import { resultBudgetBytes, storedResult } from "../resultStore";

const MISSING = Symbol("missing");

function lookup(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<any>((node, key) =>
    node !== MISSING && node != null && typeof node === "object" && key in node ? node[key] : MISSING, value);
}

function atPath(value: unknown, path: string): unknown {
  const found = lookup(value, path);
  if (found === MISSING) throw new Error(`Path "${path}" does not exist in the stored result.`);
  return found;
}

function project(item: unknown, fields?: string[]): unknown {
  if (!fields?.length || !item || typeof item !== "object") return item;
  return Object.fromEntries(fields.map(field => [field, lookup(item, field)]).filter(([, value]) => value !== MISSING));
}

function matcher(match: string): RegExp {
  try {
    return new RegExp(match, "i");
  } catch {
    return new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

/** Keeps a value whole when it fits, otherwise a clipped JSON rendering marked as truncated. */
function bounded(value: unknown, maxBytes: number): { value: unknown; truncated?: true } {
  const text = JSON.stringify(value) ?? "null";
  if (textBytes(text) <= maxBytes) return { value };
  return { value: clipBytes(text, maxBytes), truncated: true };
}

export function createResultQueryTool(): XgooseBuiltTool {
  return defineTool({
    name: "result_query",
    description:
      "Query a stored oversized tool result by its resultId. `path` selects a nested value (dot path, e.g. `posts`); arrays are filtered by `match` (case-insensitive regex over each item's JSON, or a literal if the regex is invalid), projected to `fields` (missing fields are omitted) and paged with offset/limit. Without an array at `path` it returns that value, clipped when it is too large.",
    inputSchema: z.object({
      id: z.string().min(1),
      path: z.string().default(""),
      match: z.string().optional(),
      fields: z.array(z.string().min(1)).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).default(200),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: (i) => `Queried result ${i?.id ?? ""}${i?.path ? `.${i.path}` : ""}`,
    execute: async ({ id, path, match, fields, offset, limit }) => {
      const pageBudget = Math.floor(resultBudgetBytes() / 2);
      const target = atPath(storedResult(id), path);
      if (!Array.isArray(target)) return { id, path, ...bounded(target, pageBudget) };
      const pattern = match ? matcher(match) : null;
      const matched = pattern ? target.filter(item => pattern.test(JSON.stringify(item) ?? "")) : target;
      const items: unknown[] = [];
      let bytes = 0, next = offset, clipped = false;
      for (; next < matched.length && items.length < limit; next++) {
        const item = project(matched[next], fields);
        const itemBytes = textBytes(JSON.stringify(item) ?? "null");
        if (bytes + itemBytes > pageBudget) {
          if (items.length) break;
          items.push(bounded(item, pageBudget).value);
          clipped = true;
          next++;
          break;
        }
        bytes += itemBytes;
        items.push(item);
      }
      return {
        id, path, total: target.length, matched: matched.length, offset, items,
        ...(clipped ? { item_truncated: true, hint: "The item was clipped; narrow it with `fields` or a deeper `path`." } : {}),
        next_offset: next < matched.length ? next : null,
      };
    },
  });
}
