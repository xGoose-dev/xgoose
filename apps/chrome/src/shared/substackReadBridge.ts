export interface SubstackReadRequest { subdomain: string; path: string }
export type SubstackReadReply =
  | { ok: true; status: number; body: string; headers: Record<string, string>; url: string }
  | { ok: false; error: string };

const requestEvent = "xgoose:substack-read-request";
const responseEvent = "xgoose:substack-read-response";
type Bus = Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent">;

// Only public publication reads cross this bridge. Cookies and caller-supplied
// headers never enter the protocol; the background validates every route.
export function installSubstackReadContentBridge(
  read: (request: SubstackReadRequest) => Promise<SubstackReadReply>,
  bus: Bus = window,
): void {
  bus.addEventListener(requestEvent, async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail?.id !== "string" || detail.id.length > 100 ||
        typeof detail.subdomain !== "string" || typeof detail.path !== "string") return;
    let reply: SubstackReadReply;
    try { reply = await read({subdomain: detail.subdomain, path: detail.path}); }
    catch (error) { reply = {ok: false, error: String((error as Error)?.message ?? error)}; }
    bus.dispatchEvent(new CustomEvent(responseEvent, {detail: {id: detail.id, reply}}));
  });
}

export function installSubstackReadPageBridge(bridge: Record<string, any>, bus: Bus = window): void {
  if (bridge.substackRead) return;
  bridge.substackRead = (request: SubstackReadRequest, options: {signal?: AbortSignal} = {}): Promise<SubstackReadReply> =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const cleanup = () => {
        clearTimeout(timer);
        bus.removeEventListener(responseEvent, receive);
        options.signal?.removeEventListener("abort", abort);
      };
      const abort = () => { cleanup(); reject(new Error("Substack read cancelled")); };
      const receive = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.id !== id) return;
        cleanup(); resolve(detail.reply);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("Substack read timed out")); }, 17000);
      bus.addEventListener(responseEvent, receive);
      options.signal?.addEventListener("abort", abort, {once: true});
      if (options.signal?.aborted) { abort(); return; }
      bus.dispatchEvent(new CustomEvent(requestEvent, {detail: {id, subdomain: request.subdomain, path: request.path}}));
    });
}
