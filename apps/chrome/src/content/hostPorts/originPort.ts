import type { OriginPort } from "@xgoose/core";

export const chromeOriginPort: OriginPort = {
  getCurrentOrigin() {
    try {
      return new URL(location.href).origin;
    } catch {
      return null;
    }
  },
  getCurrentPageUrl() {
    return location.href;
  },
  getCurrentPageTitle() {
    return document.title;
  },
};
