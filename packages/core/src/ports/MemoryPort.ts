/**
 * Per-origin durable memory: powers the `remember` / `forget` tools and
 * the system-reminder's "# Memory for <origin>" section. Hosts wire this
 * to whatever storage they have available (browser.storage.local in MV3,
 * GM_setValue in a userscript, etc.).
 */
export interface MemoryPort {
  /**
   * Append `note` to the memory blob for `origin`, returning the new
   * memory contents (so the tool can echo it back to the model).
   */
  appendMemoryForOrigin(origin: string, note: string): Promise<string>;

  /** Wipe all stored notes for `origin`. */
  clearMemoryForOrigin(origin: string): Promise<void>;

  /** Read the current memory for `origin`, or `null` if there's nothing saved. */
  getMemoryForOrigin(origin: string): Promise<string | null>;
}
