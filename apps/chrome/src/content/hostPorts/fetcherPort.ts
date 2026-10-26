// Chrome implementation of the `@xgoose/core` `HostFetcher` port.
//
// Routes provider HTTP through the background service worker so the
// extension's `host_permissions: ["<all_urls>"]` apply (content-script
// fetch is subject to page CORS rules in MV3).
//
// Streaming responses come back over a long-lived `chrome.runtime.connect`
// port so the AI SDK reads deltas as they arrive instead of one big body.
// Non-streaming responses use a one-shot `chrome.runtime.sendMessage`.
//
// Mirrors xgoose-safari's adapter; identical because Chrome and Safari
// expose the same MV3 chrome.runtime API.

import type { HostFetcher } from "@xgoose/core";
import { send } from "@/shared/messages";
// New envelope shape: send('sw:foo', payload) wraps as { kind, payload }
// — content fetcher only calls 'sw:proxy_fetch' and
// 'sw:proxy_fetch_stream_open', both of which already match.

export function createChromeProviderFetch(options:{hostedAccountId?:string}={}): HostFetcher {
  return (async (input: any, init?: RequestInit) => {
    const req = new Request(input, init);
    const method = req.method;
    const url = req.url;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const bodyText = await readBody(req);

    const signal = (init?.signal ?? req.signal) || null;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    if (wantsStreaming(url, headers, bodyText)) {
      return openStreaming(url, method, headers, bodyText, signal, options.hostedAccountId);
    }

    const fetchPromise = send("sw:proxy_fetch", {
      url,
      method,
      headers,
      body: bodyText,
      hostedAccountId: options.hostedAccountId,
    });
    const resp = await raceAbort(fetchPromise, signal);
    if (!resp.ok) throw new Error(resp.error);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  }) as HostFetcher;
}

/**
 * Decide whether a provider request should use the streaming transport.
 *
 * The OpenAI-compatible providers advertise SSE with `Accept: text/event-stream`,
 * but the Google Generative AI provider (used by the BYOK `gemini` and hosted
 * `gemini-litellm` providers) signals streaming purely through the request URL
 * (`:streamGenerateContent?alt=sse`) and never sets that header. Relying on the
 * Accept header alone therefore routed every Gemini call through the buffering
 * one-shot proxy, so the whole answer arrived at once instead of token-by-token.
 *
 * Detect all three shapes so streaming works regardless of provider:
 *   - `Accept: text/event-stream` (OpenAI-compatible)
 *   - `alt=sse` / `:streamGenerateContent` in the URL (Google)
 *   - `"stream": true` in the JSON body (OpenAI-shaped fallback)
 */
function wantsStreaming(
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
): boolean {
  const accept = headers["accept"] ?? headers["Accept"] ?? "";
  if (accept.includes("text/event-stream")) return true;
  if (/[?&]alt=sse\b/.test(url) || url.includes(":streamGenerateContent"))
    return true;
  if (body && /"stream"\s*:\s*true/.test(body)) return true;
  return false;
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void =>
      reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function readBody(req: Request): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  try {
    return await req.text();
  } catch {
    return undefined;
  }
}

function openStreaming(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal | null,
  hostedAccountId?:string,
): Promise<Response> {
  const streamId = Math.random().toString(36).slice(2, 12);
  const port = chrome.runtime.connect({ name: `xgoose:stream:${streamId}` });

  return new Promise<Response>((resolve, reject) => {
    let ended = false;
    let status = 200;
    let respHeaders: Record<string, string> = {};
    let headStreamReady: ((value: Response) => void) | null = null;
    let streamCtrl: ReadableStreamDefaultController<Uint8Array> | null = null;
    let teardown: (() => void) | null = null;

    const onAbort = (): void => {
      try {
        streamCtrl?.error(new DOMException("aborted", "AbortError"));
      } catch {}
      try {
        port.disconnect();
      } catch {}
      if (headStreamReady) {
        headStreamReady = null;
        reject(new DOMException("aborted", "AbortError"));
      }
    };
    if (signal) {
      if (signal.aborted) {
        port.disconnect();
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      teardown = () => signal.removeEventListener("abort", onAbort);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamCtrl = controller;
        const encoder = new TextEncoder();
        port.onMessage.addListener((msg: any) => {
          if (!msg || typeof msg !== "object") return;
          switch (msg.kind) {
            case "head":
              status = msg.status ?? 200;
              respHeaders = msg.headers ?? {};
              if (headStreamReady) {
                const r = new Response(stream, {
                  status,
                  headers: respHeaders,
                });
                headStreamReady(r);
                headStreamReady = null;
              }
              break;
            case "chunk":
              try {
                controller.enqueue(encoder.encode(msg.data));
              } catch {}
              break;
            case "end":
              ended = true;
              try {
                controller.close();
              } catch {}
              teardown?.();
              break;
            case "error":
              try {
                controller.error(new Error(msg.error ?? "stream error"));
              } catch {}
              if (headStreamReady) {
                const r = headStreamReady;
                headStreamReady = null;
                reject(new Error(msg.error ?? "stream error"));
                void r;
              }
              teardown?.();
              break;
          }
        });
        port.onDisconnect.addListener(() => {
          if (!ended && !signal?.aborted) {
            const error = new Error("The extension worker disconnected before completion. This request was not replayed.");
            try { controller.error(error); } catch {}
            if (headStreamReady) { headStreamReady = null; reject(error); }
          }
          teardown?.();
        });
      },
      cancel() {
        try {
          port.disconnect();
        } catch {}
        teardown?.();
      },
    });
    headStreamReady = resolve;
    send("sw:proxy_fetch_stream_open", { streamId, url, method, headers, body, hostedAccountId })
      .then((res) => {
        if (!res.ok) {
          port.disconnect();
          teardown?.();
          reject(new Error(res.error));
        }
      })
      .catch((err) => {
        port.disconnect();
        teardown?.();
        reject(err);
      });
  });
}
