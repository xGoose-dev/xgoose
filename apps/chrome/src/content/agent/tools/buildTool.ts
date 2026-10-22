// Thin shim — the `defineTool` helper + `XgooseBuiltTool` shape live in
// `@xgoose/core`. Safari-specific tool factories (skill_call, list_skills,
// etc.) still call `defineTool` from here.
export {
  defineTool,
  type XgooseBuiltTool,
  type XgooseToolDef,
  type XgooseToolMeta,
  type XgooseToolExecOptions,
  type XgooseToolContentPart,
} from "@xgoose/core";
