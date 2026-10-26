// Public entry point for `@xgoose/ui`. Hosts wire the panel like this:
//
//   import { createPanel, registerToolLabels } from '@xgoose/ui';
//
//   // Optional: register labels for host-specific tools.
//   registerToolLabels({
//     skill_call: { icon: '🪄', iconClass: 'code', label: 'Call skill', ... },
//   });
//
//   const panel = createPanel();
//
// `createPanel` mounts a shadow-DOM floating button + chat panel on
// `document.body`. Everything inside the shadow root is isolated from
// the page's styles.

export { createPanel } from "./panel";
export type {
  Panel,
  PanelTheme,
  CreatePanelOpts,
  ToolCardHandle,
  ReasoningBlockHandle,
  AssistantBubbleHandle,
  HistoryItem,
  TodoUiStatus,
  TodoUiItem,
} from "./panel";

export {
  describeToolCall,
  summarizeToolResult,
  registerToolLabels,
  type ToolDescription,
  type ToolLabelEntry,
} from "./toolLabels";

export { renderMarkdown } from "./markdown";

export { DEFAULT_LAYOUT, type Corner, type Layout } from "./layout";

export type {ImageAttachment} from "./images";
