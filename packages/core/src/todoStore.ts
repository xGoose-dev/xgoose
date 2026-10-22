// Per-conversation in-memory todo store. The agent reads/writes via the
// `todo_write` tool; the reminder builder reads from `getTodos()`; and the
// shadow-DOM panel subscribes via `subscribeTodos()` so the dedicated
// Todos UI updates the instant the agent changes the list.

import type { TodoItem } from "./types";

type Listener = (todos: TodoItem[]) => void;

let todos: TodoItem[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  // Hand listeners a shallow copy so they can't mutate the canonical list
  // out from under us (the panel for instance maps over it to render).
  const snapshot = todos.slice();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch (err) {
      console.warn("[xgoose] todo listener threw", err);
    }
  }
}

export function getTodos(): TodoItem[] {
  return todos;
}

export function recordTodos(next: TodoItem[]): void {
  todos = next;
  notify();
}

export function clearTodos(): void {
  todos = [];
  notify();
}

/**
 * Register a listener invoked on every `recordTodos` / `clearTodos`. Returns
 * an `unsubscribe` callback. Listeners receive a copy of the current list,
 * so they can render it directly without defensive cloning.
 */
export function subscribeTodos(listener: Listener): () => void {
  listeners.add(listener);
  // Fire once immediately so newly-mounted UIs render the current state
  // without waiting for the next mutation.
  try {
    listener(todos.slice());
  } catch (err) {
    console.warn("[xgoose] todo listener threw on subscribe", err);
  }
  return () => {
    listeners.delete(listener);
  };
}
