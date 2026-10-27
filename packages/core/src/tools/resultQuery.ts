import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "./buildTool";
import { textBytes } from "../contextWindow";
import { resultBudgetBytes, storedResult } from "../resultStore";

function atPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<any>((node, key) => {
    if (node == null || typeof node !== "object" || !(key in node)) throw new Error(`Path segment "${key}" does not exist.`);
    return node[key];
  }, value);
}

function project(item: unknown, fields?: string[]): unknown {
  if (!fields?.length || !item || typeof item !== "object") return item;
  return Object.fromEntries(fields.map(field => [field, atPath(item, field)]));
}

export function createResultQueryTool(): XgooseBuiltTool {
  return defineTool({
    name: "result_query",
    description:
      "Query a stored oversized tool result by its resultId. `path` selects a nested value (dot path, e.g. `posts`); arrays are filtered by `match` (case-insensitive regex over each item's JSON), projected to `fields` and paged with offset/limit. Without an array at `path` it returns that value.",
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
      const target = atPath(storedResult(id), path);
      if (!Array.isArray(target)) return { id, path, value: target };
      const pattern = match ? new RegExp(match, "i") : null;
      const matched = pattern ? target.filter(item => pattern.test(JSON.stringify(item))) : target;
      const items: unknown[] = [];
      let bytes = 0, next = offset;
      for (; next < matched.length && items.length < limit; next++) {
        const item = project(matched[next], fields);
        bytes += textBytes(JSON.stringify(item));
        if (items.length && bytes > resultBudgetBytes() / 2) break;
        items.push(item);
      }
      return { id, path, total: target.length, matched: matched.length, offset, items, next_offset: next < matched.length ? next : null };
    },
  });
}
