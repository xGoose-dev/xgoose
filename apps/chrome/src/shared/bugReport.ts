import { redactTranscript } from "./redact";

type DiagnosticEntry = Record<string, unknown>;

export type ReportRun = { runId: string; provider: string; model: string };

export type BugReportRequest = {
  id: string;
  kind: "manual" | "interrupted";
  description: string;
  screenshot?: { data: string };
  includeTranscript: boolean;
  capturedAt: number;
  sessionId?: string;
  runId?: string;
  provider: string;
  model: string;
  failure?: string;
  state: "idle" | "running" | "waiting" | "interrupted";
  viewport: string;
  messages: DiagnosticEntry[];
  omittedMessages: number;
};

export const CONTINUE_INTERRUPTED_TURN = "<system-reminder>Continue the interrupted user task from the saved conversation and tool results. Check the current state before taking action. If a prior action may have changed anything, verify its outcome before attempting it again.</system-reminder>";

let utf8: TextEncoder | undefined;
export const entryBytes = (value: DiagnosticEntry) => (utf8 ??= new TextEncoder()).encode(JSON.stringify(value)).byteLength + 1;

export function snapshotReportMessages(messages: readonly DiagnosticEntry[]) {
  let remaining = 560_000;
  const selected: DiagnosticEntry[] = [];
  // Preserve the latest context even when an old tool result is oversized.
  for (let index = messages.length - 1; index >= 0 && selected.length < 1000; index--) {
    const redacted = redactTranscript(messages[index]) as DiagnosticEntry;
    const size = entryBytes(redacted);
    if (size > remaining) continue;
    remaining -= size;
    selected.push(redacted);
    if (remaining < 100) break;
  }
  return { messages: selected.reverse(), omittedMessages: messages.length - selected.length };
}
