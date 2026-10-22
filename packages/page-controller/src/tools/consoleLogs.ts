import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "@xgoose/core";
import { callBridge } from "../pageRpc";

export function createConsoleLogsTool(): XgooseBuiltTool {
  return defineTool({
    name: "console_logs",
    description:
      "Return a slice of the page MAIN-world console buffer (log/info/warn/error/debug). Useful for confirming a `js_exec` printed something or for debugging script errors.",
    inputSchema: z.object({
      since: z
        .number()
        .optional()
        .describe("Unix-ms timestamp; only entries newer than this."),
      levels: z
        .array(z.enum(["log", "info", "warn", "error", "debug"]))
        .optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: (i) => `Read ${i?.limit ?? 50} console entries`,
    execute: async ({ since, levels, limit }) => {
      return await callBridge("consoleLogs", { since, levels, limit });
    },
  });
}
