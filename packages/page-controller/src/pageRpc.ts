// Isolated-world content script ↔ MAIN-world pageBridge RPC over
// `xgoose:request` / `xgoose:response` CustomEvents.
//
// Owns the *liveness* of the MAIN-world bridge. The bridge ships three
// ways, tried in order, and the first one that produces a successful
// ping wins:
//
//   1. Manifest `content_scripts` entry with `world: "MAIN"` at
//      `document_start`. This is the canonical MV3 path and is immune to
//      page CSP because content scripts run in their own world, not as a
//      `<script src>` the page can see / forbid.
//
//   2. `chrome.scripting.executeScript({ world: 'MAIN', ... })` issued by
//      the background SW (via the `BridgeLoader.injectViaScripting` port).
//      Also bypasses page CSP, because the scripting API runs under the
//      extension's own scripting permission.
//
//   3. `<script src="extension-url://…/pageBridge.js">` via
//      `BridgeLoader.injectViaScriptTag`. Works on relaxed sites; gets
//      silently blocked on strict-CSP sites like Google. Kept as a last
//      resort.
//
// If all three fail (truly strict CSP that we can't pierce) we flip
// `bridgeUnreachable` so subsequent `callBridge()` calls reject *immediately*
// with an actionable error, instead of each one waiting the full 60-second
// RPC timeout — which is what was killing UX on Google before this fix.

import type { BridgeLoader } from "./ports/BridgeLoader";

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: number;
};

const pending = new Map<string, Pending>();

window.addEventListener("xgoose:response", (ev) => {
  const detail = (ev as CustomEvent).detail as { id: string; resp: any };
  const slot = pending.get(detail.id);
  if (!slot) return;
  pending.delete(detail.id);
  clearTimeout(slot.timer);
  if (
    detail.resp &&
    typeof detail.resp === "object" &&
    "__error" in detail.resp
  ) {
    slot.reject(new Error(String(detail.resp.__error)));
  } else {
    slot.resolve(detail.resp);
  }
});

// ── loader installation ────────────────────────────────────────────────────

let hostExecutor: ((op: string, payload: any) => Promise<any>) | undefined;
export function installPageExecutor(executor: (op: string, payload: any) => Promise<any>): void { hostExecutor = executor; }

let installedLoader: BridgeLoader | null = null;

/**
 * Install the host's `BridgeLoader` adapter. Must be called exactly once,
 * at content-script bootstrap, BEFORE any `callBridge`. Hosts with no
 * fallbacks (pure userscripts) can install a no-op loader that returns
 * `null` from both methods.
 */
export function installBridgeLoader(loader: BridgeLoader): void {
  installedLoader = loader;
}

// ── bridge readiness ───────────────────────────────────────────────────────

let bridgeReady: Promise<void> | null = null;
let bridgeUnreachable = false;

export function isBridgeUnreachable(): boolean {
  return bridgeUnreachable;
}

/** Reset readiness state (e.g. after an SPA route change to a new origin
 *  where the bridge previously failed). Next `callBridge` will re-probe. */
export function resetBridgeReadiness(): void {
  bridgeReady = null;
  bridgeUnreachable = false;
}

/** Quick liveness probe — sends `listSkillNamespaces` (cheap, no side
 *  effects) and resolves true if the bridge replies within `timeoutMs`. */
async function pingBridge(timeoutMs: number): Promise<boolean> {
  try {
    await rawCallBridge("listSkillNamespaces", undefined, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure the MAIN-world pageBridge is loaded and responsive. Idempotent;
 * the first call drives the probe, subsequent calls share its promise.
 *
 * Worst-case latency before fail-fast: ~3.5s (500ms probe + 1.5s after SW
 * inject + 1.5s after script-tag fallback). On well-behaved pages the
 * manifest content-script entry has the bridge up before this is ever
 * called, so the first ping succeeds in ~milliseconds.
 */
export function ensurePageBridge(): Promise<void> {
  if (bridgeReady) return bridgeReady;
  bridgeReady = (async () => {
    if (await pingBridge(500)) return;
    if (installedLoader) {
      try {
        const res = await installedLoader.injectViaScripting();
        if (res?.ok && (await pingBridge(1500))) return;
        if (res && !res.ok) {
          console.warn(
            "[xgoose] BridgeLoader.injectViaScripting rejected:",
            res.error,
          );
        }
      } catch (e) {
        console.warn("[xgoose] BridgeLoader.injectViaScripting threw:", e);
      }
      try {
        const res = await installedLoader.injectViaScriptTag();
        if (res?.ok && (await pingBridge(1500))) return;
        if (res && !res.ok) {
          console.warn(
            "[xgoose] BridgeLoader.injectViaScriptTag rejected:",
            res.error,
          );
        }
      } catch (e) {
        console.warn("[xgoose] BridgeLoader.injectViaScriptTag threw:", e);
      }
    } else {
      console.warn(
        "[xgoose] no BridgeLoader installed; relying solely on the manifest content-script entry.",
      );
    }
    bridgeUnreachable = true;
    console.warn(
      "[xgoose] pageBridge unreachable on",
      location.href,
      "— js_exec and related tools will fail-fast for this page until reload.",
    );
  })();
  return bridgeReady;
}

// ── RPC ────────────────────────────────────────────────────────────────────

// Bypasses `ensurePageBridge` so `pingBridge` itself doesn't recurse forever.
function rawCallBridge<T = unknown>(
  op: string,
  payload?: unknown,
  timeoutMs = 35_000,
): Promise<T> {
  const id = Math.random().toString(36).slice(2, 12);
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`pageBridge:${op} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    window.dispatchEvent(
      new CustomEvent("xgoose:request", { detail: { id, op, payload } }),
    );
  });
}

export async function callBridge<T = unknown>(
  op: string,
  payload?: unknown,
  timeoutMs = 35_000,
): Promise<T> {
  if (op === "exec" || op === "abort") {
    if (!hostExecutor) throw new Error("A userScripts executor must be installed by the host");
    return hostExecutor(op, payload);
  }
  await ensurePageBridge();
  if (bridgeUnreachable) {
    throw new Error(
      "pageBridge unreachable on this page — likely a strict Content-Security-Policy " +
        "(this is common on Google, Facebook, GitHub, Twitter/X) that blocks the " +
        "extension from injecting JavaScript into the page MAIN world. js_exec and " +
        "related DOM/page-API tools cannot run here. The user should navigate to " +
        "a less-restrictive page (open the target site directly in a new tab), or " +
        "report this site so we can add a special-case loader.",
    );
  }
  return rawCallBridge<T>(op, payload, timeoutMs);
}

/** Returns the list of skill namespaces currently loaded in the page. */
export function listLoadedSkillNamespaces(): Promise<string[]> {
  return callBridge<string[]>("listSkillNamespaces");
}
