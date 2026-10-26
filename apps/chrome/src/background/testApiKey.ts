import { testHosted } from "./hosted";
import { normalizeProviderBaseUrl } from "@xgoose/core";
// Provider API-key validator. Powers the "Test" button on the options page.
//
// We deliberately hit a *list-models* endpoint instead of a chat completion
// because:
//   1. It's free (most providers don't charge for catalogue calls).
//   2. It returns structured JSON we can sanity-check, so a 200 from a captive
//      portal or misconfigured proxy can be told apart from a real provider.
//   3. It's the same shape we'd use to populate model dropdowns later, so the
//      logic is reusable.
//
// Lives in its own file (mirroring `fetchProxy.ts`) so `background/index.ts`
// stays a thin router.

import type { MessageMap } from "@/shared/messages";

const DEFAULT_TIMEOUT_MS = 12_000;

/** One-shot API-key validation. See the `sw:test_api_key` envelope docs in
 *  `shared/messages.ts` for the per-provider routing. */
export async function testApiKey(
  req: MessageMap["sw:test_api_key"]["request"],
): Promise<MessageMap["sw:test_api_key"]["response"]> {
  const apiKey = (req.apiKey ?? "").trim();
  const baseUrl = (req.baseUrl ?? "").trim();

  if (req.provider === "xgoose-hosted") return testHosted(req.model);

  if (!apiKey) {
    return { ok: false, error: "API key is empty." };
  }

  if (req.provider === "gemini") {
    const url = `${normalizeProviderBaseUrl(req.provider, baseUrl)}/models`;
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
    });
    return summarize(res, "Gemini");
  }

  if (req.provider === "gemini-litellm") {
    if (!baseUrl) {
      return {
        ok: false,
        error: "Base URL is required for the LiteLLM-Gemini proxy.",
      };
    }
    const url = `${normalizeProviderBaseUrl(req.provider, baseUrl)}/models`;
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
    });
    return summarize(res, "LiteLLM (Gemini)");
  }

  if (req.provider === "openai-compat") {
    // Same normalisation as `createModel` in @xgoose/core so the test hits
    // the same URL the agent would later POST to.
    const root = normalizeProviderBaseUrl(req.provider, baseUrl);
    const url = `${root}/models`;
    const res = await safeFetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    return summarize(res, "OpenAI-compatible");
  }

  // Provider is typed but exhaustiveness assertion would force the
  // file to know the union; just bail with a clear message.
  return {
    ok: false,
    error: `Unknown provider: ${String((req as { provider: unknown }).provider)}`,
  };
}

type FetchOutcome =
  | { kind: "response"; res: Response }
  | { kind: "error"; error: string };

async function safeFetch(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchOutcome> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    return { kind: "response", res };
  } catch (err: any) {
    const msg = err?.name === "AbortError"
      ? `Request timed out after ${Math.round(timeoutMs / 1000)}s`
      : err?.message ?? String(err);
    return { kind: "error", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function summarize(
  outcome: FetchOutcome,
  label: string,
): Promise<MessageMap["sw:test_api_key"]["response"]> {
  if (outcome.kind === "error") {
    return { ok: false, error: outcome.error };
  }
  const { res } = outcome;
  const body = await res.text().catch(() => "");
  if (res.ok) {
    const modelCount = extractModelCount(body);
    const suffix =
      modelCount != null
        ? ` ${modelCount} model${modelCount === 1 ? "" : "s"} available.`
        : "";
    return {
      ok: true,
      message: `Connected to ${label}.${suffix}`,
      modelCount,
    };
  }
  const reason = extractError(body) || `HTTP ${res.status} ${res.statusText}`.trim();
  return { ok: false, error: `${label}: ${reason}` };
}

function extractModelCount(body: string): number | null {
  try {
    const j = JSON.parse(body);
    // Gemini: { models: [...] }   OpenAI-compat: { data: [...] }
    if (Array.isArray(j?.models)) return j.models.length;
    if (Array.isArray(j?.data)) return j.data.length;
  } catch {
    /* fall through — non-JSON body */
  }
  return null;
}

function extractError(body: string): string {
  try {
    const j = JSON.parse(body);
    return (
      j?.error?.message ||
      j?.message ||
      (typeof j?.error === "string" ? j.error : "") ||
      ""
    );
  } catch {
    return body.slice(0, 200);
  }
}
