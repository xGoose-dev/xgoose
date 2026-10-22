# @xgoose/page-controller

Browser-only, extension-agnostic page surface for the xgoose agent.

Owns:

- The **MAIN-world `pageBridge`** (console / fetch / XHR ring buffers,
  blob-import `js_exec` runtime, `xgoose:request` / `xgoose:response`
  CustomEvent RPC).
- The **isolated-world RPC client** (`callBridge`, `ensurePageBridge`,
  `installBridgeLoader`).
- The seven **page-controller tools** below.

## Tools

| Name                 | What it does                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page_info`          | Cheap snapshot: URL, title, viewport, lang, readyState.                                                                                                                                                                                                            |
| `read_page`          | Format-switched raw read: `text` (innerText), `html` (outerHTML), `links` (`<a href>` list), `outline` (`<h1-h6>` list). Best for prose-style reading.                                                                                                             |
| `read_page_semantic` | **Dehydrated accessibility snapshot** powered by [`@xgoose/dom-snapshot`](../dom-snapshot/). Returns indented text or JSON with stable `[id=N]` markers on interactive elements. Best for "understand the shape of the page" and for setting up follow-up actions. |
| `js_exec`            | Run user code in the MAIN world via the bridge (blob-URL dynamic import — CSP-friendly).                                                                                                                                                                           |
| `console_logs`       | Read the ring buffer captured by the bridge.                                                                                                                                                                                                                       |
| `network_requests`   | Read recent fetch / XHR entries.                                                                                                                                                                                                                                   |
| `network_request`    | Drill into a single request's headers / request body / response body.                                                                                                                                                                                              |

## When to use `read_page` vs `read_page_semantic`

- `read_page text|html` is the right choice for "summarise this article" or
  "find the price in the prose".
- `read_page_semantic` is the right choice when the agent needs to plan an
  action ("click the Reply button", "fill in the email field"). The
  returned `[id=N]` markers are stable until the next snapshot and can be
  fed to a future action tool that calls `resolveId(N)` from
  `@xgoose/dom-snapshot` to recover the live `Element`.

The two are deliberately separate: `read_page_semantic` mutates DOM
attributes (`data-xgoose-id`) and is declared `isConcurrencySafe: false`,
whereas `read_page` is a pure read and runs in parallel.

## Wiring

```ts
import {
  installBridgeLoader,
  ensurePageBridge,
  buildPageControllerTools,
  type BridgeLoader,
} from "@xgoose/page-controller";

const bridgeLoader: BridgeLoader = {
  /* host-specific injection */
};
installBridgeLoader(bridgeLoader);
await ensurePageBridge();

const tools = buildPageControllerTools({
  getDefaultTimeoutMs: () => 30_000,
  getRedactionConfig: () => ({
    redactSensitiveHeaders: true,
    redactSensitiveHeaderKeys: ["authorization", "cookie", "set-cookie"],
  }),
});
```

The MAIN-world bridge itself is exposed at `@xgoose/page-controller/pageBridge`
so the host's bundler can emit it as a separate IIFE that the host's
manifest loads with `world: "MAIN"`.

## Dependencies

- Peer: [`@xgoose/core`](../core/) for `defineTool` / `XgooseBuiltTool`.
- Peer: [`@xgoose/dom-snapshot`](../dom-snapshot/) for `read_page_semantic`.
- Peer: `ai` ^6.0.0 and `zod` ^3.24.0 for tool schemas.
