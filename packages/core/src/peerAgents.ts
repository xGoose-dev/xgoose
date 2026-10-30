/** Durable peer coordination. Browser adapters own tab creation and delivery. */
export type PeerStatus = "idle" | "running" | "waiting" | "stopped" | "unavailable";
export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "unavailable";
export interface PeerModel { provider: string; model: string; thinking: boolean }
export interface PeerAgent {
  id: string; sessionId: string; tabId: number | null; documentKey: string | null;
  url: string; title: string; status: PeerStatus; model: PeerModel;
  activeTaskId?: string; activeMessageId?: string; replyToMessageIds?: string[]; runId?: string; traceId?: string; waitingOn?: string[];
}
export interface PeerTask {
  id: string; requesterId: string; agentId: string; status: TaskStatus; result?: string; traceId?: string;
}
export interface PeerMessage {
  id: string; from: string; to: string; kind: "task" | "message" | "result";
  text: string; taskId?: string; outcome?: TaskStatus; state: "pending" | "claimed" | "handled";
  traceId?: string; fromSessionId?: string; fromRunId?: string; sentAt?: number;
}
export interface PeerState {
  agents: Record<string, PeerAgent>; tasks: Record<string, PeerTask>; messages: PeerMessage[];
}
export const emptyPeerState = (): PeerState => ({agents: {}, tasks: {}, messages: []});
export function peer(state: PeerState, id: string): PeerAgent {
  const agent = state.agents[id];
  if (!agent || agent.status === "unavailable") throw new Error("Peer page is no longer available");
  return agent;
}
export function putPeerMessage(state: PeerState, message: PeerMessage): void {
  if (state.messages.some(item => item.id === message.id)) return;
  const source = state.agents[message.from];
  message.traceId ??= (message.taskId ? state.tasks[message.taskId]?.traceId : undefined) ?? source?.traceId ?? source?.runId ?? message.id;
  message.fromSessionId ??= source?.sessionId;
  message.fromRunId ??= source?.runId;
  message.sentAt ??= Date.now();
  state.messages.push(message);
}
function finishTask(state: PeerState, task: PeerTask, status: TaskStatus, text: string): void {
  if (!["queued", "running", "waiting"].includes(task.status)) return;
  task.status = status; task.result = text;
  putPeerMessage(state, {id: `result:${task.id}`, from: task.agentId, to: task.requesterId,
    kind: "result", text, taskId: task.id, outcome: status, state: "pending"});
}
export function invalidatePeer(state: PeerState, id: string, reason: string): void {
  const agent = state.agents[id];
  if (!agent || agent.status === "unavailable") return;
  agent.status = "unavailable";
  const notified = new Set<string>();
  for (const task of Object.values(state.tasks)) if (task.agentId === id && ["queued", "running", "waiting"].includes(task.status)) {
    finishTask(state, task, "unavailable", reason); notified.add(task.requesterId);
  }
  for (const request of state.messages.filter(item => item.to === id && item.kind === "message" &&
    (item.state !== "handled" || agent.replyToMessageIds?.includes(item.id)))) {
    putPeerMessage(state, {id: `reply:${request.id}`, from: id, to: request.from,
      kind: "result", text: reason, outcome: "unavailable", state: "pending", traceId: request.traceId});
    request.state = "handled"; notified.add(request.from);
  }
  agent.replyToMessageIds = undefined;
  // Wake peers waiting on a conversation that did not originate from spawn_agent.
  for (const other of Object.values(state.agents)) if (other.waitingOn?.includes(id) && !notified.has(other.id)) {
    putPeerMessage(state, {id: `unavailable:${id}:${other.id}`, from: id, to: other.id,
      kind: "result", text: reason, outcome: "unavailable", state: "pending"});
  }
}
export function queuePeerTask(state: PeerState, taskId: string, requesterId: string, agentId: string, text: string): PeerTask {
  peer(state, requesterId); peer(state, agentId);
  if (requesterId === agentId) throw new Error("Use the current agent directly instead of spawning it into its own tab");
  if (state.tasks[taskId]) return state.tasks[taskId];
  const task: PeerTask = {id: taskId, requesterId, agentId, status: "queued", traceId: state.agents[requesterId].traceId};
  state.tasks[taskId] = task;
  putPeerMessage(state, {id: taskId, from: requesterId, to: agentId, kind: "task", text, taskId, state: "pending"});
  return task;
}
export function claimPeerMessage(state: PeerState, id: string): PeerMessage | null {
  const agent = peer(state, id);
  if (agent.status === "running" || agent.status === "stopped" || agent.activeMessageId) return null;
  const message = state.messages.find(item => item.to === id && item.state === "pending" &&
    (!agent.activeTaskId || item.kind !== "task"));
  if (!message) return null;
  message.state = "claimed"; agent.activeMessageId = message.id; agent.status = "running";
  if (message.kind === "message") (agent.replyToMessageIds ??= []).push(message.id);
  agent.waitingOn = undefined;
  if (message.kind === "task") { agent.activeTaskId = message.taskId; state.tasks[message.taskId!].status = "running"; }
  return message;
}
export function waitForPeers(state: PeerState, id: string, ids: string[]) {
  const agent = peer(state, id);
  if (!ids.length || ids.includes(id)) throw new Error("Choose at least one other peer to wait for");
  for (const target of ids) if (!state.agents[target]) throw new Error(`Unknown peer: ${target}`);
  const ready = state.messages.filter(item => item.to === id && ids.includes(item.from) && item.kind !== "task" && item.state === "pending");
  if (ready.length) {
    for (const message of ready) message.state = "handled";
    return {waiting: false, messages: ready};
  }
  const tasks = Object.values(state.tasks).filter(task => task.requesterId === id && ids.includes(task.agentId));
  const pending = tasks.some(task => ["queued", "running", "waiting"].includes(task.status)) ||
    state.messages.some(message => message.from === id && ids.includes(message.to) && message.kind === "message" && message.state !== "handled");
  if (!pending && ids.every(target => ["idle", "stopped", "unavailable"].includes(state.agents[target].status))) {
    return {waiting: false, agents: ids.map(target => state.agents[target]), tasks};
  }
  agent.waitingOn = ids;
  return {waiting: true};
}
export function settlePeer(state: PeerState, id: string, runId: string, outcome: "completed" | "waiting" | "failed" | "cancelled", text: string): void {
  const agent = peer(state, id);
  if (agent.runId !== runId) return; // A duplicate/late completion must not settle a newer run.
  const message = state.messages.find(item => item.id === agent.activeMessageId);
  if (message) message.state = "handled";
  agent.activeMessageId = undefined;
  agent.status = outcome === "waiting" ? "waiting" : outcome === "cancelled" ? "stopped" : "idle";
  if (outcome !== "waiting") agent.waitingOn = undefined;
  if (agent.activeTaskId) {
    const task = state.tasks[agent.activeTaskId];
    if (outcome === "waiting") task.status = "waiting";
    else { finishTask(state, task, outcome, text); agent.activeTaskId = undefined; }
  }
  if (outcome !== "waiting") {
    for (const request of state.messages.filter(item => agent.replyToMessageIds?.includes(item.id))) {
      putPeerMessage(state, {id: `reply:${request.id}`, from: id, to: request.from,
        kind: "result", text, outcome, state: "pending", traceId: request.traceId});
    }
    agent.replyToMessageIds = undefined;
    for (const other of Object.values(state.agents)) if (other.waitingOn?.includes(id) &&
      !state.messages.some(message => message.to === other.id && message.from === id && message.kind === "result" && message.state === "pending")) {
      putPeerMessage(state, {id: `finished:${id}:${runId}:${other.id}`, from: id, to: other.id,
        kind: "result", text, outcome, state: "pending"});
    }
  }
  agent.runId = undefined;
}
