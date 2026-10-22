import type { CoreSettings } from "../types";

/**
 * Read-only access to the host's user-configurable settings. Today the
 * settings are read on demand at agent-construction time (so settings
 * changes take effect on the next user prompt without re-bootstrapping
 * the content script).
 */
export interface SettingsPort {
  getSettings(): CoreSettings;
}
