import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "@xgoose/core";

/**
 * Cheap snapshot of the current page — URL, title, viewport, lang,
 * readyState. Pure isolated-world DOM read; no bridge round-trip needed.
 */
export function createPageInfoTool(): XgooseBuiltTool {
  return defineTool({
    name: "page_info",
    description:
      "Get the current page URL, title, viewport, readyState, and lang. Cheap; always concurrency-safe.",
    inputSchema: z.object({}),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: () => "Read page info",
    execute: async () => ({
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      lang: document.documentElement.lang || null,
      readyState: document.readyState,
    }),
  });
}
