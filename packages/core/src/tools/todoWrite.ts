import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "./buildTool";
import { recordTodos } from "../todoStore";
import type { TodoItem } from "../types";

/**
 * `todo_write` is pure relative to the host: it just mutates the in-memory
 * todo store the system-reminder builder reads from. No host port needed.
 */
export function createTodoWriteTool(): XgooseBuiltTool {
  return defineTool({
    name: "todo_write",
    description:
      "Replace the current todo list. Use for any task that takes 3+ distinct steps. Exactly one item should be in_progress at a time; mark items completed immediately after finishing.",
    inputSchema: z.object({
      todos: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          activeForm: z.string(),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      ),
    }),
    isReadOnly: false,
    isConcurrencySafe: () => false,
    label: (i) => `Updated ${i?.todos?.length ?? 0}-item todo list`,
    execute: async ({ todos }) => {
      recordTodos(todos as TodoItem[]);
      return { ok: true, count: todos.length };
    },
  });
}
