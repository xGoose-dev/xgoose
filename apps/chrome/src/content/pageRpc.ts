// Re-exports from @xgoose/page-controller so skill tools can call into the
// MAIN-world bridge without depending on the page-controller package shape.
export {
  installBridgeLoader,
  ensurePageBridge,
  callBridge,
  isBridgeUnreachable,
  resetBridgeReadiness,
  listLoadedSkillNamespaces,
} from "@xgoose/page-controller";
