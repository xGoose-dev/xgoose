import { z } from "zod";
import { boundedModelText, defineTool, detachResultImages, resultImageParts, storeResult, websiteEvidence, type XgooseBuiltTool } from "@xgoose/core";
import { callBridge } from "../pageRpc";

const DEFAULT_JS_EXEC_TIMEOUT_MS = 30_000;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : "null";
  } catch {
    return String(value);
  }
}

export type JsExecToolDeps = {
  /** Host-supplied default timeout when `timeout_ms` isn't passed by the
   *  caller. Lets the host expose it as a setting. */
  getDefaultTimeoutMs(): number;
  /** Turns image references the page cannot read itself into image values before they are detached. */
  resolveResultImages?(result: unknown, signal?: AbortSignal): Promise<unknown>;
};

/**
 * Run async JavaScript in the page MAIN world via the pageBridge. The
 * intricate parts:
 *   - Wraps the user's body as `(async () => { … })()` inside the bridge.
 *   - Forwards the agent-run AbortSignal end-to-end: signal abort → tell
 *     the bridge to abort the exec → return `{ ok:false, error:'aborted by user' }`.
 *   - Returns results in full; only a value too large for the model window
 *     is replaced by a stored handle (see `boundedModelText`).
 */
export function createJsExecTool(deps: JsExecToolDeps): XgooseBuiltTool {
  return defineTool({
    name: "js_exec",
    description:
      "Run async JavaScript in the page MAIN world. Code body is wrapped in `(async () => { ... })()`. Use `return X` to return JSON. `xgoose.skills.<ns>.*` is available. Skills return their documented data directly: do not unwrap a skill return with `.result` unless its schema includes that field. Only the outer js_exec response has {ok,result,error}. Inspect Object.keys(value) and a small sample after an unexpected shape. Each return value is kept as `xgoose.results[resultId]` for later calls, so loop, filter and aggregate in code and return what the answer needs. Set parallel_safe:true for read-only code.",
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          "JS body wrapped in `(async () => { ...code... })()`. Use `return X` to return JSON. " +
            "In scope: `args` (array, defaults to []), `signal` (AbortSignal), `xgoose` (the skills root; " +
            "`xgoose.results[resultId]` holds the return values of earlier calls in this page).",
        ),
      purpose: z
        .string()
        .describe(
          "Brief past-tense description of what this call does (shown in the UI).",
        ),
      parallel_safe: z
        .boolean()
        .optional()
        .describe(
          "True iff this call only reads (no clicks/navigation/mutations).",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe(
          "Per-call timeout. Defaults to settings.jsExecTimeoutMs (30000).",
        ),
      args: z
        .array(z.unknown())
        .optional()
        .describe(
          "Optional JSON array bound to `args` inside `code`. Defaults to [].",
        ),
    }),
    toModelOutput: jsExecModelOutput,
    isReadOnly: false,
    isConcurrencySafe: (i) => !!i?.parallel_safe,
    label: (i) => (i?.purpose ? truncate(String(i.purpose), 60) : "Ran JS"),
    execute: async ({ code, args, timeout_ms }, opts) => {
      const execId = Math.random().toString(36).slice(2, 12);
      const timeoutMs =
        timeout_ms ?? deps.getDefaultTimeoutMs() ?? DEFAULT_JS_EXEC_TIMEOUT_MS;
      const signal = opts?.abortSignal;
      // Early-out if the user already clicked Stop before this tool even
      // started executing.
      if (signal?.aborted) {
        return { ok: false, error: "aborted by user" };
      }
      // Pass `timeoutMs + 2000` as the RPC timeout so the bridge's internal
      // per-exec timer (which knows the user's `code` and can produce a rich
      // error like "js_exec timed out after Xms: <truncated code>") fires
      // *first*. The +2000 buffer covers postMessage latency. If the bridge
      // itself is unreachable, `ensurePageBridge` inside `callBridge` will
      // reject within ~3.5s with a CSP-aware error instead of waiting here.
      const execPromise = callBridge(
        "exec",
        { code, args: args ?? [], timeoutMs, execId },
        timeoutMs + 2000,
      ) as Promise<{
        ok: boolean;
        result?: unknown;
        error?: string;
        stack?: string;
      }>;

      // Race the bridge call against the agent-run AbortSignal. When the
      // signal fires we synchronously tell the page bridge to abort the
      // running exec (its abortFlags map will reject the in-flight Promise.race
      // and the bridge will return `{ ok:false, error:'user_abort' }`) AND
      // resolve our local promise immediately so the AI SDK stream unblocks
      // without waiting for the bridge round-trip.
      const res: {
        ok: boolean;
        result?: unknown;
        error?: string;
        stack?: string;
      } = signal
        ? await new Promise((resolve) => {
            const onAbort = (): void => {
              void callBridge("abort", { execId }).catch(() => {});
              resolve({ ok: false, error: "aborted by user" });
            };
            signal.addEventListener("abort", onAbort, { once: true });
            execPromise.then(
              (v) => {
                signal.removeEventListener("abort", onAbort);
                resolve(v);
              },
              (err) => {
                signal.removeEventListener("abort", onAbort);
                resolve({ ok: false, error: err?.message ?? String(err) });
              },
            );
          })
        : await execPromise;

      // Preserve the actual result for the local journal and consented transcript; image bytes go only to the model.
      if (!res.ok) return res;
      const result = deps.resolveResultImages ? await deps.resolveResultImages(res.result, signal) : res.result;
      return { ...res, result: detachResultImages(result) };

    },
  });
}

/** Only the model-facing representation is bounded; transcript details stay intact. */
export function jsExecModelOutput(output:unknown) {
  const envelope=output as {ok?:boolean;result?:unknown;resultId?:unknown}|null;
  const id=typeof envelope?.resultId==="string"?envelope.resultId:undefined;
  const shown=envelope?.ok?{...envelope,result:websiteEvidence(envelope.result,location.origin)}:output;
  if(id&&envelope?.ok)storeResult(id,envelope.result);
  const text=boundedModelText(envelope?.ok?envelope.result:output,safeJson(shown),{id,pageHandle:!!id});
  return [{type:"text" as const,text},...resultImageParts(envelope?.result)];
}
