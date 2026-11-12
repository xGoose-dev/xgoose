export type MemoryCommand = {op:"append";origin:string;note:string} | {op:"clear";origin:string};

// All tabs share this writer; their content-script mirrors are only readers.
let pending: Promise<unknown> = Promise.resolve();
export function memoryCommand(command: MemoryCommand): Promise<string> {
  const update = async () => {
    const key = `xgoose.memory:${command.origin}`;
    if (command.op === "clear") {
      await chrome.storage.local.remove(key);
      return "";
    }
    const stored = await chrome.storage.local.get(key);
    const existing = typeof stored[key] === "string" ? stored[key] : "";
    const note = command.note.trim().replace(/\s+/g, " ");
    if (!note) return existing;
    const date = new Date().toISOString().split("T")[0];
    const lines = (existing ? existing.split("\n") : []).filter(Boolean);
    lines.push(`- ${date}: ${note}`);
    const kept = lines.slice(-20);
    while (kept.join("\n").length > 2048 && kept.length > 1) kept.shift();
    const next = kept.join("\n");
    await chrome.storage.local.set({[key]: next});
    return next;
  };
  const job = pending.then(update, update);
  pending = job;
  return job;
}
