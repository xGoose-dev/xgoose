/**
 * Wait for the DOM to be "quiet" — no mutations for `debounceMs` — before
 * snapshotting. Useful on SPAs that paint a skeleton first and then hydrate.
 *
 * Always runs in the foreground content script, so no background-tab
 * throttle guards are needed.
 */

export interface DomQuietOptions {
  /** Required idle window in ms (no mutations during this stretch). Default 200. */
  debounceMs?: number;
  /** Hard wall-clock cap. Default 1500. */
  maxWaitMs?: number;
  /** Document to observe. Defaults to the global `document`. */
  doc?: Document;
}

/**
 * Resolves `true` if a quiet window was observed, `false` if the budget
 * expired first. The promise always resolves within `maxWaitMs + debounceMs`.
 */
export async function awaitDomQuiet(
  opts: DomQuietOptions = {},
): Promise<boolean> {
  const debounceMs = Math.max(40, opts.debounceMs ?? 200);
  const maxWaitMs = Math.max(debounceMs + 40, opts.maxWaitMs ?? 1500);
  const doc = opts.doc ?? document;
  const root = doc.documentElement;
  if (!root || typeof MutationObserver === "undefined") return true;

  return new Promise<boolean>((resolve) => {
    const start = Date.now();
    let lastMutationAt = start;
    let settled = false;

    const observer = new MutationObserver(() => {
      lastMutationAt = Date.now();
    });
    try {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } catch {
      resolve(true);
      return;
    }

    const tick = () => {
      if (settled) return;
      const now = Date.now();
      if (now - lastMutationAt >= debounceMs) {
        finish(true);
        return;
      }
      if (now - start >= maxWaitMs) {
        finish(false);
        return;
      }
      // Sleep for the remaining shorter of the two windows, capped at 60ms
      // so we don't oversleep past the quiet window.
      const sleepMs = Math.max(
        20,
        Math.min(
          60,
          debounceMs - (now - lastMutationAt),
          maxWaitMs - (now - start),
        ),
      );
      setTimeout(tick, sleepMs);
    };

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve(ok);
    };

    tick();
  });
}
