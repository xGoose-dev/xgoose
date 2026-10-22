// MAIN-world bridge installed via <script src="…"> by the content script.
//
// Owns:
//   - `window.xgoose.skills.<namespace>.*` — populated by each skill IIFE.
//   - `window.__xgoose` — the bridge object with exec(), abort(), and the
//     console/network ring buffers.
//   - A `xgoose:request` / `xgoose:response` CustomEvent pair so the content
//     script (which lives in an isolated world but shares the DOM) can call
//     into the bridge.
//
// Skill code runs in the MAIN world so it can:
//   1. Use fetch(url, { credentials: 'include' }) and inherit the user's
//      cookies + CSRF tokens (e.g. Discourse <meta name="csrf-token">).
//   2. Call into framework globals (Ember.* on Discourse, etc.).
//
// Adapted from webagent's src/page/pageBridge.ts.

type ExecResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; stack?: string };

type ConsoleEntry = {
  ts: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  args: unknown[];
  text: string;
};

type NetworkEntry = {
  id: string;
  ts: number;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  reqHeaders?: Record<string, string>;
  reqBody?: string;
  resHeaders?: Record<string, string>;
  resBody?: string;
  resSizeBytes?: number;
  error?: string;
};

(() => {
  const w = window as any;
  if (w.__xgoose) return;

  w.xgoose = w.xgoose ?? { skills: {} };
  const skillsRoot: Record<string, any> = w.xgoose.skills;

  const CONSOLE_BUF: ConsoleEntry[] = [];
  const NET_BUF: NetworkEntry[] = [];
  const NET_DETAILS = new Map<string, NetworkEntry>();
  const MAX_CONSOLE = 500;
  const MAX_NET = 500;
  const MAX_BODY_PREVIEW = 4096;
  const abortFlags = new Map<string, AbortController>();

  patchConsole();
  patchFetch();
  patchXHR();

  async function exec(_args: unknown): Promise<ExecResult> {
    return { ok: false, error: "Dynamic execution requires the extension userScripts adapter" };
  }

  function abort(execId: string): void {
    const ac = abortFlags.get(execId);
    if (ac) ac.abort(new Error("user_abort"));
  }

  function patchConsole() {
    const orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as const;
    const ASYNC_LEVELS = new Set<keyof typeof orig>(["warn", "error"]);
    (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
      console[level] = function (...args: unknown[]) {
        try {
          push({
            ts: Date.now(),
            level,
            args,
            text: args.map(safeStringify).join(" "),
          });
        } catch {}
        if (ASYNC_LEVELS.has(level)) {
          setTimeout((orig[level] as any).bind(console, ...args), 0);
          return undefined;
        }
        return (orig[level] as any).apply(console, args);
      };
    });
    function push(entry: ConsoleEntry) {
      CONSOLE_BUF.push(entry);
      if (CONSOLE_BUF.length > MAX_CONSOLE) {
        CONSOLE_BUF.splice(0, CONSOLE_BUF.length - MAX_CONSOLE);
      }
    }
  }

  function patchFetch() {
    if (!w.fetch) return;
    const origFetch = w.fetch.bind(w);
    w.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const id = randId();
      const t0 = performance.now();
      const url =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      const method = (
        init?.method ??
        (input as Request)?.method ??
        "GET"
      ).toUpperCase();
      const reqBody =
        typeof init?.body === "string"
          ? init.body.slice(0, MAX_BODY_PREVIEW)
          : undefined;
      const reqHeaders = headersToObj(init?.headers);
      const entry: NetworkEntry = {
        id,
        ts: Date.now(),
        method,
        url,
        reqHeaders,
        reqBody,
      };
      try {
        const resp = await origFetch(input as any, init);
        entry.status = resp.status;
        entry.durationMs = Math.round(performance.now() - t0);
        entry.resHeaders = headersToObj(resp.headers);
        pushNet(entry);
        // Capture a bounded body PREVIEW without blocking the caller.
        //
        // The previous implementation did `await resp.clone().text()` *before*
        // returning `resp`, which delayed every fetch until its entire body had
        // downloaded — and hung forever on never-ending streams (SSE / chunked
        // long-poll). On streaming-heavy sites (e.g. bilibili) that stalled
        // page features that depend on those responses. We now record the
        // status/headers synchronously and read at most MAX_BODY_PREVIEW bytes
        // off a clone in the background, then cancel. Cross-repo: xGoose-dev/xgoose-web#2
        capturePreview(resp, entry);
        return resp;
      } catch (err: any) {
        entry.error = err?.message ?? String(err);
        entry.durationMs = Math.round(performance.now() - t0);
        pushNet(entry);
        throw err;
      }
    };
  }

  // Read a bounded preview of a response body off a clone, fire-and-forget.
  // Never blocks the page (the original response is already returned), caps
  // memory at MAX_BODY_PREVIEW bytes, cancels the clone stream when done, and
  // skips open-ended streams so it can't double-download or hang.
  function capturePreview(resp: Response, entry: NetworkEntry): void {
    void (async () => {
      try {
        const ct = resp.headers.get("content-type") || "";
        if (/text\/event-stream/i.test(ct)) return; // open-ended stream
        const clone = resp.clone();
        if (!clone.body) {
          // No readable stream (opaque/empty) — headers/status already logged.
          return;
        }
        const reader = clone.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (total < MAX_BODY_PREVIEW) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength) {
              chunks.push(value);
              total += value.byteLength;
            }
          }
        } finally {
          try {
            await reader.cancel();
          } catch {}
        }
        const capped = Math.min(total, MAX_BODY_PREVIEW);
        const merged = new Uint8Array(capped);
        let off = 0;
        for (const c of chunks) {
          if (off >= capped) break;
          const slice = c.subarray(0, capped - off);
          merged.set(slice, off);
          off += slice.length;
        }
        const cl = Number(resp.headers.get("content-length"));
        entry.resSizeBytes = Number.isFinite(cl) && cl > 0 ? cl : total;
        entry.resBody = new TextDecoder().decode(merged);
      } catch {}
    })();
  }

  function patchXHR() {
    const Orig = XMLHttpRequest;
    function PatchedXHR(this: XMLHttpRequest) {
      const xhr = new Orig();
      const meta: NetworkEntry = {
        id: randId(),
        ts: Date.now(),
        method: "GET",
        url: "",
      };
      const reqHeaders: Record<string, string> = {};
      const origOpen = xhr.open;
      xhr.open = function (method: string, url: string, ...rest: any[]) {
        meta.method = method.toUpperCase();
        meta.url = String(url);
        return (origOpen as any).call(xhr, method, url, ...rest);
      } as any;
      const origSetReq = xhr.setRequestHeader;
      xhr.setRequestHeader = function (k: string, v: string) {
        reqHeaders[k] = v;
        return origSetReq.call(xhr, k, v);
      };
      const origSend = xhr.send;
      const t0 = performance.now();
      xhr.send = function (body?: any) {
        meta.reqHeaders = reqHeaders;
        meta.reqBody =
          typeof body === "string"
            ? body.slice(0, MAX_BODY_PREVIEW)
            : undefined;
        xhr.addEventListener("loadend", () => {
          meta.status = xhr.status;
          meta.durationMs = Math.round(performance.now() - t0);
          try {
            const text =
              typeof xhr.responseText === "string" ? xhr.responseText : "";
            meta.resSizeBytes = text.length;
            meta.resBody = text.slice(0, MAX_BODY_PREVIEW);
          } catch {}
          pushNet(meta);
        });
        return origSend.call(xhr, body);
      };
      return xhr;
    }
    (PatchedXHR as any).prototype = Orig.prototype;
    // Preserve the static props the page may read off the constructor — most
    // importantly the readyState constants (XMLHttpRequest.UNSENT/OPENED/
    // HEADERS_RECEIVED/LOADING/DONE). Without these, common code paths like
    // `xhr.readyState === XMLHttpRequest.DONE` compare against `undefined` and
    // silently never fire — another way page features "don't load". (#2)
    try {
      for (const k of Object.getOwnPropertyNames(Orig)) {
        if (k === "prototype" || k === "name" || k === "length") continue;
        if (k in (PatchedXHR as any)) continue;
        try {
          (PatchedXHR as any)[k] = (Orig as any)[k];
        } catch {}
      }
    } catch {}
    (w as any).XMLHttpRequest = PatchedXHR as any;
  }

  function pushNet(entry: NetworkEntry) {
    NET_BUF.push(entry);
    NET_DETAILS.set(entry.id, entry);
    if (NET_BUF.length > MAX_NET) {
      const removed = NET_BUF.splice(0, NET_BUF.length - MAX_NET);
      for (const r of removed) NET_DETAILS.delete(r.id);
    }
  }

  function headersToObj(
    h?: HeadersInit | Headers,
  ): Record<string, string> | undefined {
    if (!h) return undefined;
    const out: Record<string, string> = {};
    if (h instanceof Headers) {
      h.forEach((v, k) => (out[k] = v));
      return out;
    }
    if (Array.isArray(h)) {
      for (const [k, v] of h) out[k] = v;
      return out;
    }
    return { ...(h as Record<string, string>) };
  }

  function safeStringify(v: unknown): string {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.message;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function randId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  function getConsoleLogs(opts?: {
    since?: number;
    levels?: string[];
    limit?: number;
  }) {
    const { since = 0, levels, limit = 200 } = opts ?? {};
    const filtered = CONSOLE_BUF.filter(
      (e) => e.ts >= since && (!levels?.length || levels.includes(e.level)),
    );
    return filtered.slice(-limit);
  }

  function getNetworkRequests(opts?: {
    since?: number;
    filter?: string;
    limit?: number;
  }) {
    const { since = 0, filter, limit = 100 } = opts ?? {};
    const re = filter ? new RegExp(filter, "i") : null;
    const filtered = NET_BUF.filter(
      (e) => e.ts >= since && (!re || re.test(e.url)),
    );
    return filtered.slice(-limit).map((e) => ({
      id: e.id,
      ts: e.ts,
      method: e.method,
      url: e.url,
      status: e.status,
      durationMs: e.durationMs,
      resSizeBytes: e.resSizeBytes,
      error: e.error,
    }));
  }

  function getNetworkRequestDetail(
    id: string,
    part: "headers" | "body" | "response",
  ) {
    const e = NET_DETAILS.get(id);
    if (!e) return null;
    if (part === "headers")
      return { req: e.reqHeaders ?? {}, res: e.resHeaders ?? {} };
    if (part === "body") return e.reqBody ?? null;
    return {
      status: e.status,
      body: e.resBody ?? null,
      sizeBytes: e.resSizeBytes,
    };
  }

  function clearCaptures() {
    CONSOLE_BUF.length = 0;
    NET_BUF.length = 0;
    NET_DETAILS.clear();
  }

  function registerSkill(namespace: string, exports: Record<string, unknown>) {
    skillsRoot[namespace] = Object.assign(skillsRoot[namespace] ?? {}, exports);
  }

  const bridge = {
    exec,
    abort,
    registerSkill,
    getConsoleLogs,
    getNetworkRequests,
    getNetworkRequestDetail,
    clearCaptures,
    listSkillNamespaces: () => Object.keys(skillsRoot),
  };
  w.__xgoose = bridge;

  // Track in-flight RPC ids so that on page navigation we can resolve them
  // with a navigation sentinel — otherwise an `exec` that does
  // `window.location.href = …` will leave the content-script promise hanging
  // forever (the page is torn down before the response event ever fires).
  const pendingRequests = new Set<string>();

  function dispatchResp(id: string, resp: any): void {
    window.dispatchEvent(
      new CustomEvent("xgoose:response", { detail: { id, resp } }),
    );
  }

  function flushPendingForNavigation(): void {
    if (!pendingRequests.size) return;
    const newUrl = location.href;
    const ids = Array.from(pendingRequests);
    pendingRequests.clear();
    for (const id of ids) {
      dispatchResp(id, {
        ok: true,
        result: { __xgoose_navigated: true, newUrl },
      });
    }
  }

  // `beforeunload` fires when the user (or `js_exec`) initiates navigation —
  // we get a brief synchronous window to dispatch responses while the page is
  // still alive. `pagehide` is the iOS-Safari-friendly fallback (BFCache /
  // single-page navigation cases where `beforeunload` doesn't fire reliably).
  window.addEventListener("beforeunload", flushPendingForNavigation, {
    capture: true,
  });
  window.addEventListener("pagehide", flushPendingForNavigation, {
    capture: true,
  });

  // CustomEvent RPC bridge — isolated-world content script dispatches
  // `xgoose:request` events that we serve and reply via `xgoose:response`.
  // Using CustomEvents (rather than window.postMessage) lets the content
  // script use a strict allow-list payload shape without our messages
  // mixing into other page-level message channels.
  window.addEventListener("xgoose:request", async (ev: Event) => {
    const detail = (ev as CustomEvent).detail as {
      id: string;
      op: string;
      payload: any;
    };
    if (!detail?.id) return;
    pendingRequests.add(detail.id);
    let resp: any;
    try {
      switch (detail.op) {
        case "exec":
          resp = await exec(detail.payload);
          break;
        case "abort":
          abort(detail.payload?.execId);
          resp = { ok: true };
          break;
        case "consoleLogs":
          resp = getConsoleLogs(detail.payload);
          break;
        case "networkRequests":
          resp = getNetworkRequests(detail.payload);
          break;
        case "networkRequestDetail":
          resp = getNetworkRequestDetail(
            detail.payload.id,
            detail.payload.part,
          );
          break;
        case "clearCaptures":
          clearCaptures();
          resp = { ok: true };
          break;
        case "listSkillNamespaces":
          resp = Object.keys(skillsRoot);
          break;
        default:
          resp = { __error: "unknown op " + detail.op };
      }
    } catch (err: any) {
      resp = { __error: err?.message ?? String(err) };
    }
    // Drop from pending before dispatching so a beforeunload listener that
    // fires while we're between `await` and `dispatchResp` doesn't double-resolve.
    if (!pendingRequests.has(detail.id)) {
      // Already resolved by navigation handler — skip the real reply.
      return;
    }
    pendingRequests.delete(detail.id);
    dispatchResp(detail.id, resp);
  });

  // Tell the content script we're up.
  window.dispatchEvent(new CustomEvent("xgoose:ready"));
})();
