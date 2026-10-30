import {z} from "zod";
import {defineTool} from "@xgoose/core";
import {send} from "@/shared/messages";
import {isAgentPage, type PeerAgent, type PeerMessage, type PeerModel, type PeerOperation, type PeerReply} from "@/shared/peers";

const scope = globalThis as typeof globalThis & {__xgoosePeerNonce?: string};
const nonce = scope.__xgoosePeerNonce ??= crypto.randomUUID();
const ownPage = isAgentPage();
let ownTabId: number | undefined;
const tabReady = ownPage ? chrome.tabs.getCurrent().then(tab => {ownTabId = tab?.id;}) : Promise.resolve();
let notify: (() => void) | undefined;
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (ownPage && message.peerTabId !== ownTabId) return false;
  if (message.kind === "cs:peer_identity") {reply({nonce}); return false;}
  if (message.kind === "cs:peer_notify" && (!message.payload?.nonce || message.payload.nonce === nonce)) {
    notify?.(); reply({ok: true});
  }
  return false;
});

export class PagePeers {
  agent?: PeerAgent;
  waiting = false;
  private pumping = false;
  private registration?: Promise<void>;
  private runId = "";
  private stopped = false;
  constructor(private host: {
    sessionId: () => string;
    model: () => PeerModel;
    busy: () => boolean;
    lock: () => void;
    unlock: () => void;
    receive: (message: PeerMessage, agent: PeerAgent) => Promise<void>;
    status: (text: string) => void;
  }) {notify = () => this.kick();}

  private rpc(operation: PeerOperation): Promise<PeerReply> {
    return send("sw:peer", {nonce, tabId: ownTabId, agentId: this.agent?.id, operation});
  }
  async register(): Promise<void> {
    if (this.registration) return this.registration;
    this.registration = (async () => {
      await tabReady;
      const sessionId = this.host.sessionId();
      const result = await this.rpc({op: "register", sessionId, model: this.host.model(),
        ...(ownPage ? {requestedId: new URL(location.href).searchParams.get("peer") ?? undefined} : {})});
      this.agent = result.agent;
    })().finally(() => {this.registration = undefined;});
    return this.registration;
  }
  async begin() {
    if (!this.agent || this.agent.sessionId !== this.host.sessionId()) await this.register();
    this.waiting = false; this.stopped = false; this.runId = crypto.randomUUID();
    await this.rpc({op: "begin", runId: this.runId, model: this.host.model()});
  }
  async finish(outcome: "completed" | "failed" | "cancelled", text: string) {
    if (!this.agent || !this.runId) return;
    const waiting = this.waiting && outcome === "completed";
    await this.rpc({op: "settle", runId: this.runId, outcome: waiting ? "waiting" : outcome, text});
    if (waiting) this.host.status("Waiting for peer agents…");
    this.runId = "";
  }
  async stop() {
    this.stopped = true; this.waiting = false;
    if (this.agent) await this.rpc({op: "stop"});
  }
  async reset() {await this.stop(); this.agent = undefined; this.stopped = false;}
  kick() {void this.pump().catch(error => this.host.status(`Peer: ${error.message ?? error}`));}
  private async pump() {
    if (this.pumping || this.host.busy() || this.stopped) return;
    this.pumping = true;
    this.host.lock();
    try {
      if (!this.agent) await this.register();
      while (!this.stopped) {
        const result = await this.rpc({op: "take"});
        if (!result.message) break;
        this.agent = result.agent;
        await this.host.receive(result.message, this.agent!);
      }
    } finally {this.pumping = false; this.host.unlock();}
  }
  start() {
    this.kick();
    // A best-effort notification may be missed while a document is suspended.
    // Pulling on resume and occasionally while runnable also survives event-page reloads.
    document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") this.kick();});
    window.addEventListener("pageshow", () => this.kick());
    const timer = window.setInterval(() => this.kick(), 10000);
    window.addEventListener("pagehide", () => window.clearInterval(timer), {once: true});
  }
  tools() {
    const call = async (operation: PeerOperation) => {
      if (!this.agent) await this.register();
      return this.rpc(operation);
    };
    return [
      defineTool({name: "list_tabs", description: "List all open browser tabs with IDs, URLs, titles, active state and any peer agent. Does not change the active tab.",
        inputSchema: z.object({}), execute: () => call({op: "tabs"})}),
      defineTool({name: "list_agents", description: "List equal peer agents, their tab IDs and execution states. Peers have separate conversations and no parent/child ownership.",
        inputSchema: z.object({}), execute: () => call({op: "list"})}),
      defineTool({name: "spawn_agent", description: "Ask a peer to work on a task. Supply tabId to use an existing page, url to open a website, or neither to open the built-in agent.html page. New tabs open in the background. Results are sent back automatically when that task finishes. Peers are equals and can contact each other.",
        inputSchema: z.object({task: z.string().min(1), url: z.string().url().optional(), tabId: z.number().int().optional()}),
        execute: (input, opts) => call({op: "spawn", ...input, requestId: `${this.runId}:${opts.toolCallId ?? crypto.randomUUID()}`})}),
      defineTool({name: "send_message", description: "Send a message to another peer. It processes it after its current run, or continues if waiting. Sending does not wait for a reply and does not switch tabs.",
        inputSchema: z.object({agentId: z.string(), message: z.string().min(1)}),
        execute: (input, opts) => call({op: "send", ...input, requestId: `${this.runId}:${opts.toolCallId ?? crypto.randomUUID()}`})}),
      defineTool({name: "wait_agents", description: "Yield this run until peer results or messages arrive, without polling the model. Returns immediately if results are already available. Call after assigning work; when waiting is true, this turn ends and incoming messages resume it.",
        inputSchema: z.object({agentIds: z.array(z.string()).min(1)}), execute: async input => {
          const result = await call({op: "wait", ...input}); this.waiting = result.waiting === true; return result;
        }}),
    ];
  }
}
