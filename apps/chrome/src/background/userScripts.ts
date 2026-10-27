import {extensionDetailsUrl} from '@/shared/browser';
/** Every dynamically supplied program passes through Chrome's userScripts API. */
export async function executeUserScript(sender: chrome.runtime.MessageSender, code: string): Promise<any> {
  const tabId = sender.tab?.id, documentId = sender.documentId;
  if (typeof tabId !== "number" || !documentId) throw new Error("A live page document is required");
  if (!chrome.userScripts?.execute) throw new Error(`Open ${extensionDetailsUrl()}, select xgoose, and enable Allow User Scripts.`);
  const results = await chrome.userScripts.execute({ target: { tabId, documentIds: [documentId] }, world: "MAIN", js: [{ code }] });
  const result = results.find(r => r.documentId === documentId);
  if (!result) throw new Error("The page changed; start a new run in the current document.");
  if (result.error) throw new Error(result.error);
  return result.result;
}
export async function executePage(sender: chrome.runtime.MessageSender, payload: { code: string; args?: unknown[]; timeoutMs?: number; execId: string }) {
  const timeout = Math.min(Math.max(payload.timeoutMs ?? 30000, 100), 120000);
  const code = `(async () => {
    const jobs = globalThis.__xgooseExecutions ??= new Map();
    const root = globalThis.xgoose ??= { skills: {} }, results = root.results ??= {};
    const id = ${JSON.stringify(payload.execId)}, ac = new AbortController();
    jobs.set(id, ac);
    let timer;
    try {
      const work = (async (args, signal, xgoose, __execId) => {\n${payload.code}\n})(${JSON.stringify(payload.args ?? [])}, ac.signal, globalThis.xgoose, id);
      const stopped = new Promise((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(new Error('Execution stopped; side effects may remain.')), { once: true });
        timer = setTimeout(() => ac.abort(), ${timeout});
      });
      const result = await Promise.race([work, stopped]);
      results[id] = result;
      for (const key of Object.keys(results).slice(0, -20)) delete results[key];
      return { ok: true, result, resultId: id };
    } catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
    finally { clearTimeout(timer); jobs.delete(id); }
  })()`;
  return executeUserScript(sender, code);
}
