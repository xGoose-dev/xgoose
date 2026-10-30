import {peerTransaction} from "./sessionDb";
import type {PeerRequest, PeerReply, PeerAgent} from "@/shared/peers";
import {claimPeerMessage, invalidatePeer, peer, putPeerMessage, queuePeerTask, settlePeer, waitForPeers} from "../../../../packages/core/src/peerAgents";

// Serializes browser-side effects; IDB transactions separately serialize durable transitions.
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = pending.then(fn, fn); pending = result.catch(() => {}); return result;
}
const agentUrl = () => chrome.runtime.getURL("agent.html");
const allowedUrl = (url: string) => /^https?:\/\//i.test(url) || url.split(/[?#]/)[0] === agentUrl();
async function sendPeer(tabId: number, message: {kind: string; payload?: unknown}) {
  const tab = await chrome.tabs.get(tabId);
  // tabs.sendMessage reaches content scripts, not extension-owned HTML pages.
  return tab.url?.split(/[?#]/)[0] === agentUrl()
    ? chrome.runtime.sendMessage({...message, peerTabId: tabId})
    : chrome.tabs.sendMessage(tabId, message, {frameId: 0});
}
async function senderTab(request: PeerRequest, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || (sender.frameId ?? 0) !== 0) throw new Error("Peer operations require an extension's top-level page");
  const extensionPage = sender.url?.split(/[?#]/)[0] === agentUrl();
  const tabId = sender.tab?.id ?? (extensionPage ? request.tabId : undefined);
  if (tabId === undefined || !request.nonce) throw new Error("A live peer tab is required");
  const tab = await chrome.tabs.get(tabId);
  if (!allowedUrl(tab.url ?? "") || tab.incognito) throw new Error("This tab cannot host a peer agent");
  return tab;
}
async function notifyPending(): Promise<void> {
  const targets = await peerTransaction(state => Object.values(state.agents).filter(agent => agent.tabId !== null &&
    agent.status !== "unavailable" && state.messages.some(message => message.to === agent.id && message.state === "pending")));
  for (const agent of targets) {
    // Delivery is a hint. A resumed page pulls the durable inbox even if this fails.
    void sendPeer(agent.tabId!, {kind: "cs:peer_notify", payload: {nonce: agent.documentKey}}).catch(() => {});
  }
}
export function peerCommand(request: PeerRequest, sender: chrome.runtime.MessageSender): Promise<PeerReply> {
  return serial(async () => {
    const tab = await senderTab(request, sender), op = request.operation;
    if (op.op === "register") {
      const live = await sendPeer(tab.id!, {kind: "cs:peer_identity"});
      if (live?.nonce !== request.nonce) throw new Error("The peer document changed before registration");
      const agent = await peerTransaction(state => {
        const old = Object.values(state.agents).find(item => item.tabId === tab.id && item.status !== "unavailable");
        if (old?.documentKey === request.nonce && old.sessionId === op.sessionId) return old;
        // A reserved peer may bind only its first loaded document. A new document
        // never inherits a previous document's tasks, even at the same URL.
        let reserved = op.requestedId ? state.agents[op.requestedId] : old?.documentKey === null ? old : undefined;
        if (reserved && (reserved.documentKey !== null || (reserved.tabId !== null && reserved.tabId !== tab.id))) reserved = undefined;
        if (old && old !== reserved) invalidatePeer(state, old.id, "The peer navigated, reloaded, or changed conversation");
        const agent: PeerAgent = reserved ?? {id: crypto.randomUUID(), sessionId: op.sessionId, tabId: tab.id!,
          documentKey: request.nonce, url: tab.url!, title: tab.title ?? "", status: "idle", model: op.model};
        agent.tabId = tab.id!; agent.documentKey = request.nonce;
        agent.url = tab.url!; agent.title = tab.title ?? "";
        state.agents[agent.id] = agent;
        return agent;
      });
      await notifyPending(); return {agent};
    }
    const me = await peerTransaction(state => {
      const agent = peer(state, request.agentId!);
      if (agent.tabId !== tab.id || agent.documentKey !== request.nonce) throw new Error("Peer identity does not match this document");
      return agent;
    });
    if (op.op === "tabs") {
      const [tabs, agents] = await Promise.all([chrome.tabs.query({}), peerTransaction(state => Object.values(state.agents))]);
      return {tabs: tabs.filter(item => !item.incognito).map(item => ({tabId: item.id, title: item.title ?? "", url: item.url ?? "",
        active: item.active, status: item.status, agentId: agents.find(agent => agent.tabId === item.id && agent.status !== "unavailable")?.id,
        canHostAgent: allowedUrl(item.url ?? "")}))};
    }
    if (op.op === "spawn") {
      if (op.url && op.tabId !== undefined) throw new Error("Choose url or tabId, not both");
      if (op.url && !/^https?:\/\//i.test(op.url)) throw new Error("New website peers require an HTTP(S) URL; omit url for the built-in agent page");
      const taskId = `${me.id}:${op.requestId}`;
      const prior = await peerTransaction(state => state.tasks[taskId]);
      if (prior) return {agent: await peerTransaction(state => state.agents[prior.agentId]), taskId};
      let target: PeerAgent;
      if (op.tabId !== undefined) {
        const targetTab = await chrome.tabs.get(op.tabId);
        if (targetTab.incognito || !allowedUrl(targetTab.url ?? "")) throw new Error("This tab cannot host a peer agent");
        const identity = await sendPeer(op.tabId, {kind: "cs:peer_identity"}).catch(() => null);
        if (!identity?.nonce) throw new Error("xgoose is not ready in that tab. Grant website access or open the page once, then retry.");
        target = await peerTransaction(state => {
          const agent = Object.values(state.agents).find(item => item.tabId === op.tabId && item.documentKey === identity.nonce && item.status !== "unavailable");
          if (!agent) throw new Error("The tab is still initializing xgoose; retry when it is ready");
          return agent;
        });
      } else {
        const id = crypto.randomUUID();
        target = {id, sessionId: crypto.randomUUID(), tabId: null, documentKey: null,
          url: op.url ?? `${agentUrl()}?peer=${encodeURIComponent(id)}`, title: "Peer agent", status: "idle", model: me.model};
        await peerTransaction(state => {state.agents[id] = target;});
        try {
          const created = await chrome.tabs.create({url: target.url, active: false});
          if (created.id === undefined) throw new Error("Browser did not return a tab ID");
          target.tabId = created.id;
          await peerTransaction(state => {state.agents[id].tabId = created.id!;});
        } catch (error) {
          await peerTransaction(state => invalidatePeer(state, id, "Could not create the peer page")); throw error;
        }
      }
      await peerTransaction(state => queuePeerTask(state, taskId, me.id, target.id, op.task));
      await notifyPending(); return {agent: target, taskId, messageId: taskId, status: target.documentKey ? "queued" : "waiting_for_page"};
    }
    const reply = await peerTransaction(state => {
      const agent = peer(state, me.id);
      switch (op.op) {
        case "list": return {agents: Object.values(state.agents).filter(item => item.status !== "unavailable")};
        case "send": {
          peer(state, op.agentId);
          if (op.agentId === me.id) throw new Error("Choose another peer");
          putPeerMessage(state, {id: `${me.id}:${op.requestId}`, from: me.id, to: op.agentId, kind: "message", text: op.message, state: "pending"});
          return {delivered: "queued", messageId: `${me.id}:${op.requestId}`};
        }
        case "take": return {message: claimPeerMessage(state, me.id), agent};
        case "begin": {
          const message = state.messages.find(item => item.id === agent.activeMessageId);
          agent.traceId = message?.traceId ?? (agent.activeTaskId ? state.tasks[agent.activeTaskId]?.traceId : undefined) ?? op.runId;
          agent.runId = op.runId; agent.model = op.model; agent.status = "running"; agent.waitingOn = undefined;
          return {agent};
        }
        case "wait": return waitForPeers(state, me.id, op.agentIds);
        case "settle": settlePeer(state, me.id, op.runId, op.outcome, op.text); return {};
        case "stop": {
          if (agent.activeTaskId) {
            agent.runId ??= crypto.randomUUID(); settlePeer(state, me.id, agent.runId, "cancelled", "The user stopped this peer");
          }
          agent.status = "stopped"; agent.waitingOn = undefined; return {};
        }
      }
      throw new Error("Unknown peer operation");
    });
    await notifyPending(); return reply;
  });
}
export function installPeerEvents(): void {
  chrome.tabs.onRemoved.addListener(tabId => {
    void serial(async () => {
      await peerTransaction(state => {for (const agent of Object.values(state.agents)) if (agent.tabId === tabId) invalidatePeer(state, agent.id, "The peer tab was closed");});
      await notifyPending();
    }).catch(console.warn);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "loading") return;
    void serial(async () => {
      await peerTransaction(state => {for (const agent of Object.values(state.agents)) if (agent.tabId === tabId && agent.documentKey) invalidatePeer(state, agent.id, "The peer page navigated or reloaded");});
      await notifyPending();
    }).catch(console.warn);
  });
}
