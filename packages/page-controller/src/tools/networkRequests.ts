import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "@xgoose/core";
import { callBridge } from "../pageRpc";

export function createNetworkRequestsTool(): XgooseBuiltTool {
  return defineTool({
    name: "network_requests",
    description:
      "Return a list of recent network requests captured from the page MAIN world (both fetch and XHR). Each entry has id, ts, method, url, status, durationMs, resSizeBytes. Use `network_request` to fetch the detail (headers/body) of a specific id.",
    inputSchema: z.object({
      since: z.number().optional(),
      filter: z
        .string()
        .optional()
        .describe("Regex (case-insensitive) matched against the URL."),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: () => "Read recent network requests",
    execute: async ({ since, filter, limit }) => {
      return await callBridge("networkRequests", { since, filter, limit });
    },
  });
}

export type NetworkRequestRedactionConfig = {
  redactSensitiveHeaders: boolean;
  /** Lower-case header names to redact when `redactSensitiveHeaders` is true. */
  redactSensitiveHeaderKeys: string[];
};

export type NetworkRequestToolDeps = {
  getRedactionConfig(): NetworkRequestRedactionConfig;
};

export function createNetworkRequestTool(
  deps: NetworkRequestToolDeps,
): XgooseBuiltTool {
  return defineTool({
    name: "network_request",
    description:
      "Return details for a specific network entry id (from `network_requests`). part=headers returns request+response headers (with sensitive ones redacted by default); part=body returns the captured request body; part=response returns the captured response body slice.",
    inputSchema: z.object({
      id: z.string(),
      part: z.enum(["headers", "body", "response"]),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: (i) => `Read network ${i?.part ?? "detail"} ${i?.id ?? ""}`.trim(),
    execute: async ({ id, part }) => {
      const raw = (await callBridge("networkRequestDetail", {
        id,
        part,
      })) as any;
      if (!raw || part !== "headers") return raw;
      const cfg = deps.getRedactionConfig();
      if (!cfg.redactSensitiveHeaders) return raw;
      const lower = new Set(
        cfg.redactSensitiveHeaderKeys.map((k) => k.toLowerCase()),
      );
      const redact = (
        obj: Record<string, string> | undefined,
      ): Record<string, string> | undefined => {
        if (!obj) return obj;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
          out[k] = lower.has(k.toLowerCase()) ? "[REDACTED]" : v;
        }
        return out;
      };
      return { req: redact(raw.req), res: redact(raw.res) };
    },
  });
}
