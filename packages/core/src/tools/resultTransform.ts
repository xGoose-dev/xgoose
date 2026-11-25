import { search } from "@jmespath-community/jmespath";
import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "./buildTool";

export function createResultTransformTool(): XgooseBuiltTool {
  return defineTool({
    name: "result_transform",
    description: "Transform complete results from earlier tool calls locally using JMESPath. Bind each result ID to a name in sources and reference it in the expression. For example, {sources:{thread:'<result ID>'}, expression:'{count: length(thread.posts), authors: thread.posts[].username}'}. Use this to select, filter, sort, combine or aggregate data without repeating source calls. Call with {} to list result IDs, or pass only an expression to filter or slice that list.",
    inputSchema: z.object({
      sources: z.record(z.string().min(1)).optional().describe("Names mapped to the result IDs printed by earlier tool calls."),
      expression: z.string().trim().min(1).max(4000).default("@").describe("JMESPath expression over the named sources, or the result list when sources is omitted."),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: input => input.sources ? "Transformed tool results" : "Listed tool results",
    execute: ({ sources, expression }, { results }) => {
      if (!results) throw new Error("Tool result history is unavailable.");
      const input = sources
        ? Object.fromEntries(Object.entries(sources).map(([name, id]) => [name, results.read(id)]))
        : results.list();
      return search(input, expression) ?? null;
    },
  });
}
