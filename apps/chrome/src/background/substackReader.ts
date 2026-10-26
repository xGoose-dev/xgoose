import type { SubstackReadRequest, SubstackReadReply } from "../shared/substackReadBridge";

const readPath = /^(?:\/feed|\/api\/v1\/(?:archive|posts\/(?:by-id\/\d+|[a-zA-Z0-9_-]+)|post\/\d+\/comments))$/;
const maxBytes = 2 * 1024 * 1024;
function validateDestination(url: URL, original: URL): void {
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(url.hostname) ||
      /\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
      url.pathname !== original.pathname || url.search !== original.search || url.hash) {
    throw new Error("Invalid Substack publication redirect");
  }
}

export async function readSubstackPublication(
  request: SubstackReadRequest,
  senderUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<SubstackReadReply> {
  try {
    const sender = new URL(senderUrl);
    if (sender.protocol !== "https:" || !/(^|\.)substack\.com$/.test(sender.hostname))
      throw new Error("Cross-publication reads require a Substack page");
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(request.subdomain) ||
        ["www", "api"].includes(request.subdomain.toLowerCase()) ||
        typeof request.path !== "string" || request.path.length > 4096 || !request.path.startsWith("/") || request.path.startsWith("//"))
      throw new Error("Invalid Substack publication request");
    const original = new URL(request.path, `https://${request.subdomain}.substack.com`);
    if (!readPath.test(original.pathname) || original.hash)
      throw new Error("Only Substack archive, post, comment and feed reads are supported");
    const allowedParams = new Set(["sort", "offset", "limit", "search"]);
    for (const [key, value] of original.searchParams)
      if (!allowedParams.has(key) || value.length > 300) throw new Error("Unsupported publication query parameter");
    const signal = AbortSignal.timeout(15000);
    // Chromium returns an opaque-redirect response (status 0, no Location)
    // for redirect:manual, even in an extension worker. Let Fetch follow the
    // publication's redirect, then validate the final URL before reading data.
    const response = await fetcher(original, {method: "GET", credentials: "omit", redirect: "follow", signal});
    const url = new URL(response.url || original.href);
    validateDestination(url, original);
    if (response.status < 200 || response.status > 599 || [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      throw new Error("Substack publication redirect did not produce a readable response");
    }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      if (reader) try {
        for (;;) {
          const {done, value} = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw new Error("Substack response exceeds 2 MiB; request a smaller page"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const buffer = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const headers: Record<string, string> = {};
      for (const key of ["content-type", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"])
        if (response.headers.has(key)) headers[key] = response.headers.get(key)!;
      return {ok: true, status: response.status, body: new TextDecoder().decode(buffer), headers, url: url.href};

  } catch (error) { return {ok: false, error: String((error as Error)?.message ?? error)}; }
}
