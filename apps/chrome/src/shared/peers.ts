import type { PeerAgent, PeerMessage, PeerModel } from "../../../../packages/core/src/peerAgents";
export type { PeerAgent, PeerMessage, PeerModel };
export type PeerOperation =
  | {op: "register"; sessionId: string; model: PeerModel; requestedId?: string}
  | {op: "list" | "tabs" | "take" | "stop"}
  | {op: "spawn"; requestId: string; task: string; url?: string; tabId?: number}
  | {op: "send"; requestId: string; agentId: string; message: string}
  | {op: "wait"; agentIds: string[]}
  | {op: "begin"; runId: string; model: PeerModel}
  | {op: "settle"; runId: string; outcome: "completed" | "waiting" | "failed" | "cancelled"; text: string};
export interface PeerRequest { nonce: string; agentId?: string; tabId?: number; operation: PeerOperation }
export interface PeerReply {
  agent?: PeerAgent; agents?: PeerAgent[]; message?: PeerMessage | null;
  taskId?: string; waiting?: boolean; [key: string]: unknown;
}
export const isAgentPage = () => location.href.split(/[?#]/)[0] === chrome.runtime.getURL("agent.html");
