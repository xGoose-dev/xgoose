import { apiFetch, getAccount } from "@/shared/account";
import type { BugReportContext, BugReportSubmission } from "@/shared/bugReport";
import { redactTranscript } from "@/shared/redact";
import { deleteReportDraft, readReportDraft, readReportJournal, stageReportDraft } from "./sessionDb";
import { withHostedSession } from "./hostedSession";
import { isSafari } from "@/shared/host";

const pageUrl = () => chrome.runtime.getURL("bug-report.html");
const expired = "This report draft expired. Open Report a bug again from the chat.";

function assertReportPage(sender: chrome.runtime.MessageSender): void {
  if (sender.url?.split("#", 1)[0] !== pageUrl()) {
    throw new Error("Open the report from the extension.");
  }
}

export async function openBugReport(context: BugReportContext, sender: chrome.runtime.MessageSender) {
  const url = new URL(sender.url ?? sender.tab?.url ?? chrome.runtime.getURL("/"));
  const hostname = /^https?:$/.test(url.protocol) ? url.hostname : undefined;
  await stageReportDraft({ ...context, hostname, expiresAt: Date.now() + 3_600_000 });
  try {
    await chrome.tabs.create({ url: `${pageUrl()}#${context.id}` });
  } catch (error) {
    await deleteReportDraft(context.id);
    throw error;
  }
}

export async function getBugReport(id: string, sender: chrome.runtime.MessageSender) {
  assertReportPage(sender);
  const draft = await readReportDraft(id);
  if (!draft) throw new Error(expired);
  return { interrupted: draft.kind === "interrupted", hasTranscript: !!draft.sessionId };
}

export async function discardBugReport(id: string, sender: chrome.runtime.MessageSender) {
  assertReportPage(sender);
  await deleteReportDraft(id);
}

export async function sendBugReport(submission: BugReportSubmission, sender: chrome.runtime.MessageSender) {
  assertReportPage(sender);
  const draft = await readReportDraft(submission.id);
  if (!draft) throw new Error(expired);
  const account = await getAccount();
  const { description, screenshot, includeTranscript } = submission;
  const { id, kind, sessionId, runId, provider, model, failure, state, viewport, hostname } = draft;
  const journal = includeTranscript && sessionId
    ? await readReportJournal(sessionId, draft.capturedAt).catch(error => {
        console.warn("[xgoose] local report journal could not be read", error);
        return { events: [], omittedEvents: 0, journalUnavailable: true };
      })
    : { events: [], omittedEvents: 0 };
  const failureText = includeTranscript && failure ? failure : kind === "interrupted" ? "Agent turn interrupted." : undefined;
  const body = JSON.stringify({
    id, kind, description: (redactTranscript(description) as string).slice(0, 1000), screenshot, hostname,
    client: isSafari ? "safari" : "chromium",
    version: chrome.runtime.getManifest().version,
    diagnostics: {
      provider: (redactTranscript(provider) as string).slice(0, 100),
      model: (redactTranscript(model) as string).slice(0, 200),
      failure: failureText && (redactTranscript(failureText) as string).slice(0, 1500),
      sessionId: includeTranscript ? sessionId : undefined,
      runId: includeTranscript ? runId : undefined,
      state, viewport, userAgent: navigator.userAgent.slice(0, 400),
      messages: includeTranscript ? draft.messages : [],
      omittedMessages: includeTranscript ? draft.omittedMessages : 0,
      ...journal,
    },
  });
  const submit = (bearer?: string) => apiFetch<{ id: string }>("/bug-reports", { method: "POST", body, bearer });
  const result = account
    ? await withHostedSession(a => submit(a.accessToken), { accountId: account.user.id })
    : await submit();
  if (!result.ok) throw new Error(result.error);
  if (result.data?.id !== id) throw new Error("Could not send the report. Try again.");
  // Keep the draft until Done so a lost browser message can retry the same report ID.
  return { id };
}
