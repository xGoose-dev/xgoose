import type { StoredConversation } from "@/shared/types";

// This module runs only in the extension service worker: IDB belongs to the
// extension origin, never to the visited site. Separate rows prevent lost updates
// when two tabs save unrelated conversations concurrently.
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("xgoose-sessions", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "id" });
      db.createObjectStore("events", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      db.createObjectStore("outbox", { keyPath: "id" });
      db.createObjectStore("meta");
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    let value: T;
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Session storage interrupted"));
    fn(tx, next => { value = next; });
  });
}
let migration: Promise<void> | undefined;
function migrate(): Promise<void> {
  return migration ??= (async () => {
    const legacy = await chrome.storage.local.get("xgoose.conversations");
    await transaction<void>(["meta", "sessions"], "readwrite", tx => {
      const check = tx.objectStore("meta").get("migrated-v1");
      check.onsuccess = () => {
        if (check.result) return;
        for (const row of (Array.isArray(legacy["xgoose.conversations"]) ? legacy["xgoose.conversations"] as any[] : [])) if (row?.id) tx.objectStore("sessions").put(row);
        tx.objectStore("meta").put(true, "migrated-v1");
      };
    });
    // Keep the legacy copy until migration commits, then remove global pointers.
    await chrome.storage.local.remove(["xgoose.conversations", "xgoose.lastConvo", "xgoose.resume"]);
  })().catch(error => { migration = undefined; throw error; });
}
export async function sessionCommand(command: { op: "list" | "get" | "save" | "delete" | "event"; id?: string; value?: any }): Promise<any> {
  await migrate();
  if (command.op === "event") return transaction(["events"], "readwrite", tx => { tx.objectStore("events").put(command.value); });
  return transaction(["sessions"], command.op === "list" || command.op === "get" ? "readonly" : "readwrite", (tx, done) => {
    const store = tx.objectStore("sessions");
    if (command.op === "list") { const req = store.getAll(); req.onsuccess = () => done(req.result.sort((a, b) => b.updatedAt - a.updatedAt)); }
    if (command.op === "get") { const req = store.get(command.id!); req.onsuccess = () => done(req.result ?? null); }
    if (command.op === "delete") store.delete(command.id!);
    if (command.op === "save") {
      const value = command.value as StoredConversation;
      const req = store.get(value.id);
      req.onsuccess = () => store.put({ ...value, createdAt: req.result?.createdAt ?? value.createdAt });
    }
  });
}

export interface JournalEvent {
  id:string; sessionId:string; runId:string; at:number; event:any;
  provider:"hosted"|"byok"; ownerId?:string; sequence?:number;
}
export async function journal(value:JournalEvent,upload:boolean) {
  await transaction<void>(["events","outbox","meta"],"readwrite",tx=>{
    const key=`sequence:${value.sessionId}`;
    const req=tx.objectStore("meta").get(key);
    req.onsuccess=()=>{
      const sequence=req.result??0;
      const row={...value,sequence};
      tx.objectStore("events").put(row);
      if(upload&&value.ownerId)tx.objectStore("outbox").put(row);
      tx.objectStore("meta").put(sequence+1,key);
    };
  });
}
export async function pendingEvents(ownerId:string):Promise<JournalEvent[]> {
  return transaction(["outbox"],"readonly",(tx,done)=>{const r=tx.objectStore("outbox").getAll();r.onsuccess=()=>done(r.result.filter(e=>e.ownerId===ownerId).sort((a,b)=>a.at-b.at).slice(0,50));});
}
export async function acknowledgeEvents(ids:string[]) {await transaction<void>(["outbox"],"readwrite",tx=>{for(const id of ids)tx.objectStore("outbox").delete(id);});}
export async function clearPending(ownerId:string,provider?:"hosted"|"byok") {
  await transaction<void>(["outbox"],"readwrite",tx=>{
    const store=tx.objectStore("outbox"),req=store.openCursor();req.onsuccess=()=>{const c=req.result;if(!c)return;if(c.value.ownerId===ownerId&&(!provider||c.value.provider===provider))c.delete();c.continue();};
  });
}
