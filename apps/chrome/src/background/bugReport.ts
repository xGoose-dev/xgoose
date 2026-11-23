import { apiFetch, getAccount } from "@/shared/account";
import type { BugReportRequest } from "@/shared/bugReport";
import { redactTranscript } from "@/shared/redact";
import { readReportJournal } from "./sessionDb";
import { withHostedSession } from "./hostedSession";
import { isSafari } from "@/shared/host";

export async function sendBugReport(request: BugReportRequest, sender: chrome.runtime.MessageSender) {
  const account = await getAccount();
  const journal = request.includeTranscript && request.sessionId
    ? await readReportJournal(request.sessionId, request.capturedAt).catch(error => {
        console.warn("[xgoose] local report journal could not be read", error);
        return { events: [], omittedEvents: 0, journalUnavailable: true };
      })
    : { events: [], omittedEvents: 0 };
  const url = new URL(sender.url ?? sender.tab?.url ?? chrome.runtime.getURL("/"));
  const hostname = /^https?:$/.test(url.protocol) ? url.hostname : undefined;
  const { id, kind, description, screenshot, includeTranscript, sessionId, runId, provider, model, failure, state, viewport } = request;
  const body = JSON.stringify({
    id, kind, description: (redactTranscript(description) as string).slice(0, 1000), screenshot, hostname,
    client: isSafari ? "safari" : "chromium",
    version: chrome.runtime.getManifest().version,
    diagnostics: {
      provider: (redactTranscript(provider) as string).slice(0, 100),
      model: (redactTranscript(model) as string).slice(0, 200),
      failure: failure && (redactTranscript(failure) as string).slice(0, 1500),
      sessionId: includeTranscript ? sessionId : undefined,
      runId: includeTranscript ? runId : undefined,
      state, viewport, userAgent: navigator.userAgent.slice(0, 400),
      messages: includeTranscript ? request.messages : [],
      omittedMessages: includeTranscript ? request.omittedMessages : 0,
      ...journal,
    },
  });
  const submit = (bearer?: string) => apiFetch<{ id: string }>("/bug-reports", { method: "POST", body, bearer });
  const result = account
    ? await withHostedSession(a => submit(a.accessToken), { accountId: account.user.id })
    : await submit();
  if (!result.ok) throw new Error(result.error);
  if (result.data?.id !== id) throw new Error("Could not send the report. Try again.");
  return { id };
}
