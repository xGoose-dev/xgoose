import type { BridgeLoader, BridgeInjectResult } from "@xgoose/page-controller";
import { send } from "@/shared/messages";

function injectScriptTag(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = chrome.runtime.getURL("pageBridge.js");
    const s = document.createElement("script");
    s.src = url;
    s.async = false;
    s.dataset.xgoose = "1";
    s.onload = (): void => {
      s.remove();
      resolve();
    };
    s.onerror = (e): void => {
      s.remove();
      reject(new Error("script-tag load failed: " + String(e)));
    };
    (document.head || document.documentElement).appendChild(s);
  });
}

export const chromeBridgeLoader: BridgeLoader = {
  async injectViaScripting(): Promise<BridgeInjectResult | null> {
    try {
      const res = await send("sw:inject_page_bridge", undefined);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
  async injectViaScriptTag(): Promise<BridgeInjectResult | null> {
    try {
      await injectScriptTag();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
};
