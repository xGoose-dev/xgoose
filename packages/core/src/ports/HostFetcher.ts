/**
 * The agent ships LLM provider requests through this port instead of using
 * the global `fetch`. In a browser-extension host the implementation routes
 * through the background service worker (so the request gets the
 * extension's host_permissions + bypasses page CSP); in a userscript host
 * it can just be `globalThis.fetch.bind(globalThis)`.
 *
 * The signature is intentionally `typeof fetch` so the AI SDK can pass it
 * straight through to the underlying provider client.
 */
export type HostFetcher = typeof fetch;
