import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "./buildTool";
import type { MemoryPort, OriginPort } from "../ports";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export type MemoryToolDeps = {
  memory: MemoryPort;
  origin: OriginPort;
};

export function createRememberTool({
  memory,
  origin,
}: MemoryToolDeps): XgooseBuiltTool {
  return defineTool({
    name: "remember",
    description:
      "Save a durable note (≤ 500 chars) for the current page's origin. Persists across sessions and is shown to you on every future turn while the user is on the same origin. Use for user preferences, site quirks, or anything genuinely worth remembering. Skip transient trivia.",
    inputSchema: z.object({
      note: z.string().min(1).max(500),
    }),
    isReadOnly: false,
    isConcurrencySafe: () => false,
    label: (i) => `Remembered "${truncate(String(i?.note ?? ""), 40)}"`,
    execute: async ({ note }) => {
      const o = origin.getCurrentOrigin();
      if (!o)
        return { ok: false, error: "No recognizable origin for this page." };
      const updated = await memory.appendMemoryForOrigin(o, note);
      return { ok: true, origin: o, memory: updated };
    },
  });
}

export function createForgetTool({
  memory,
  origin,
}: MemoryToolDeps): XgooseBuiltTool {
  return defineTool({
    name: "forget",
    description:
      "Clear all saved memory for the current page's origin. Use sparingly — only when existing memory is wrong or stale and you want to start fresh.",
    inputSchema: z.object({}),
    isReadOnly: false,
    isConcurrencySafe: () => false,
    label: () => "Forgot site memory",
    execute: async () => {
      const o = origin.getCurrentOrigin();
      if (!o)
        return { ok: false, error: "No recognizable origin for this page." };
      await memory.clearMemoryForOrigin(o);
      return { ok: true, origin: o };
    },
  });
}
