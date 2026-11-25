import type { z } from "zod";
import type { ToolResultStore } from "../resultStore";

export type XgooseToolContentPart =
  | { type: "text"; text: string }
  | { type: "file-data"; data: string; mediaType: string };

export type XgooseToolExecOptions = {
  /** AbortSignal owned by the agent run — fires when the user clicks Stop. */
  abortSignal?: AbortSignal;
  /** Tool-call id from the runtime, useful for cancellation bookkeeping. */
  toolCallId?: string;
  /** Full results available to tools that work with earlier calls. */
  results?: Pick<ToolResultStore, "read" | "list">;
};

export type XgooseToolDef<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: S;
  execute: (
    input: z.infer<S>,
    opts: XgooseToolExecOptions,
  ) => Promise<unknown> | unknown;
  isReadOnly?: boolean;
  isConcurrencySafe?: (input: z.infer<S>) => boolean;
  label?: (input: z.infer<S>) => string;
  /** Additional model attachments. The runtime renders the returned data itself. */
  resultAttachments?: (
    output: any,
    input: z.infer<S>,
  ) => XgooseToolContentPart[] | null;
};

export type XgooseToolMeta = {
  isConcurrencySafe: (input: any) => boolean;
  isReadOnly: boolean;
  label: (input: any) => string;
};

export type XgooseBuiltTool = {
  name: string;
  definition: XgooseToolDef<z.ZodTypeAny>;
  meta: XgooseToolMeta;
};

export function defineTool<S extends z.ZodTypeAny>(
  def: XgooseToolDef<S>,
): XgooseBuiltTool {
  return {
    name: def.name,
    definition: def as unknown as XgooseToolDef<z.ZodTypeAny>,
    meta: {
      isReadOnly: def.isReadOnly ?? false,
      isConcurrencySafe:
        (def.isConcurrencySafe as ((i: any) => boolean) | undefined) ??
        (() => false),
      label:
        (def.label as ((i: any) => string) | undefined) ?? (() => def.name),
    },
  };
}
