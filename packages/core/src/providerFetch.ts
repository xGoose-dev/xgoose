/**
 * Reusable utility for browser-extension hosts that need to route the AI
 * SDK's fetch through a background service worker (to bypass page CSP and
 * the iOS Safari `Authorization`-header drop bug).
 *
 * The host supplies two transports:
 *   - `sendNonStreaming`: one-shot RPC equivalent of fetch — gets the
 *     status, headers, and body in one round-trip.
 *   - `openStreaming`: opens a long-lived channel that yields the response
 *     head plus an async iterable of body chunks (or an error), so the AI
 *     SDK can read deltas as they arrive.
 *
 * Hosts that don't need any of this (a userscript, or a Chrome extension
 * where content-script fetch already works fine) can just pass
 * `globalThis.fetch.bind(globalThis)` as `HostFetcher` and ignore this
 * file entirely.
 */

/** Headers map keyed lower-case for predictable lookup. */
export type HeaderBag = Record<string, string>;

export type NonStreamingResponse =
  | {
      ok: true;
      status: number;
      headers: HeaderBag;
      body: string;
      binary: boolean;
    }
  | { ok: false; error: string };

export type StreamingHandle = {
  /** Async iterable of decoded text chunks (Server-Sent Events frames typically). */
  chunks: AsyncIterable<Uint8Array>;
  /** Promise that resolves with the response head (status + headers) once known. */
  head: Promise<{ status: number; headers: HeaderBag }>;
  /** Cancel the in-flight upstream fetch. Called when the AI SDK aborts. */
  cancel(): void;
};

export type ProviderFetchTransport = {
  sendNonStreaming(req: {
    url: string;
    method: string;
    headers: HeaderBag;
    body?: string;
  }): Promise<NonStreamingResponse>;
  openStreaming(req: {
    url: string;
    method: string;
    headers: HeaderBag;
    body?: string;
    signal: AbortSignal | null;
  }): Promise<StreamingHandle>;
};

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
  headers: HeaderBag,
  body: string | undefined,
): boolean {
  const accept = headers["accept"] ?? headers["Accept"] ?? "";
  if (accept.includes("text/event-stream")) return true;
  if (/[?&]alt=sse\b/.test(url) || url.includes(":streamGenerateContent"))
    return true;
  if (body && /"stream"\s*:\s*true/.test(body)) return true;
  return false;
}

/**
 * Drop-in replacement for `fetch()` built on top of a `ProviderFetchTransport`.
 * The streaming path is triggered when the request asks for SSE — see
 * `wantsStreaming` for the heuristics (Accept header, Gemini stream URL, or a
 * `"stream": true` body).
 */
export function buildProviderFetch(
  transport: ProviderFetchTransport,
): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const req = new Request(input, init);
    const method = req.method;
    const url = req.url;
    const headers: HeaderBag = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const bodyText = await readBody(req);

    // Propagate the AbortSignal end-to-end. The AI SDK passes its run-level
    // signal as `init.signal`; without forwarding it, clicking Stop only
    // aborts our local stream reader — the LLM HTTP connection in the SW
    // stays open, the provider keeps generating tokens, and the agent loop
    // keeps processing buffered chunks after the user expected it to halt.
    const signal = (init?.signal ?? req.signal) || null;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    // Route to the streaming transport for SSE-style requests. This must also
    // catch Google/Gemini, which signals streaming via the URL rather than the
    // Accept header (see wantsStreaming).
    const wantsStream = wantsStreaming(url, headers, bodyText);

    if (wantsStream) {
      return openStreamResponse(transport, {
        url,
        method,
        headers,
        body: bodyText,
        signal,
      });
    }

    // Non-streaming path: race the round-trip against the abort signal so
    // the AI SDK gets an AbortError as soon as the user clicks Stop,
    // instead of waiting for the host response.
    const fetchPromise = transport.sendNonStreaming({
      url,
      method,
      headers,
      body: bodyText,
    });
    const resp = await raceAbort(fetchPromise, signal);
    if (!resp.ok) throw new Error(resp.error);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  }) as typeof fetch;
}

async function openStreamResponse(
  transport: ProviderFetchTransport,
  args: {
    url: string;
    method: string;
    headers: HeaderBag;
    body: string | undefined;
    signal: AbortSignal | null;
  },
): Promise<Response> {
  const handle = await transport.openStreaming(args);
  const head = await handle.head;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of handle.chunks) controller.enqueue(chunk);
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {}
      }
    },
    cancel() {
      handle.cancel();
    },
  });
  if (args.signal) {
    if (args.signal.aborted) {
      handle.cancel();
    } else {
      args.signal.addEventListener(
        "abort",
        () => {
          handle.cancel();
          try {
            stream.cancel(new DOMException("aborted", "AbortError"));
          } catch {}
        },
        { once: true },
      );
    }
  }
  return new Response(stream, { status: head.status, headers: head.headers });
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
