// Content-script orchestrator: spins up the shadow-DOM panel, keeps active
// skills in sync, and drives the ToolLoopAgent streaming loop.
//
// Closely mirrors uscardforum-qa's main.js so behaviour matches the reference:
//   • thinking indicator shown immediately on send, removed on first token /
//     reasoning / tool-call
//   • reasoning blocks open while streaming, finalize on text/tool-call
//   • tool cards de-dup: repeated calls to the same tool reuse the previous
//     "done" card (call count gets bumped to ×N)
//   • generation bar runs the whole time
//   • status bar shows "{n} step(s) · {tokens} tokens" when done
//   • abort handling: assistant text seen so far is preserved into the
//     conversation history before we mark the turn done
//   • conversation persistence: snapshot the running text on beforeunload
//
// xgoose-specific additions:
//   • passing a system reminder (URL, title, active skills, site memory,
//     todos) as the first user message of each turn
//   • API-key empty state when settings.apiKey is missing

/// <reference types="chrome" />

import { registerRouter, send } from "@/shared/messages";
import { track } from "@/shared/analytics";
import {
  clearResumeGlobal,
  deleteConversation,
  getConversation,
  getLastConvoIdGlobal,
  getLayout,
  getMemoryForOrigin,
  getSettings,
  isPanelOpenForOrigin,
  listConversations,
  loadAll,
  newConversationId,
  saveConversation,
  saveLayout,
  setLastConvoIdGlobal,
  setPanelOpenForOrigin,
} from "@/shared/storage";
import { getProviderApiKey } from "@/shared/types";
import { createPanel, type Panel } from "@xgoose/ui";
// Side-effect import: registers per-tool labels for skill_call, list_skills, …
import "./ui/toolLabels";
import { injectSkills, resetInjectedSkills } from "./skillInjector";
import { installBridgeLoader, installPageExecutor } from "@xgoose/page-controller";
import { callBridge } from "@/content/pageRpc";
import { chromeBridgeLoader } from "./hostPorts";
import {
  conversationFilename,
  conversationToMarkdown,
} from "@/shared/exportConversation";
import {
  getCurrentOrigin,
  getCurrentPageTitle,
  getCurrentPageUrl,
  setActiveSkills,
} from "./state";
import { createAgent } from "./agent/createAgent";
import {
  buildSystemReminder,
  clearTodos,
  costsFor,
  EMPTY_USAGE,
  getTodos as getCurrentTodos,
  priceTurn,
  recordTodos,
  subscribeTodos,
  type ConversationUsage,
  type TodoItem,
} from "@xgoose/core";

// Chrome MV3 ships `chrome.*` only — no browser polyfill needed.

if (location.protocol.startsWith("http")) {
  bootstrap().catch((err) => console.warn("[xgoose] bootstrap error", err));
}

async function bootstrap(): Promise<void> {
  // Install the page-controller's bridge-loader adapter before any tool
  // can dispatch `callBridge`. Idempotent; safe to call multiple times.
  installBridgeLoader(chromeBridgeLoader);
  installPageExecutor((op, payload) => op === "exec"
    ? send("sw:page_exec", payload)
    : send("sw:page_abort", { execId: typeof payload === "string" ? payload : payload.execId }));
  installOneClickSkillLinks();

  await loadAll();
  const panel = createPanel();
  const origin = getCurrentOrigin();

  // Apply saved layout (button position + panel size) before deciding whether
  // to open the panel, so it appears at the user's chosen spot/size.
  panel.applyLayout(getLayout());
  panel.onLayoutChange((next) => {
    void saveLayout(next);
  });

  if (origin && isPanelOpenForOrigin(origin)) panel.open();

  // Theme: follow user setting, fall back to system.
  const applyTheme = (): void => {
    const s = getSettings();
    if (s.theme === "system") {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      panel.setTheme(dark ? "dark" : "light");
    } else {
      panel.setTheme(s.theme);
    }
  };
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    applyTheme,
  );
  chrome.storage.onChanged.addListener(applyTheme);

  // Launcher visibility: when `settings.launcherVisibility === "skill-sites"`
  // the floating ✦ button is suppressed on pages with no matching skill. We
  // re-evaluate whenever the active-skill set changes (refreshSkills + the
  // `cs:set_active_skills` push) and whenever settings change. An open panel
  // is never hidden (enforced in the core panel).
  let lastActiveSkillCount = 0;
  const applyLauncherVisibility = (): void => {
    const s = getSettings();
    const visible =
      s.launcherVisibility !== "skill-sites" || lastActiveSkillCount > 0;
    panel.setLauncherVisible(visible);
  };
  applyLauncherVisibility();
  chrome.storage.onChanged.addListener(applyLauncherVisibility);

  panel.onOpen(async () => {
    track("panel_opened");
    if (origin) await setPanelOpenForOrigin(origin, true);
  });
  panel.onClose(async () => {
    track("panel_closed");
    if (origin) await setPanelOpenForOrigin(origin, false);
  });
  panel.onSettings(async () => {
    await send("sw:open_options", undefined);
  });

  // Skill chip menu actions: read / edit / disable / enable / publish.
  panel.onSkillAction(async (action, name) => {
    switch (action) {
      case "read": {
        const res = await send("sw:get_skill_source", { name });
        if (!res.ok) {
          panel.setStatus(`Couldn't read ${name}: ${res.error}`);
          return;
        }
        try {
          await navigator.clipboard?.writeText(res.source);
          panel.setStatus(`Copied ${name} source to clipboard (${res.origin})`);
        } catch {
          panel.setStatus(
            `${name} source loaded but clipboard refused; open settings to view.`,
          );
        }
        return;
      }
      case "edit": {
        await send("sw:open_options", undefined);
        panel.setStatus(`Open the Skills section and click Edit on ${name}.`);
        return;
      }
      case "disable": {
        await send("sw:set_skill_disabled", { name, disabled: true });
        panel.setStatus(
          `Disabled ${name}. Reload the page for it to fully detach.`,
        );
        await refreshSkills();
        return;
      }
      case "enable": {
        await send("sw:set_skill_disabled", { name, disabled: false });
        panel.setStatus(`Enabled ${name}.`);
        await refreshSkills();
        return;
      }
      case "publish": {
        // xgoose-extension-chrome does not ship the xgoose-web publish
        // backend yet. Edit + Save in the options page already produces a
        // usable user skill; publishing is a follow-up feature.
        panel.setStatus(
          `Publishing is not yet supported in xgoose-extension-chrome.`,
        );
        return;
      }
    }
  });

  // Active skills.
  const refreshSkills = async (): Promise<void> => {
    panel.setLoadingStatus("Loading skills…");
    try {
      const [active, all] = await Promise.all([
        send("sw:active_skills_for_url", { url: getCurrentPageUrl() }),
        send("sw:list_skills", undefined),
      ]);
      setActiveSkills(active);
      lastActiveSkillCount = active.length;
      applyLauncherVisibility();
      const meta = new Map(all.map((s) => [s.name, s]));
      panel.setSkills(
        active.map((s) => {
          const m = meta.get(s.name);
          return {
            name: s.name,
            namespace: s.namespace,
            userAuthored: !!m?.userAuthored,
            enabled: m?.enabled ?? true,
            activeOnThisPage: true,
          };
        }),
      );
      const skillActions: Array<{
        id?: string;
        label: string;
        prompt: string;
        js?: string;
      }> = [];
      for (const s of active) {
        for (const a of meta.get(s.name)?.actions ?? []) {
          if (a?.label && a?.prompt) skillActions.push(a);
        }
      }
      panel.setSkillActions(skillActions);
      if (active.length) await injectSkills(active);
    } finally {
      panel.setLoadingStatus(null);
    }
  };
  await refreshSkills();

  // Conversation state.
  let conversationMessages: any[] = [];
  let currentConvoId: string | null = null;
  let currentConvoTitle = "";
  let abortController: AbortController | null = null;
  let running = false;
  // Claude-Code-style prompt queue. Anything the user types while a turn is
  // in flight is parked here and drained automatically once the current
  // turn finishes. `agentLoopActive` covers the gap *between* turns in the
  // drain loop so concurrent submissions don't kick off a second loop.
  const queuedMessages: string[] = [];
  let agentLoopActive = false;
  // Per-conversation rolling token / cost / cache metrics. Webagent-style:
  // accumulated on every turn-end and persisted with the conversation so
  // history items keep their totals across reloads.
  let conversationUsage: ConversationUsage = { ...EMPTY_USAGE };

  // In-flight turn state, lifted to bootstrap scope so the `beforeunload`
  // handler and the navigation-detection branch in `runAgentTurn`'s
  // `tool-result` case can both snapshot the partial assistant + tool
  // messages BEFORE the page tears down. Without this, a js_exec-driven
  // navigation would lose its tool-call (and the navigation sentinel) from
  // the persisted conversation, because the AI SDK's `response.messages`
  // is only available at the end of the stream (line ~536) — which we
  // never reach if the page unloads first.
  //
  // `null` means no turn is currently running.
  type InFlightTurn = {
    fullText: string;
    toolNames: Map<string, string>;
    toolInputs: Map<string, unknown>;
    toolOutputs: Map<string, { output?: unknown; error?: string }>;
    navigatedTo: string | null;
  };
  let inFlight: InFlightTurn | null = null;

  // Snapshot the in-flight turn into `conversationMessages` as a proper
  // assistant-(text+tool-call) + tool-(tool-result) pair. Idempotent: clears
  // `inFlight` so a follow-up call (e.g. from `beforeunload` after the
  // navigation branch already snapshotted) is a no-op. Returns true iff it
  // appended anything.
  const snapshotInFlightToMessages = (): boolean => {
    if (!inFlight) return false;
    const captured = buildCapturedAssistantTurn({
      text: inFlight.fullText,
      toolNames: inFlight.toolNames,
      toolInputs: inFlight.toolInputs,
      toolOutputs: inFlight.toolOutputs,
    });
    inFlight = null;
    if (!captured.length) return false;
    conversationMessages.push(...captured);
    return true;
  };

  // Roll a single turn's provider-reported usage into `conversationUsage` and
  // push the fresh snapshot to the panel status bar. Called from the stream
  // `finish` path (and the navigation-abort path so resumed turns still
  // count). Pricing is best-effort; unknown models bump `unpricedTurns` so the
  // status bar can show a `*` next to the cost.
  const accumulateUsage = (
    u: {
      inputTokens?: number | null;
      outputTokens?: number | null;
      reasoningTokens?: number | null;
      cachedInputTokens?: number | null;
      totalTokens?: number | null;
    } | null,
  ): void => {
    if (!u || typeof u !== "object") {
      conversationUsage = {
        ...conversationUsage,
        turns: conversationUsage.turns + 1,
      };
      panel.setUsage(conversationUsage);
      return;
    }
    const inputTokens = Number(u.inputTokens ?? 0) || 0;
    const outputTokens = Number(u.outputTokens ?? 0) || 0;
    const reasoningTokens = Number(u.reasoningTokens ?? 0) || 0;
    const cachedInputTokens = Math.min(
      Math.max(0, Number(u.cachedInputTokens ?? 0) || 0),
      inputTokens,
    );
    const totalTokens =
      Number(u.totalTokens ?? 0) ||
      inputTokens + outputTokens + reasoningTokens;
    const s = getSettings();
    // Hosted is a virtual provider; its real wire format is OpenAI Chat
    // Completions through the xgoose gateway, so price it like openai-compat.
    const costProvider =
      s.provider === "xgoose-hosted" ? "openai-compat" : s.provider;
    const costs = costsFor(costProvider, s.model);
    const turnCost = costs
      ? priceTurn(costs, {
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningTokens,
        })
      : 0;
    conversationUsage = {
      inputTokens: conversationUsage.inputTokens + inputTokens,
      outputTokens: conversationUsage.outputTokens + outputTokens,
      reasoningTokens: conversationUsage.reasoningTokens + reasoningTokens,
      cachedInputTokens:
        conversationUsage.cachedInputTokens + cachedInputTokens,
      totalTokens: conversationUsage.totalTokens + totalTokens,
      turns: conversationUsage.turns + 1,
      costUsd: conversationUsage.costUsd + turnCost,
      unpricedTurns: conversationUsage.unpricedTurns + (costs ? 0 : 1),
    };
    panel.setUsage(conversationUsage);
  };

  // Show API-key empty state up front if missing — but skip for the
  // xgoose-hosted provider, which intentionally has no per-provider key
  // (auth comes from the signed-in account token at agent creation).
  {
    const s = getSettings();
    if (s.provider !== "xgoose-hosted" && !getProviderApiKey(s)) {
      panel.setApiKeyMissing(true, () => send("sw:open_options", undefined));
    }
  }

  const persistCurrentConvo = (snapshotMessages?: any[]): void => {
    if (!currentConvoId) return;
    const messages = snapshotMessages ?? conversationMessages;
    if (!messages.length) return;
    void saveConversation({
      id: currentConvoId,
      // We deliberately overwrite `origin` on every save with the *current*
      // page origin rather than the conversation's birth origin. A single
      // conversation can span multiple origins (the agent navigates as
      // part of its task); the history sidebar shows the most-recent
      // origin, which is the most useful "where am I" signal.
      origin: origin ?? "",
      title:
        currentConvoTitle ||
        (typeof messages[0]?.content === "string"
          ? String(messages[0].content).slice(0, 80)
          : "Untitled"),
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usage: conversationUsage,
    });
  };

  // On page tear-down (refresh, navigation, tab close): make sure the
  // running turn — if any — is captured into `conversationMessages` BEFORE
  // we persist. Without this, a js_exec navigation would drop its own
  // tool-call from the saved history, because `conversationMessages` only
  // gets the AI SDK's `response.messages` at the *end* of the stream
  // (which we won't reach if the page is unloading).
  window.addEventListener("beforeunload", () => {
    snapshotInFlightToMessages();
    persistCurrentConvo();
  });
  // Same handler under `pagehide` for iOS Safari, where `beforeunload`
  // sometimes doesn't fire on link clicks / BFCache transitions.
  window.addEventListener("pagehide", () => {
    snapshotInFlightToMessages();
    persistCurrentConvo();
  });

  // Each document starts a fresh session. History is opened explicitly.
  const checkpoint = window.setInterval(() => {
    if (!running || !inFlight) return;
    persistCurrentConvo([...conversationMessages, ...buildCapturedAssistantTurn({
      text: inFlight.fullText, toolNames: inFlight.toolNames,
      toolInputs: inFlight.toolInputs, toolOutputs: inFlight.toolOutputs,
    })]);
  }, 1000);
  window.addEventListener("pagehide", () => {
    window.clearInterval(checkpoint);
    abortController?.abort(new Error("document_closed"));
  }, { once: true });

  panel.onNew(async () => {
    if (running) abortController?.abort(new Error("user_abort"));
    snapshotInFlightToMessages();
    persistCurrentConvo();
    currentConvoId = null;
    currentConvoTitle = "";
    conversationMessages = [];
    conversationUsage = { ...EMPTY_USAGE };
    clearTodos();
    panel.clear();
    panel.setStatus("");
    panel.setUsage(conversationUsage);
    await setLastConvoIdGlobal("");
    // Clear the pre-written resume marker too — otherwise a navigation
    // shortly after "New" would auto-resume the OLD conversation.
    try {
      await clearResumeGlobal();
      console.info("[xgoose:resume] cleared on new conversation");
    } catch (e) {
      console.warn("[xgoose:resume] clear on new failed", e);
    }
  });

  panel.onStop(() => {
    abortController?.abort(new Error("user_abort"));
    // Stop = halt everything: also clear pending queue so it doesn't
    // auto-process after this turn unwinds. If the user wanted the queue
    // to keep going they would have just let the current turn finish.
    if (queuedMessages.length) {
      queuedMessages.length = 0;
      panel.setQueuedMessages([]);
    }
    // Stop also clears the pre-written resume marker so the agent does
    // NOT auto-continue if the page happens to navigate shortly after.
    void clearResumeGlobal().then(
      () => console.info("[xgoose:resume] cleared on user stop"),
      (e) => console.warn("[xgoose:resume] clear on stop failed", e),
    );
  });

  panel.onCancelQueued((index) => {
    if (index < 0 || index >= queuedMessages.length) return;
    queuedMessages.splice(index, 1);
    panel.setQueuedMessages([...queuedMessages]);
  });

  // ── Todos: dedicated UI ──
  // Mirror the agent's in-memory todo store into the panel. `subscribeTodos`
  // fires once immediately on subscription so the initial render is correct
  // even before any `todo_write` call, and every subsequent recordTodos /
  // clearTodos triggers the listener — so the panel stays live while the
  // agent edits its list mid-turn.
  subscribeTodos((items) => {
    panel.setTodos(items);
  });

  // Manual cycling: when the user taps a todo's status circle the panel
  // proposes the next status. We enforce the single-in_progress invariant
  // (and demote any prior in_progress to pending) before writing back.
  panel.onTodoToggle((id, nextStatus) => {
    const current = getCurrentTodos();
    const next = current.map((t): TodoItem => {
      if (t.id === id) return { ...t, status: nextStatus };
      if (nextStatus === "in_progress" && t.status === "in_progress") {
        return { ...t, status: "pending" };
      }
      return t;
    });
    recordTodos(next);
  });

  panel.onTodoClear(() => {
    clearTodos();
  });

  // History sidebar.
  const refreshHistory = async (): Promise<void> => {
    const list = await listConversations();
    panel.setHistory(
      list.map((c) => ({
        id: c.id,
        title: c.title,
        origin: c.origin,
        updatedAt: c.updatedAt || c.createdAt,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
        current: c.id === currentConvoId,
      })),
    );
  };
  panel.onHistory(() => {
    void refreshHistory();
  });
  panel.onLoadConversation(async (id) => {
    if (running) abortController?.abort(new Error("user_abort"));
    snapshotInFlightToMessages();
    persistCurrentConvo();
    const convo = await getConversation(id);
    if (!convo) return;
    currentConvoId = newConversationId();
    currentConvoTitle = convo.title;
    conversationMessages = (convo.messages as any[]) ?? [];
    conversationUsage = convo.usage
      ? { ...EMPTY_USAGE, ...convo.usage }
      : { ...EMPTY_USAGE };
    replayConversation(panel, conversationMessages);
    replayTodosFromMessages(conversationMessages);
    panel.setStatus(`Loaded: ${convo.title}`);
    panel.setUsage(conversationUsage);
    void setLastConvoIdGlobal(convo.id);
  });
  panel.onDeleteConversation(async (id) => {
    await deleteConversation(id);
    if (id === currentConvoId) {
      currentConvoId = null;
      currentConvoTitle = "";
      conversationMessages = [];
      conversationUsage = { ...EMPTY_USAGE };
      clearTodos();
      panel.clear();
      panel.setStatus("");
      panel.setUsage(conversationUsage);
      await setLastConvoIdGlobal("");
    }
    await refreshHistory();
  });

  panel.onExportConversation(async (id) => {
    // If the user is exporting the conversation they're actively chatting in,
    // capture the current in-flight turn (if any) into the persisted history
    // so the exported markdown reflects what's on-screen right now, not the
    // last fully-persisted state.
    if (id === currentConvoId) {
      snapshotInFlightToMessages();
      persistCurrentConvo();
    }
    const convo = await getConversation(id);
    if (!convo) {
      panel.setStatus("Export failed: conversation not found");
      return;
    }
    const md = conversationToMarkdown(convo);
    const filename = conversationFilename(convo, "md");
    await deliverExport(md, filename, panel);
  });

  panel.onReplyPost(async (raw, replyTo) => {
    // Generic v1 behaviour: copy raw to clipboard. Skills can later override
    // this by exposing `xgoose.skills.<ns>.postReply(raw, replyTo)` and the
    // content script can be enhanced to detect+invoke it.
    await navigator.clipboard?.writeText(raw);
    panel.setStatus(`Reply copied${replyTo ? ` (to #${replyTo})` : ""}`);
  });

  // ── unified agent-turn driver ──
  //
  // Pulled out of the previous inline `onSend` handler so the same flow can
  // be invoked two ways:
  //   • { hidden:false }  – normal user turn from the chat input
  //   • { hidden:true  }  – continuation after a js_exec-driven page
  //                          navigation (the new page bootstraps and triggers
  //                          this with a <system-reminder> prompt; we suppress
  //                          adding a user bubble so the UI stays clean).
  async function runAgentTurn(
    prompt: string,
    opts: { hidden?: boolean } = {},
  ): Promise<void> {
    if (running) return;
    const settings = getSettings();
    // Hosted provider: account-token auth, handled inside createAgent.
    // Every other provider needs an explicit per-provider API key.
    if (settings.provider !== "xgoose-hosted" && !getProviderApiKey(settings)) {
      track("panel_api_key_empty_state_shown", { provider: settings.provider });
      panel.setApiKeyMissing(true, () => send("sw:open_options", undefined));
      return;
    }

    if (!opts.hidden) {
      track("chat_message_sent", {
        provider: settings.provider,
        model: settings.model,
        is_fresh_convo: !currentConvoId,
        prompt_len: prompt.length,
      });
    }

    const isFreshConversation = !currentConvoId;
    if (!currentConvoId) {
      currentConvoId = newConversationId();
      currentConvoTitle = prompt.slice(0, 80);
    }
    const visibleUserMessage = { role: "user", content: prompt };
    conversationMessages.push(visibleUserMessage);
    // For brand-new conversations we MUST flush the "last conversation"
    // pointer + the initial save to storage BEFORE any tool can navigate
    // the tab — otherwise the new page's bootstrap can't restore the
    // conversation that the resume marker points at (resume.convoId !==
    // currentConvoId on reload → resume silently skipped). For continuing
    // conversations these are already in storage from prior turns, so we
    // fall back to the fast fire-and-forget path.
    if (isFreshConversation && currentConvoId) {
      try {
        await setLastConvoIdGlobal(currentConvoId);
        await saveConversation({
          id: currentConvoId,
          origin: origin ?? "",
          title: currentConvoTitle || prompt.slice(0, 80) || "Untitled",
          messages: conversationMessages,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          usage: conversationUsage,
        });
      } catch (e) {
        console.warn("[xgoose] initial conversation persist failed", e);
      }
    } else {
      persistCurrentConvo();
    }

    if (!opts.hidden) panel.addUserMessage(prompt);
    panel.setSending(true);
    panel.setStatus("");
    panel.setGenerating(true);
    panel.setLoadingStatus(
      opts.hidden ? "Continuing on new page…" : "Thinking…",
    );
    panel.showThinking(opts.hidden ? "Continuing on new page…" : "Thinking…");
    running = true;
    abortController = new AbortController();

    let stepCount = 0;
    // Error text shown this turn (in-stream `error` part). Persisted into the
    // conversation as an `xgoose-error` message so it survives reload.
    let turnErrorDisplay: string | null = null;
    let assistantBubble: ReturnType<Panel["addAssistantBubble"]> | null = null;
    let reasoningBlock: ReturnType<Panel["addReasoningBlock"]> | null = null;
    // UI ref map — separate from the lifted `inFlight.*` because cards never
    // need to survive a navigation snapshot.
    const toolCards = new Map<string, ReturnType<Panel["addToolCard"]>>();

    // Initialise the bootstrap-scope in-flight slot for this turn. From this
    // point on, all "what did this turn produce so far" data lives in
    // `inFlight.*` so `beforeunload` / `pagehide` / the navigation branch
    // below can snapshot it atomically.
    inFlight = {
      fullText: "",
      toolNames: new Map(),
      toolInputs: new Map(),
      toolOutputs: new Map(),
      navigatedTo: null,
    };
    // Whether `snapshotInFlightToMessages()` already pushed the partial turn
    // (e.g. from the navigation branch in `tool-result`). The `catch` /
    // `finally` blocks check this so they don't push it again.
    let snapshotted = false;

    try {
      const skillsForReminder = (
        await send("sw:active_skills_for_url", { url: getCurrentPageUrl() })
      ).map((s) => ({ ...s, enabled: true }));

      const baseReminder = buildSystemReminder({
        pageUrl: getCurrentPageUrl(),
        pageTitle: getCurrentPageTitle(),
        activeSkills: skillsForReminder,
        todos: getCurrentTodos(),
        siteMemory: origin ? getMemoryForOrigin(origin) : null,
        siteMemoryOrigin: origin,
      });
      const reminder =
        baseReminder +
        sourceGroundedToolUseReminder(prompt, skillsForReminder.length > 0);

      // Heal any orphaned tool-call / tool-result parts that survived from a
      // previous navigation-interrupted turn. Without this, the AI SDK's
      // Zod validation rejects the conversation with "Invalid prompt: The
      // messages do not match the ModelMessage[] schema." and the user
      // has no way to recover except deleting the conversation.
      const messagesForModel = conversationMessages;
      const { sanitized: cleanMessages, healed } = sanitizeMessages(messagesForModel);
      if (healed > 0) {
        console.info(
          "[xgoose:sanitize] healed",
          healed,
          "orphan tool part(s) before send",
          {
            convoId: currentConvoId,
            messages: conversationMessages.length,
          },
        );
      }

      // Cache-friendly: the <system-reminder> rides on `instructions` rather
      // than being spliced into the message list. Splicing it before the last
      // user message looked clever but stranded the previous turn's reminder
      // at a position that no longer existed in the next turn — the model
      // input diverged from the prior turn's prefix at exactly that spot, so
      // none of the assistant/tool history past that point could ever cache.
      // With the reminder in `instructions`, the entire history is a stable
      // suffix as long as the reminder content itself is stable (which is the
      // common case: user stays on one page, same skills, no todo churn).
      // Reminder content changes (navigation, new todos, new memory) DO
      // invalidate the whole prefix — but that was already true before, and
      // those events are rare relative to "user types another question".
      const bundle = await createAgent({ settings, reminder });
      const runId = crypto.randomUUID();
      const sessionId = currentConvoId!;
      bundle.agent.subscribe(async event => {
        if (event.type === "text-delta" || event.type === "reasoning-delta") return;
        await send("sw:session", { op: "event", value: { id: crypto.randomUUID(), sessionId, runId, at: Date.now(), event } });
      });
      const result = await bundle.agent.stream({
        messages: cleanMessages,
        abortSignal: abortController.signal,
      });

      for await (const part of result.fullStream as AsyncIterable<any>) {
        switch (part.type) {
          case "start-step": {
            stepCount++;
            if (reasoningBlock) {
              reasoningBlock.finalize();
              reasoningBlock = null;
            }
            // After the first step we keep accumulating into the same bubble,
            // exactly like main.js: reset the in-flight bubble so a follow-up
            // assistant turn lives in its own bubble.
            if (stepCount > 1) {
              panel.removeThinking();
              assistantBubble = null;
              if (inFlight) inFlight.fullText = "";
            }
            break;
          }
          case "reasoning-start": {
            panel.removeThinking();
            reasoningBlock = panel.addReasoningBlock();
            break;
          }
          case "reasoning-delta": {
            panel.removeThinking();
            if (!reasoningBlock) reasoningBlock = panel.addReasoningBlock();
            reasoningBlock.appendDelta(part.text ?? "");
            break;
          }
          case "reasoning-end": {
            if (reasoningBlock) {
              reasoningBlock.finalize();
              reasoningBlock = null;
            }
            break;
          }
          case "text-delta": {
            panel.removeThinking();
            if (reasoningBlock) {
              reasoningBlock.finalize();
              reasoningBlock = null;
            }
            if (!assistantBubble) assistantBubble = panel.addAssistantBubble();
            if (inFlight) inFlight.fullText += part.text ?? "";
            const t = inFlight?.fullText ?? "";
            assistantBubble.updateMarkdown(cleanAssistantText(t));
            panel.setLoadingStatus(`Streaming · ${t.length} chars`);
            break;
          }
          case "tool-call": {
            panel.removeThinking();
            if (reasoningBlock) {
              reasoningBlock.finalize();
              reasoningBlock = null;
            }
            const name = String(part.toolName);
            const input = part.input;
            if (inFlight) {
              inFlight.toolInputs.set(part.toolCallId, input);
              inFlight.toolNames.set(part.toolCallId, name);
            }
            const card = panel.addToolCard(name, input);
            toolCards.set(part.toolCallId, card);
            panel.setLoadingStatus(`Calling ${name}…`);
            break;
          }
          case "tool-result": {
            const card = toolCards.get(part.toolCallId);
            if (card) card.setResult(part.output);
            if (inFlight) {
              inFlight.toolOutputs.set(part.toolCallId, {
                output: part.output,
              });
            }
            // Navigation sentinel: stop at the current page boundary. Persist
            // the partial turn, but do not schedule work on the next page.
            const navUrl = extractNavigatedUrl(part.output);
            if (navUrl !== null) {
              const navTarget = navUrl || getCurrentPageUrl();
              if (inFlight) inFlight.navigatedTo = navTarget;
              panel.setLoadingStatus("Navigation detected; stopping turn.");
              snapshotInFlightToMessages();
              snapshotted = true;
              if (currentConvoId) {
                try {
                  await saveConversation({
                    id: currentConvoId,
                    origin: origin ?? "",
                    title:
                      currentConvoTitle ||
                      (typeof conversationMessages[0]?.content === "string"
                        ? String(conversationMessages[0].content).slice(0, 80)
                        : "Untitled"),
                    messages: conversationMessages,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    usage: conversationUsage,
                  });
                } catch (e) {
                  console.warn("[xgoose] nav persist failed", e);
                }
              }
              // Stop the stream — any further fetch from the AI SDK will fail
              // once the page unloads anyway, so end it cleanly here.
              abortController?.abort(new Error("xgoose_navigation"));
            } else {
              panel.setLoadingStatus(`Streaming response…`);
            }
            break;
          }
          case "tool-error": {
            const card = toolCards.get(part.toolCallId);
            if (card) {
              const msg =
                part.error?.message ??
                (typeof part.error === "string" ? part.error : "tool error");
              card.setResult(undefined, String(msg));
            }
            const msg2 =
              part.error?.message ??
              (typeof part.error === "string" ? part.error : "tool error");
            if (inFlight) {
              inFlight.toolOutputs.set(part.toolCallId, {
                error: String(msg2),
              });
            }
            break;
          }
          case "error": {
            panel.removeThinking();
            const errText = describeTurnError(part.error);
            turnErrorDisplay = `Error: ${errText}`;
            panel.addErrorMessage(turnErrorDisplay);
            break;
          }
        }
      }

      panel.removeThinking();
      assistantBubble?.finalize();
      if (reasoningBlock) {
        reasoningBlock.finalize();
        reasoningBlock = null;
      }

      const response = await Promise.resolve(result.response).catch(() => null);
      const usage = await Promise.resolve(result.usage).catch(() => null);
      if (response?.messages) {
        renderMissingToolCardsFromMessages(response.messages, toolCards);
        conversationMessages.push(...response.messages);
        // AI SDK already gave us a canonical message list; the partial
        // mirror in `inFlight` would just duplicate it, so drop it.
        inFlight = null;
        snapshotted = true;
      } else {
        // No `response.messages` (older SDK / mid-stream error path): fall
        // back to the partial we captured into `inFlight`.
        if (snapshotInFlightToMessages()) snapshotted = true;
      }

      // Persist an in-stream error into history so it's visible after reload.
      if (turnErrorDisplay) {
        conversationMessages.push({
          role: "xgoose-error",
          content: turnErrorDisplay,
        });
      }

      accumulateUsage(usage as any);
      panel.setStatus(`${stepCount} step${stepCount === 1 ? "" : "s"}`);
      track("chat_turn_finished", {
        steps: stepCount,
        provider: getSettings().provider,
        model: getSettings().model,
      });

      void clearResumeGlobal().catch((e) =>
        console.warn("[xgoose:resume] stale clear failed", e),
      );
    } catch (err: any) {
      panel.removeThinking();
      if (err?.name === "AbortError" || abortController?.signal?.aborted) {
        // Navigation-triggered abort vs user-Stop abort. In both cases we keep
        // the partial transcript, but never resume automatically on another
        // page.
        const wasNav = snapshotted; // tool-result nav branch set this true
        if (!wasNav) {
          if (snapshotInFlightToMessages()) snapshotted = true;
        }
        // Aborted turns don't reach the stream `finish` event, so we never get
        // a `result.usage` for them. We still bump the turn counter (so
        // history math stays consistent) but can't credit tokens or cost.
        accumulateUsage(null);
        panel.setStatus(wasNav ? "Navigation stopped the turn" : "Stopped");
        track(wasNav ? "chat_turn_navigated" : "chat_turn_stopped_by_user", {
          steps: stepCount,
        });
      } else {
        // True error path: still try to preserve partial work so the user
        // doesn't lose context, then surface the error. We also forward
        // the original Error to the browser console — the panel only
        // renders the stringified message, so without this the stack
        // (and the cause chain for AI SDK errors) is lost.
        if (!snapshotted) snapshotInFlightToMessages();
        // The panel UI only renders the top message; for AI SDK errors
        // the actual root cause lives in `err.cause` (and sometimes
        // `err.cause.cause`), so walk it out into the console log.
        const causeChain: unknown[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cur: any = err?.cause;
        while (cur && causeChain.length < 5) {
          causeChain.push({
            name: cur?.name,
            message: cur?.message ?? String(cur),
            stack: cur?.stack,
          });
          cur = cur?.cause;
        }
        console.error("[xgoose] turn failed", err, { causes: causeChain });
        track("chat_turn_failed", {
          steps: stepCount,
          provider: getSettings().provider,
          model: getSettings().model,
          error_kind: String(err?.name ?? "Error").slice(0, 40),
        });
        const errDisplay = `Error: ${describeTurnError(err)}`;
        panel.addErrorMessage(errDisplay);
        // Persist into history so the error is still visible after reload.
        conversationMessages.push({ role: "xgoose-error", content: errDisplay });
        panel.setStatus("");
      }
    } finally {
      assistantBubble?.finalize();
      abortController = null;
      running = false;
      // Always clear the in-flight slot — any data we wanted to keep has
      // already been snapshotted into `conversationMessages` by one of the
      // branches above (or by the eager navigation path inside `tool-result`).
      inFlight = null;

      // Persist conversation. If we navigated, the eager branch above
      // already did this — but a second write is harmless (idempotent
      // overwrite) and covers the non-nav success / abort / error paths.
      persistCurrentConvo();

      panel.setSending(false);
      panel.setGenerating(false);
      panel.setLoadingStatus(null);
    }
  }

  function renderMissingToolCardsFromMessages(
    messages: any[],
    liveCards: Map<string, ReturnType<Panel["addToolCard"]>>,
  ): void {
    for (const msg of messages) {
      if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part?.type !== "tool-call") continue;
        const callId = String(part.toolCallId ?? part.id ?? "");
        if (!callId || liveCards.has(callId)) continue;
        const card = panel.addToolCard(
          String(part.toolName ?? part.name ?? "tool"),
          part.input ?? part.args ?? {},
        );
        liveCards.set(callId, card);
      }
    }
    for (const msg of messages) {
      if (msg?.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part?.type !== "tool-result") continue;
        const callId = String(part.toolCallId ?? "");
        const card = liveCards.get(callId);
        if (!card) continue;
        const output = denormalizeToolOutput(part.output);
        if (part.output?.type === "error-text" || part.output?.type === "error-json") {
          card.setResult(undefined, String(output ?? "tool error"));
        } else {
          card.setResult(output);
        }
      }
    }
  }

  function describeTurnError(err: any): string {
    const parts: string[] = [];
    const push = (v: unknown): void => {
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
    };
    push(err?.message);
    push(err?.name);
    push(err?.cause?.message);
    push(err?.cause?.name);
    push(err?.cause?.responseBody);
    push(err?.cause?.statusCode ? `HTTP ${err.cause.statusCode}` : "");
    if (!parts.length) push(String(err ?? "Unknown error"));
    const msg = parts.find((p) => p && p !== "Error") ?? "Unknown AI error";
    return msg.slice(0, 1000);
  }

  function sourceGroundedToolUseReminder(
    prompt: string,
    hasActiveSkills: boolean,
  ): string {
    if (!hasActiveSkills) return "";
    if (!/(美卡论坛|论坛|帖子|DP|data point|搜索|结合|根据当前|当前页面)/i.test(prompt)) {
      return "";
    }
    return (
      "\n\n# Per-turn source-grounding requirement\n" +
      "This user request explicitly asks for forum/site-grounded information. " +
      "You MUST make at least one tool call before answering. Because active " +
      "skills are available on this page, use `js_exec` to call the relevant " +
      "`xgoose.skills.<ns>.<fn>()` helper (or `read_page` for current-page-only " +
      "summaries). Do not answer from memory and do not emit a generic refusal."
    );
  }

  // Claude-Code-style send-or-queue. While the agent is mid-turn, any
  // prompt the user submits is appended to `queuedMessages` and shown as a
  // pill above the input; the drain loop below picks them up between
  // turns. `agentLoopActive` covers the brief gap *between* runAgentTurn
  // calls, so a second onSend can't accidentally start a parallel loop.
  async function processQueue(initial?: string): Promise<void> {
    if (agentLoopActive) {
      if (initial && initial.trim()) {
        queuedMessages.push(initial);
        panel.setQueuedMessages([...queuedMessages]);
      }
      return;
    }
    agentLoopActive = true;
    try {
      if (initial && initial.trim()) {
        await runAgentTurn(initial, { hidden: false });
      }
      // Drain anything the user queued while we were running. Joining
      // multiple queued items with a blank line keeps them as a single
      // follow-up turn so the agent can reason about them together
      // (most users queue "and also check X" / "do Y next" style adds).
      while (queuedMessages.length > 0) {
        const batch = queuedMessages.splice(0, queuedMessages.length);
        panel.setQueuedMessages([]);
        const joined = batch.join("\n\n");
        await runAgentTurn(joined, { hidden: false });
      }
    } finally {
      agentLoopActive = false;
    }
  }

  panel.onSend((prompt) => {
    void processQueue(prompt);
  });

  panel.onSkillActionRun(async (action) => {
    if (!action.js) {
      void processQueue(action.prompt);
      return;
    }
    panel.addUserMessage(action.label);
    panel.setLoadingStatus("Running action…");
    let resultText = "";
    try {
      const res = (await callBridge("exec", {
        code: action.js,
        args: [],
        timeoutMs: getSettings().jsExecTimeoutMs,
        execId: Math.random().toString(36).slice(2, 12),
      })) as { ok: boolean; result?: unknown; error?: string };
      resultText = res.ok
        ? JSON.stringify(res.result ?? null)
        : `ERROR: ${res.error ?? "exec failed"}`;
    } catch (e: any) {
      resultText = `ERROR: ${e?.message ?? String(e)}`;
    } finally {
      panel.setLoadingStatus(null);
    }
    if (resultText.length > 8000) {
      resultText = resultText.slice(0, 8000) + "…(truncated)";
    }
    const composed =
      `${action.prompt}\n\n` +
      `<action-result label=${JSON.stringify(action.label)}>\n${resultText}\n</action-result>`;
    void runAgentTurn(composed, { hidden: true });
  });

  // Cross-page auto-resume is disabled. Drop any marker left by older builds so
  // a navigation never restarts work on the next page.
  try {
    await clearResumeGlobal();
  } catch (e) {
    console.warn("[xgoose:resume] stale clear failed", e);
  }

  // SW push messages.
  registerRouter({
    "cs:set_active_skills": async ({ skills }) => {
      setActiveSkills(skills);
      lastActiveSkillCount = skills.length;
      applyLauncherVisibility();
      // We can't await `sw:list_skills` here without breaking the message
      // round-trip's synchronous reply contract; surface the minimal chip
      // info now and let the next `refreshSkills` (which DOES enrich) catch
      // up. Worst case the chip just lacks the user-authored badge briefly.
      panel.setSkills(
        skills.map((s) => ({
          name: s.name,
          namespace: s.namespace,
          enabled: true,
          activeOnThisPage: true,
        })),
      );
      // CROSS-ORIGIN race guard: if `webNavigation.onCompleted` fires
      // during an in-flight agent turn (typical for cross-origin resume
      // where the new page is still finishing its initial load while
      // the agent is making its first tool calls), `resetInjectedSkills`
      // would create a brief window where `xgoose.skills.<ns>` is
      // undefined and any in-flight `skill_call` throws. Skip the reset
      // mid-turn; the cache stays warm and the next idle moment can
      // rebundle. Skill source-code edits during a turn already require
      // a page reload to take effect.
      if (running) {
        {
          panel.setLoadingStatus(
            `Loading ${skills.length} skill${skills.length === 1 ? "" : "s"}…`,
          );
          try {
            await injectSkills(skills);
          } finally {
            panel.setLoadingStatus(null);
          }
        }
        return;
      }
      // Reset the injected-skill cache so that user-skill edits (which keep
      // the same name but mutated code) actually take effect; bundled skills
      // are content-addressed by URL so re-injecting them is a no-op anyway.
      resetInjectedSkills();
      if (skills.length) {
        panel.setLoadingStatus(
          `Loading ${skills.length} skill${skills.length === 1 ? "" : "s"}…`,
        );
        try {
          await injectSkills(skills);
        } finally {
          panel.setLoadingStatus(null);
        }
      }
    },
    "cs:toggle_panel": () => {
      panel.toggle();
    },
  });
}

function installOneClickSkillLinks(): void {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const a = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      const sourceUrl = xgooseInstallSourceUrl(a);
      if (!sourceUrl) return;
      event.preventDefault();
      event.stopPropagation();
      a.setAttribute("aria-busy", "true");
      void send("sw:open_install_url", {
        sourceUrl,
        originUrl: location.href,
      }).then((res) => {
        if (!res.ok) {
          a.removeAttribute("aria-busy");
          console.warn("[xgoose] install open failed", res.error);
          location.href = sourceUrl;
        }
      });
    },
    true,
  );
}

function xgooseInstallSourceUrl(a: HTMLAnchorElement): string | null {
  const explicit = a.dataset.xgooseInstallUrl || a.dataset.xgooseSkillUrl;
  const raw = explicit || a.href;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    return null;
  }
  if (!/\.xgs\.js$/i.test(url.pathname)) return null;
  const host = url.hostname.toLowerCase();
  if (
    !(
      host === "api.xgoose.org" ||
      host === "xgoose.org" ||
      host.endsWith(".xgoose.org")
    )
  ) {
    return null;
  }
  return url.toString();
}

// ── conversation replay ──

/**
 * AI SDK v5's `toolResultPartSchema` requires `output` to be a discriminated
 * union: `{ type: 'text' | 'json' | 'error-text' | 'error-json' | ..., value }`.
 * The SDK's own `response.messages` always emits this shape, but our
 * inflight-snapshot path stored the raw value coming out of the stream's
 * `tool-result` event (e.g. the literal string `"ok"` or a plain object),
 * which fails Zod validation with "The messages do not match the
 * ModelMessage[] schema." on the *next* turn's send. This helper wraps any
 * raw value into the proper v5 envelope (and is idempotent when called on
 * an already-wrapped value).
 */
function isV5OutputEnvelope(o: unknown): boolean {
  if (!o || typeof o !== "object") return false;
  const t = (o as { type?: unknown }).type;
  return (
    t === "text" ||
    t === "json" ||
    t === "error-text" ||
    t === "error-json" ||
    t === "execution-denied" ||
    t === "content"
  );
}

function normalizeToolOutput(raw: unknown): {
  type:
    | "text"
    | "json"
    | "error-text"
    | "error-json"
    | "execution-denied"
    | "content";
  value?: unknown;
} {
  if (isV5OutputEnvelope(raw)) return raw as any;
  if (raw === undefined || raw === null) return { type: "text", value: "" };
  if (typeof raw === "string") return { type: "text", value: raw };
  // Everything else (object / array / number / boolean) goes through as JSON.
  return { type: "json", value: raw };
}

function denormalizeToolOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { type?: unknown; value?: unknown };
  if (typeof obj.type !== "string") return raw;
  if ("value" in obj) return obj.value;
  return raw;
}

function cleanAssistantText(text: string): string {
  // Some OpenAI-compatible/Gemini gateways occasionally surface tool-result
  // adapter artifacts as plain text after the real answer. Tool cards already
  // render those results, so hide the artifact from the user-facing answer.
  return text
    .replace(/\n?\[Tool result for[^\]]*\]:[\s\S]*$/m, "")
    .replace(/\n?\[Assistant\]:\s*/g, "\n")
    .trimEnd();
}

/**
 * Heal a persisted message list so it satisfies the AI SDK v5
 * `ModelMessage[]` Zod schema. We hit several invalid shapes in practice:
 *
 *   • An assistant `tool-call` part whose `toolCallId` is never matched by
 *     a `tool-result` in the next `tool` message — "orphan tool-call".
 *   • A `tool` message containing a `tool-result` whose `toolCallId` doesn't
 *     match any preceding `tool-call` — "orphan tool-result".
 *   • A legacy `{ type: 'tool-error', error: '...' }` part anywhere — the v5
 *     schema has no such part. Errors live inside a `tool-result` with
 *     `output: { type: 'error-text', value: '...' }`.
 *   • A `tool-result` whose `output` is a raw string / object instead of
 *     the `{ type, value }` envelope — produced by the inflight-snapshot
 *     path before this helper existed.
 *
 * Strategy: normalise every `tool-result` `output` into the v5 envelope,
 * rewrite legacy `tool-error` parts into proper `tool-result`s with
 * `error-text` output, synthesise the same shape for orphaned tool-calls,
 * and drop orphan `tool-result` parts. The synthetic message tells the
 * agent what happened so it can continue.
 *
 * Returns the cleaned list and a `healed` count so the caller can surface
 * a console log if anything was rewritten.
 */
function sanitizeMessages(messages: any[]): {
  sanitized: any[];
  healed: number;
} {
  let healed = 0;
  const out: any[] = [];
  let pending: Map<string, string> | null = null;

  const flushPending = (): void => {
    if (!pending || pending.size === 0) {
      pending = null;
      return;
    }
    const content = [...pending.entries()].map(([callId, toolName]) => ({
      type: "tool-result",
      toolCallId: callId,
      toolName,
      output: {
        type: "error-text",
        value:
          "Tool execution was interrupted (likely a page navigation tore down " +
          "the previous content script); no result was captured. The page may " +
          "now be at a different URL — re-inspect with `page_info` if needed.",
      },
    }));
    out.push({ role: "tool", content });
    healed += pending.size;
    pending = null;
  };

  // Normalize an individual tool-message part (or assistant inline tool-result
  // part) into a valid v5 tool-result shape. Returns `null` if the part is
  // not a recognised tool-message part (we drop those at the call site).
  const normalizeToolPart = (
    part: any,
    toolNameFallback?: string,
  ): any | null => {
    if (!part || typeof part !== "object") return null;
    if (part.type === "tool-result") {
      const out: any = {
        ...part,
        type: "tool-result",
        toolCallId: String(part.toolCallId ?? ""),
        toolName: String(part.toolName ?? toolNameFallback ?? "tool"),
        output: normalizeToolOutput(part.output),
      };
      return out;
    }
    if (part.type === "tool-error") {
      // Legacy/our-own shape — convert to v5 tool-result.error-text.
      let errVal: string;
      const e = part.error;
      if (typeof e === "string") errVal = e;
      else if (
        e &&
        typeof e === "object" &&
        typeof (e as any).message === "string"
      ) {
        errVal = String((e as any).message);
      } else errVal = String(e ?? "unknown error");
      return {
        type: "tool-result",
        toolCallId: String(part.toolCallId ?? ""),
        toolName: String(part.toolName ?? toolNameFallback ?? "tool"),
        output: { type: "error-text", value: errVal },
      };
    }
    return null;
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    // UI-only error markers are persisted in history but must never be sent
    // to the model.
    if (msg.role === "xgoose-error") {
      flushPending();
      continue;
    }

    if (msg.role === "assistant") {
      flushPending();
      const next = new Map<string, string>();
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (
            part?.type === "tool-call" &&
            typeof part.toolCallId === "string"
          ) {
            next.set(
              part.toolCallId,
              String(part.toolName ?? part.name ?? "tool"),
            );
          }
        }
      }
      pending = next;
      out.push(msg);
    } else if (msg.role === "tool") {
      if (!pending) {
        healed++;
        continue;
      }
      const validParts: any[] = [];
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          const callId = part?.toolCallId;
          if (typeof callId !== "string" || !pending.has(callId)) {
            healed++;
            continue;
          }
          const toolName = pending.get(callId)!;
          const normalized = normalizeToolPart(part, toolName);
          if (!normalized) {
            healed++;
            continue;
          }
          // Detect whether we rewrote anything (orig → normalized differs in
          // shape: legacy `tool-error` part, or raw `output` not in v5
          // envelope).
          const wasRewritten =
            part.type === "tool-error" || !isV5OutputEnvelope(part.output);
          if (wasRewritten) healed++;
          validParts.push(normalized);
          pending.delete(callId);
        }
      }
      if (validParts.length) {
        out.push({ ...msg, content: validParts });
      }
      if (pending.size === 0) pending = null;
    } else {
      flushPending();
      out.push(msg);
    }
  }
  flushPending();
  return { sanitized: out, healed };
}

/**
 * Walk the persisted message history backwards looking for the most recent
 * `todo_write` tool call, and seed the in-memory todo store with its input.
 * Falls back to `clearTodos()` when nothing matches so the panel doesn't
 * show stale items from a previous conversation.
 *
 * The matching shape — assistant messages with `content[].type === 'tool-call'`
 * carrying `toolName === 'todo_write'` and `input.todos` — mirrors the AI
 * SDK v5 message shape we render in `replayConversation`.
 */
function replayTodosFromMessages(messages: any[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content))
      continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (!part || part.type !== "tool-call") continue;
      const name = String(part.toolName ?? part.name ?? "");
      if (name !== "todo_write") continue;
      const input = (part.input ?? part.args ?? {}) as { todos?: unknown };
      if (!Array.isArray(input.todos)) continue;
      const items: TodoItem[] = [];
      for (const raw of input.todos) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const id = typeof r.id === "string" && r.id.length > 0 ? r.id : null;
        const content = typeof r.content === "string" ? r.content : "";
        const activeForm =
          typeof r.activeForm === "string" ? r.activeForm : content;
        const status =
          r.status === "in_progress" || r.status === "completed"
            ? r.status
            : "pending";
        if (!id || !content) continue;
        items.push({ id, content, activeForm, status });
      }
      recordTodos(items);
      return;
    }
  }
  clearTodos();
}

function replayConversation(panel: Panel, messages: any[]): void {
  panel.clear();
  // Tool results live in a separate `{role:'tool', content:[{type:'tool-result',
  // toolCallId, output}]}` message in the AI SDK v5 history shape, so we must
  // keep a toolCallId → card map and apply results when we encounter the tool
  // message. Otherwise replayed conversations show every tool card stuck in
  // the "running" state and the output text never appears.
  const cardsByCallId = new Map<string, ReturnType<Panel["addToolCard"]>>();

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    if (msg.role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : safeStringify(msg.content);
      if (text.startsWith("<system-reminder>")) continue;
      // The user message in saved history can also be an array of parts
      // (e.g. when the SDK wraps the user prompt into `[{type:'text',...}]`);
      // pull out plain text in that case.
      const display =
        typeof msg.content === "string"
          ? text
          : Array.isArray(msg.content)
            ? msg.content
                .filter(
                  (p: any) => p?.type === "text" && typeof p.text === "string",
                )
                .map((p: any) => p.text)
                .join("")
            : text;
      if (display.startsWith("<system-reminder>")) continue;
      panel.addUserMessage(display);
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        const bubble = panel.addAssistantBubble();
        bubble.updateMarkdown(cleanAssistantText(msg.content));
        bubble.finalize();
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const p of msg.content) {
          if (p?.type === "text" && typeof p.text === "string") {
            textParts.push(p.text);
          } else if (p?.type === "reasoning" && typeof p.text === "string") {
            const r = panel.addReasoningBlock();
            r.appendDelta(p.text);
            r.finalize();
          } else if (p?.type === "tool-call") {
            const callId = String(p.toolCallId ?? p.id ?? "");
            const card = panel.addToolCard(
              String(p.toolName ?? p.name ?? "tool"),
              p.input ?? p.args ?? {},
            );
            if (callId) cardsByCallId.set(callId, card);
            // If the (legacy) save shape stuffed the result onto the call part
            // itself, honour that too so old conversations still display.
            const inline = p.result ?? p.output;
            if (inline !== undefined) card.setResult(inline);
          }
        }
        if (textParts.length) {
          const bubble = panel.addAssistantBubble();
          bubble.updateMarkdown(cleanAssistantText(textParts.join("")));
          bubble.finalize();
        }
      }
    } else if (msg.role === "tool") {
      // Apply results to the matching tool cards rendered above.
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const p of parts) {
        const callId = String(p?.toolCallId ?? p?.id ?? "");
        if (!callId) continue;
        const card = cardsByCallId.get(callId);
        if (!card) continue;
        if (p?.type === "tool-error" || p?.error) {
          const errMsg =
            (typeof p.error === "string" ? p.error : p?.error?.message) ??
            "tool error";
          card.setResult(undefined, String(errMsg));
        } else {
          card.setResult(p?.output ?? p?.result);
        }
      }
    } else if (msg.role === "xgoose-error") {
      panel.addErrorMessage(
        typeof msg.content === "string"
          ? msg.content
          : safeStringify(msg.content),
      );
    }
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// pageBridge's beforeunload handler resolves pending RPCs with
//   { ok:true, result:{ __xgoose_navigated:true, newUrl:'…' } }
// before the page is torn down. The js_exec tool wraps that in its own
// envelope so the result we see in the stream can be either shape; detect
// both and return the new URL (or '' if unknown), or `null` if not a
// navigation result.
function extractNavigatedUrl(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as any;
  if (o.__xgoose_navigated) return typeof o.newUrl === "string" ? o.newUrl : "";
  if (
    o.result &&
    typeof o.result === "object" &&
    (o.result as any).__xgoose_navigated
  ) {
    const u = (o.result as any).newUrl;
    return typeof u === "string" ? u : "";
  }
  return null;
}

// Build an `assistant` + `tool` message pair from what we captured while the
// turn was streaming. Used when a navigation aborts the stream before AI SDK
// can hand us its own `response.messages` array. Returns the synthesised
// messages so the caller can push them onto its own conversation array
// (the array lives in the closure of bootstrap()).
function buildCapturedAssistantTurn(args: {
  text: string;
  toolNames: Map<string, string>;
  toolInputs: Map<string, unknown>;
  toolOutputs: Map<string, { output?: unknown; error?: string }>;
}): any[] {
  const { text, toolNames, toolInputs, toolOutputs } = args;
  const out: any[] = [];
  const assistantContent: any[] = [];
  if (text) assistantContent.push({ type: "text", text });
  for (const [callId, name] of toolNames) {
    assistantContent.push({
      type: "tool-call",
      toolCallId: callId,
      toolName: name,
      input: toolInputs.get(callId) ?? {},
    });
  }
  if (assistantContent.length) {
    out.push({ role: "assistant", content: assistantContent });
  }
  const toolContent: any[] = [];
  for (const [callId, res] of toolOutputs) {
    const name = toolNames.get(callId) ?? "tool";
    if (res.error !== undefined) {
      // v5 schema has no `tool-error` part — errors live inside a
      // `tool-result` whose `output` is `{ type: 'error-text', value }`.
      toolContent.push({
        type: "tool-result",
        toolCallId: callId,
        toolName: name,
        output: { type: "error-text", value: String(res.error) },
      });
    } else {
      // Stream's raw `tool-result.output` value (a string / object / etc.)
      // must be wrapped into the v5 `{ type, value }` discriminated union.
      toolContent.push({
        type: "tool-result",
        toolCallId: callId,
        toolName: name,
        output: normalizeToolOutput(res.output),
      });
    }
  }
  if (toolContent.length) {
    out.push({ role: "tool", content: toolContent });
  }
  return out;
}

// Deliver an exported file across desktop + iOS Safari:
//   1. navigator.share with a File  – iOS-native share sheet (best mobile UX)
//   2. <a href=blob:… download=…>   – macOS Safari download
//   3. clipboard fallback           – always available; surfaced via status
// The status line in the panel keeps the user informed regardless of path.
async function deliverExport(
  text: string,
  filename: string,
  panel: Panel,
): Promise<void> {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });

  // Try the share sheet first on touch devices (iOS Safari supports
  // navigator.canShare({files:[…]}) since iOS 15).
  try {
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
    };
    if (typeof nav.share === "function") {
      const file = new File([blob], filename, { type: "text/markdown" });
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: filename,
          text: "xgoose conversation export",
        } as ShareData);
        panel.setStatus(`Shared ${filename}`);
        return;
      }
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      console.warn("[xgoose] share failed, falling back", err);
    } else {
      // User explicitly cancelled the share sheet — no need to fall back.
      return;
    }
  }

  // Try anchor download (macOS Safari, Chromium, etc.).
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    // Also copy to clipboard so the user has the text immediately if the
    // browser refuses the download (some iOS configurations).
    try {
      await navigator.clipboard?.writeText(text);
      panel.setStatus(`Downloaded ${filename} (also copied to clipboard)`);
    } catch {
      panel.setStatus(`Downloaded ${filename}`);
    }
    return;
  } catch (err) {
    console.warn("[xgoose] download fallback failed", err);
  }

  // Last resort: clipboard only.
  try {
    await navigator.clipboard?.writeText(text);
    panel.setStatus(`Copied ${filename} as Markdown to clipboard`);
  } catch {
    panel.setStatus(`Export failed — see console`);
  }
}

// (The per-origin last-convo helpers that used to live here have moved to
//  `src/shared/storage.ts` as `getLastConvoIdGlobal` / `setLastConvoIdGlobal`
//  — the pointer is now a single global key so conversations follow the
//  user across origins, which is what the unified-history feature requires.)

// avoid "unused" stripping; keep the export shape stable for popup
export {};
