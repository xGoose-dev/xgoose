import type { XgooseBuiltTool } from "@xgoose/core";
import { createPageInfoTool } from "./pageInfo";
import { createReadPageTool } from "./readPage";
import { createReadPageSemanticTool } from "./readPageSemantic";
import { createJsExecTool, type JsExecToolDeps } from "./jsExec";
import { createConsoleLogsTool } from "./consoleLogs";
import {
  createNetworkRequestsTool,
  createNetworkRequestTool,
  type NetworkRequestToolDeps,
} from "./networkRequests";

export { createPageInfoTool, createReadPageTool, createReadPageSemanticTool };
export { createJsExecTool, type JsExecToolDeps };
export { createConsoleLogsTool };
export {
  createNetworkRequestsTool,
  createNetworkRequestTool,
  type NetworkRequestToolDeps,
  type NetworkRequestRedactionConfig,
} from "./networkRequests";

export type PageControllerToolDeps = JsExecToolDeps & NetworkRequestToolDeps;

/**
 * Build the seven page-controller tools (`page_info`, `read_page`,
 * `read_page_semantic`, `js_exec`, `console_logs`, `network_requests`,
 * `network_request`) in one shot. Hosts compose this with
 * `buildCoreTools(...)` from `@xgoose/core` and any host-specific tools
 * into the final tool array passed to `createAgent`.
 */
export function buildPageControllerTools(
  deps: PageControllerToolDeps,
): XgooseBuiltTool[] {
  return [
    createPageInfoTool(),
    createReadPageTool(),
    createReadPageSemanticTool(),
    createJsExecTool(deps),
    createConsoleLogsTool(),
    createNetworkRequestsTool(),
    createNetworkRequestTool(deps),
  ];
}
