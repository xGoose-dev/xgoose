/**
 * Lets the agent (and its tools) ask "what origin / URL is the user on
 * right now?". In a browser-extension content script this is just
 * `new URL(location.href).origin`; in a multi-tab host it could be the
 * currently-targeted tab's origin.
 */
export interface OriginPort {
  /** Origin string (e.g. `https://www.uscardforum.com`) or `null` when
   *  the agent is detached from a real page. */
  getCurrentOrigin(): string | null;
  getCurrentPageUrl(): string;
  getCurrentPageTitle(): string;
}
