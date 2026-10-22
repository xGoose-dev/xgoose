// Public entry point for `@xgoose/page-controller`. Hosts wire up the
// content-script side like this:
//
//   import {
//     installBridgeLoader,
//     installPageExecutor,
//     ensurePageBridge,
//     callBridge,
//     buildPageControllerTools,
//   } from '@xgoose/page-controller';
//
//   installBridgeLoader(myExtensionBridgeLoader);
//   await ensurePageBridge();
//
//   const tools = buildPageControllerTools({
//     getDefaultTimeoutMs: () => settings.jsExecTimeoutMs,
//     getRedactionConfig: () => ({
//       redactSensitiveHeaders: settings.redactSensitiveHeaders,
//       redactSensitiveHeaderKeys: settings.redactSensitiveHeaderKeys,
//     }),
//   });
//
// The MAIN-world `pageBridge.js` itself is exposed at
// `@xgoose/page-controller/pageBridge` so the host's bundler can emit
// it as a separate IIFE that the host's manifest loads with
// `world: "MAIN"`.

export {
  installBridgeLoader,
  installPageExecutor,
  ensurePageBridge,
  callBridge,
  isBridgeUnreachable,
  resetBridgeReadiness,
  listLoadedSkillNamespaces,
} from "./pageRpc";

export type { BridgeLoader, BridgeInjectResult } from "./ports/BridgeLoader";

export {
  createPageInfoTool,
  createReadPageTool,
  createReadPageSemanticTool,
  createJsExecTool,
  createConsoleLogsTool,
  createNetworkRequestsTool,
  createNetworkRequestTool,
  buildPageControllerTools,
  type PageControllerToolDeps,
  type JsExecToolDeps,
  type NetworkRequestToolDeps,
  type NetworkRequestRedactionConfig,
} from "./tools";
