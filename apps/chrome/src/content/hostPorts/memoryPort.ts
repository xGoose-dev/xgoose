import type { MemoryPort } from "@xgoose/core";
import {
  appendMemoryForOrigin,
  clearMemoryForOrigin,
  getMemoryForOrigin,
} from "@/shared/storage";

export const chromeMemoryPort: MemoryPort = {
  async appendMemoryForOrigin(origin, note) {
    return appendMemoryForOrigin(origin, note);
  },
  async clearMemoryForOrigin(origin) {
    await clearMemoryForOrigin(origin);
  },
  async getMemoryForOrigin(origin) {
    const v = getMemoryForOrigin(origin);
    return v && v.length ? v : null;
  },
};
