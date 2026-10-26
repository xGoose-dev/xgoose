// ==XGooseSkill==
// @name         amex-chat
// @namespace    amexchat
// @version      0.2.0
// @description  Drive Amex's customer-service chat widget on global.americanexpress.com — open / send / read / wait / close via DOM clicks against axp-webchat.
// @match        *://global.americanexpress.com/*
// @match        *://www.americanexpress.com/*
// @detect       /(^|\.)americanexpress\.com$/.test(location.hostname)
// @run-at       document_idle
// @primary      openChat
// @connect      <self>
// @keyword      amex
// @keyword      american express
// @keyword      amex chat
// @keyword      customer service
// @keyword      Customer Care Professional
// @keyword      webchat
// @keyword      美卡白金
// @keyword      Amex 客服
// @keyword      Oura
// @keyword      platinum benefit
// ==/XGooseSkill==

/**
 * Amex customer-service chat driver.
 *
 * DOM-driven against Amex's in-house axp-webchat library
 * (assets at https://www.aexp-static.com/cdaas/one/axp-webchat/).
 * Click the page's own buttons rather than reverse-engineering the signed
 * XHR — same philosophy as amex-offers.
 *
 * IMPORTANT — this skill talks to a real human Customer Care Professional.
 * Be polite, pace replies (2-4 s between turns), one question per turn,
 * single keep-alive ping per ~90 s of CSR silence. Amex will end the chat
 * if you violate these rules.
 *
 * Lifecycle states (isOpen, isMinimized):
 *   - dormant     (false, false) — just the blue Chat pill
 *   - open        (true, false)
 *   - minimized   (true, true)  — chat session kept alive on the server
 *
 * Failure modes:
 *   - openChat → 'no_chat_button' → user is on a route Amex doesn't render
 *     the chat pill on. Tell them to navigate to dashboard.
 *   - openChat → 'session_expired' → URL matches /login|/signin|/welcome.
 *   - sendMessage → 'send_disabled' → typing event didn't propagate, or
 *     Amex rate-limited the user. Surface, don't loop.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const TRIGGER_QUERIES = ['button.aa-chat-pill', 'button[aria-label="Chat"]:not([id^="webChat"])'];
const MAXIMIZE_QUERIES = ['#webChatMaximizeBtn', 'button[aria-label="Maximize Chat"]'];
const PANEL_QUERIES = ['#webChatWizContainer', '[role="dialog"][aria-labelledby="webChatTitleTxt"]'];
const INPUT_QUERIES = ['#webChatInputTextField', 'textarea[aria-label="Type a message..."]'];
const SEND_QUERIES = ['#webChatSendDataButton', 'button[aria-label="send your message"]'];
const MINIMIZE_QUERIES = ['#webChatMinizeBtn', 'button[aria-label="Minimize Chat"]'];
const END_QUERIES = ['#webChatEndChatBtn', 'button[aria-label="End Chat"]'];

const END_CHAT_DIALOG_QUERY = '#endChatDialog';
const END_CHAT_CONFIRM_QUERIES = [
  '#endChatDialog .endChatButton',
  '#endChatDialog button.endChatButton',
  '#endChatDialog .DialogBody button:first-of-type',
];

const MESSAGES_SECTION_QUERIES = ['#webChatMessagesSection', '[role="log"][class*="webchat-messages-section"]'];

const BUBBLE_QUERY = '[class*="message__webchat-message"]';
const BUBBLE_TEXT_QUERY = '[class*="webchat-msg"]';
const BUBBLE_AGENT_NAME_QUERY = '[class*="agent-avatar-tooltip-text"]';
const BUBBLE_TIMESTAMP_QUERY = '[class*="message-owner"], [class*="webchat-timestamp"]';

const SEND_DISABLED_FRAGMENT = 'webchat-send-button-disable';
const TYPING_BUBBLE_FRAGMENT = 'ccp-typing-bubble';
const USER_FRAGMENT = 'userMessage';
const AGENT_FRAGMENT = 'agent-message';

const SYSTEM_MESSAGE_QUERIES = [
  '#webChatLowSystemMessageDiv',
  '#cardNumberMessageDiv',
  '#webChatNASystemMessageDiv',
];

const CONVERSATION_WRAPPER_QUERY = '[data-conversation-date], [class*="conversation-wrapper"]';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findFirst(queries) {
  for (const q of queries) {
    const el = document.querySelector(q);
    if (el) return el;
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.offsetWidth > 0 || el.offsetHeight > 0;
}

function detectSessionExpired() {
  const url = location.href;
  if (/\/login|\/signin|\/welcome|\/identity\/login/i.test(url)) return true;
  if (document.querySelector('input[type="password"], input[name*="UserID"], input[name*="user_id"]')) {
    return true;
  }
  return false;
}

function panelState() {
  const panel = findFirst(PANEL_QUERIES);
  const input = findFirst(INPUT_QUERIES);
  const minimize = findFirst(MINIMIZE_QUERIES);
  const maximize = findFirst(MAXIMIZE_QUERIES);

  const inputVisible = isVisible(input);
  const minimizeVisible = isVisible(minimize);
  const maximizeVisible = isVisible(maximize);

  if (inputVisible && minimizeVisible) return { isOpen: true, isMinimized: false };
  if (maximizeVisible) return { isOpen: true, isMinimized: true };
  if (panel && (inputVisible || minimizeVisible)) return { isOpen: true, isMinimized: false };
  return { isOpen: false, isMinimized: false };
}

async function waitFor(predicate, timeoutMs, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let v = predicate();
  if (v) return v;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    v = predicate();
    if (v) return v;
  }
  return null;
}

function classifyBubble(el) {
  const cls = el.className.toString();
  if (cls.includes(USER_FRAGMENT)) return 'user';
  if (cls.includes(AGENT_FRAGMENT)) return 'agent';
  return null;
}

function isTypingBubble(el) {
  return !!el.querySelector(`[class*="${TYPING_BUBBLE_FRAGMENT}"]`);
}

function nearestConversationDate(el) {
  const wrapper = el.closest(CONVERSATION_WRAPPER_QUERY);
  if (!wrapper) return null;
  const explicit = wrapper.getAttribute('data-conversation-date');
  if (explicit) return explicit;
  const dateEl = wrapper.querySelector('[class*="conversation-date"]');
  return dateEl?.textContent?.trim() ?? null;
}

function readBubble(el, index) {
  if (isTypingBubble(el)) return null;
  const role = classifyBubble(el);
  if (!role) return null;

  const textEl = el.querySelector(BUBBLE_TEXT_QUERY);
  let text = '';
  if (textEl) {
    const clone = textEl.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
    text = (clone.textContent ?? '').trim();
  }
  if (!text) return null;

  const agentNameEl = role === 'agent' ? el.querySelector(BUBBLE_AGENT_NAME_QUERY) : null;
  const agentName = agentNameEl?.textContent?.trim() || null;

  const tsEl = el.querySelector(BUBBLE_TIMESTAMP_QUERY);
  const timestamp = tsEl?.textContent?.trim() || null;

  const messageId = el.getAttribute('data-message-id');
  const conversationDate = nearestConversationDate(el);

  return { role, text, agentName, timestamp, messageId, conversationDate, _domIndex: index };
}

function readSystemMessages() {
  const out = [];
  for (const q of SYSTEM_MESSAGE_QUERIES) {
    const el = document.querySelector(q);
    if (!el || !isVisible(el)) continue;
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    out.push({
      role: 'system',
      text,
      agentName: null,
      timestamp: null,
      messageId: el.id || null,
      conversationDate: null,
      _domIndex: -1,
    });
  }
  return out;
}

function readAllMessagesUnsliced() {
  const state = panelState();
  if (!state.isOpen) return { messages: [], ...state };

  const section = findFirst(MESSAGES_SECTION_QUERIES);
  if (!section) return { messages: [], ...state };

  const bubbles = Array.from(section.querySelectorAll(BUBBLE_QUERY));
  const messages = [];
  bubbles.forEach((el, i) => {
    const m = readBubble(el, i);
    if (m) messages.push(m);
  });

  for (const sys of readSystemMessages()) {
    sys._domIndex = messages.length;
    messages.push(sys);
  }

  return { messages, ...state };
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const elSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;
  if (protoSetter && elSetter && protoSetter !== elSetter) {
    protoSetter.call(el, value);
  } else {
    el.value = value;
  }
}

function isSendDisabled(button) {
  if (button.disabled) return true;
  const cls = button.className.toString();
  return cls.includes(SEND_DISABLED_FRAGMENT);
}

export default defineSkill({
  openChat: fn({
    summary:
      'Open the chat widget. ★ primary entry. From dormant: clicks the blue Chat pill. From minimized: clicks Maximize. Returns { status: "opened"|"maximized"|"already_open"|"no_chat_button"|"session_expired", isOpen, isMinimized }.',
    input: z.object({
      waitMs: z.number().int().min(500).max(30000).optional().describe('How long to wait for the panel to mount. Default 5000.'),
    }),
    examples: [{ args: {} }],
    handler: async (params = {}) => {
      if (detectSessionExpired()) {
        return { status: 'session_expired', isOpen: false, isMinimized: false };
      }
      const waitMs = Math.max(500, params.waitMs ?? 5000);
      const initial = panelState();
      if (initial.isOpen && !initial.isMinimized) {
        return { status: 'already_open', ...initial };
      }
      if (initial.isMinimized) {
        const max = findFirst(MAXIMIZE_QUERIES);
        if (!max) return { status: 'no_chat_button', isOpen: false, isMinimized: true };
        max.click();
        const state = await waitFor(() => {
          const s = panelState();
          return s.isOpen && !s.isMinimized ? s : null;
        }, waitMs);
        return state ? { status: 'maximized', ...state } : { status: 'no_chat_button', ...panelState() };
      }
      const trigger = findFirst(TRIGGER_QUERIES);
      if (!trigger) return { status: 'no_chat_button', isOpen: false, isMinimized: false };
      trigger.click();
      const state = await waitFor(() => {
        const s = panelState();
        return s.isOpen && !s.isMinimized ? s : null;
      }, waitMs);
      return state ? { status: 'opened', ...state } : { status: 'no_chat_button', ...panelState() };
    },
  }),

  sendMessage: fn({
    summary:
      'Type into the message field and (optionally) submit. Returns { status: "sent"|"no_input"|"send_disabled"|"chat_not_open"|"session_expired", sentText }.',
    input: z.object({
      text: z.string().min(1).describe('Non-empty message body.'),
      submit: z.boolean().optional().describe('Default true. false = type but do not click send.'),
    }),
    examples: [{ args: { text: "Hi, I'd like help with my Platinum card." } }],
    handler: async ({ text, submit }) => {
      if (!text.trim()) {
        throw new Error('amex-chat.sendMessage: `text` must be non-empty');
      }
      if (detectSessionExpired()) return { status: 'session_expired', sentText: '' };

      const state = panelState();
      if (!state.isOpen || state.isMinimized) {
        return { status: 'chat_not_open', sentText: '' };
      }

      const input = findFirst(INPUT_QUERIES);
      if (!input) return { status: 'no_input', sentText: '' };

      input.focus();
      setNativeValue(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      if (submit === false) {
        return { status: 'sent', sentText: text };
      }

      const sendBtn = findFirst(SEND_QUERIES);
      if (!sendBtn) return { status: 'no_input', sentText: text };

      const enabled = await waitFor(() => (!isSendDisabled(sendBtn) ? sendBtn : null), 1000, 50);
      if (!enabled) return { status: 'send_disabled', sentText: text };

      sendBtn.click();
      return { status: 'sent', sentText: text };
    },
  }),

  readMessages: fn({
    summary:
      'Read latest 5 bubbles by default (paginate with offset). Returns { messages: ChatMessage[], totalVisible, isOpen, isMinimized }. ChatMessage = { role, text, agentName, timestamp, messageId, conversationDate, _domIndex }.',
    input: z.object({
      limit: z.number().int().min(0).max(200).optional().describe('Default 5. Pass 0 for ALL bubbles (expensive).'),
      offset: z.number().int().min(0).optional().describe('Default 0. Skip this many bubbles from the end before applying limit.'),
    }),
    examples: [{ args: { limit: 5 } }],
    handler: async ({ limit, offset } = {}) => {
      const all = readAllMessagesUnsliced();
      const totalVisible = all.messages.length;
      const lim = limit ?? 5;
      const off = Math.max(0, offset ?? 0);

      let messages;
      if (lim === 0) {
        messages = off > 0 ? all.messages.slice(0, Math.max(0, totalVisible - off)) : all.messages;
      } else {
        const end = totalVisible - off;
        const start = Math.max(0, end - lim);
        messages = all.messages.slice(start, Math.max(start, end));
      }

      return { messages, totalVisible, isOpen: all.isOpen, isMinimized: all.isMinimized };
    },
  }),

  waitForReply: fn({
    summary:
      'Block until a new agent bubble appears. Returns { status: "reply"|"timeout"|"session_expired"|"chat_not_open", newMessages, tail, isOpen, isMinimized, elapsedMs }. By default tail is empty (compact).',
    input: z.object({
      sinceMessageId: z.string().nullable().optional().describe('Wait for any agent bubble strictly newer than this. null = first agent bubble.'),
      sinceCount: z.number().int().min(0).optional().describe('Alternative: wait until total agent-bubble count exceeds this.'),
      timeoutMs: z.number().int().min(1000).max(600000).optional().describe('Default 60000.'),
      pollMs: z.number().int().min(250).max(10000).optional().describe('Default 1500.'),
      pollWindow: z.number().int().min(2).optional().describe('Internal — almost never needs tuning.'),
      tailSize: z.number().int().min(0).max(50).optional().describe('Default 0 (no extra context). 3-5 for trailing bubbles.'),
    }),
    examples: [{ args: { timeoutMs: 60000 } }, { args: { sinceMessageId: 'abc-123', timeoutMs: 90000 } }],
    handler: async (params = {}) => {
      const startedAt = Date.now();
      const timeoutMs = Math.max(1000, params.timeoutMs ?? 60000);
      const pollMs = Math.max(250, params.pollMs ?? 1500);
      const pollWindow = Math.max(2, params.pollWindow ?? 12);
      const tailSize = Math.max(0, params.tailSize ?? 0);
      const sliceTail = (msgs) => (tailSize > 0 ? msgs.slice(-tailSize) : []);

      const baseline = readAllMessagesUnsliced();
      if (!baseline.isOpen || baseline.isMinimized) {
        return {
          status: 'chat_not_open',
          newMessages: [],
          tail: sliceTail(baseline.messages),
          isOpen: baseline.isOpen,
          isMinimized: baseline.isMinimized,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const explicitSinceId = params.sinceMessageId !== undefined;
      const explicitSinceCount = params.sinceCount !== undefined;
      let sinceMessageId = explicitSinceId ? params.sinceMessageId : undefined;
      const sinceCount = explicitSinceCount ? params.sinceCount : undefined;

      if (!explicitSinceId && !explicitSinceCount) {
        const last = baseline.messages.at(-1);
        sinceMessageId = last?.messageId ?? null;
      }

      const baselineAgentCount = baseline.messages.filter((m) => m.role === 'agent').length;

      while (Date.now() - startedAt < timeoutMs) {
        if (detectSessionExpired()) {
          const latest = readAllMessagesUnsliced();
          return {
            status: 'session_expired',
            newMessages: [],
            tail: sliceTail(latest.messages),
            isOpen: latest.isOpen,
            isMinimized: latest.isMinimized,
            elapsedMs: Date.now() - startedAt,
          };
        }

        await sleep(pollMs);
        const snap = readAllMessagesUnsliced();
        if (!snap.isOpen || snap.isMinimized) {
          return {
            status: 'chat_not_open',
            newMessages: [],
            tail: sliceTail(snap.messages),
            isOpen: snap.isOpen,
            isMinimized: snap.isMinimized,
            elapsedMs: Date.now() - startedAt,
          };
        }

        const tailWindow = snap.messages.slice(-pollWindow);
        const agentMsgsInWindow = tailWindow.filter((m) => m.role === 'agent');
        const agentMsgsAll = snap.messages.filter((m) => m.role === 'agent');

        let newMessages = [];
        if (sinceCount !== undefined) {
          if (agentMsgsAll.length > sinceCount) {
            newMessages = agentMsgsAll.slice(sinceCount);
          }
        } else if (sinceMessageId === null) {
          newMessages = agentMsgsInWindow;
        } else {
          const idx = snap.messages.findIndex((m) => m.messageId === sinceMessageId);
          if (idx >= 0) {
            newMessages = snap.messages.slice(idx + 1).filter((m) => m.role === 'agent');
          } else if (agentMsgsAll.length > baselineAgentCount) {
            newMessages = agentMsgsAll.slice(baselineAgentCount);
          }
        }

        if (newMessages.length > 0) {
          return {
            status: 'reply',
            newMessages,
            tail: sliceTail(snap.messages),
            isOpen: snap.isOpen,
            isMinimized: snap.isMinimized,
            elapsedMs: Date.now() - startedAt,
          };
        }
      }

      const final = readAllMessagesUnsliced();
      return {
        status: 'timeout',
        newMessages: [],
        tail: sliceTail(final.messages),
        isOpen: final.isOpen,
        isMinimized: final.isMinimized,
        elapsedMs: Date.now() - startedAt,
      };
    },
  }),

  closeChat: fn({
    summary:
      'Minimize (default, non-destructive) or end the chat. Returns { status: "minimized"|"ended"|"ended_pending_confirm"|"already_closed"|"no_close_button"|"no_confirm_button" }. mode "end" auto-confirms Amex\'s end-chat dialog.',
    input: z.object({
      mode: z.enum(['minimize', 'end']).optional().describe('Default "minimize". "end" is destructive.'),
      confirm: z.boolean().optional().describe('Default true. mode:"end" + confirm:false leaves dialog up.'),
    }),
    examples: [{ args: {} }, { args: { mode: 'end' } }],
    handler: async (params = {}) => {
      const state = panelState();
      if (!state.isOpen) return { status: 'already_closed' };

      const mode = params.mode ?? 'minimize';
      if (mode === 'end') {
        const endBtn = findFirst(END_QUERIES);
        if (!endBtn) return { status: 'no_close_button' };
        endBtn.click();

        if (params.confirm === false) {
          return { status: 'ended_pending_confirm' };
        }

        const dialog = await waitFor(() => document.querySelector(END_CHAT_DIALOG_QUERY), 2500, 100);
        if (!dialog) return { status: 'ended' };
        const confirmBtn = findFirst(END_CHAT_CONFIRM_QUERIES);
        if (!confirmBtn) return { status: 'no_confirm_button' };
        confirmBtn.click();
        await waitFor(() => (!document.querySelector(END_CHAT_DIALOG_QUERY) ? true : null), 2500, 100);
        return { status: 'ended' };
      }

      if (state.isMinimized) return { status: 'already_closed' };
      const minBtn = findFirst(MINIMIZE_QUERIES);
      if (!minBtn) return { status: 'no_close_button' };
      minBtn.click();
      await waitFor(() => (panelState().isMinimized ? true : null), 2000, 50);
      return { status: 'minimized' };
    },
  }),
});
