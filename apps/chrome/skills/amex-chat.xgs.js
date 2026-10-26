// ==XGooseSkill==
// @name         amex-chat
// @namespace    amexchat
// @version      0.4.5
// @description  Amex customer-service chat: concise, firm, polite follow-through, automatic HUCA, user-input chimes, and on-demand retention, fee-waiver and welcome-bonus SOPs.
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
// @action       Retention SOP | 载入 amex-chat 的 retention SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。
// @action       费用减免 SOP | 载入 amex-chat 的 fee-waiver SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。
// @action       开卡奖励核实 SOP | 载入 amex-chat 的 welcome-bonus-check SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。
// ==/XGooseSkill==

/**
 * Amex customer-service chat driver.
 *
 * DOM-driven against Amex's in-house axp-webchat library
 * (assets at https://www.aexp-static.com/cdaas/one/axp-webchat/).
 * Click the page's own buttons rather than reverse-engineering the signed
 * XHR — same philosophy as amex-offers.
 *
 * The agent-facing policy is in defineSkill's instructions below, not just
 * this source comment. Task SOPs are loaded only via getContext.
 * The chat may connect to a bot or a human; do not assume which from tone.
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

// Kept out of __meta__.instructions, summaries and examples: this context
// enters the conversation only when requested through getContext/action.
const TASK_CONTEXTS = {
  "retention": {
    "name": "retention",
    "sop": "你是当前 Amex 网页内的客服代理。目标：为指定卡争取可接受的留卡优惠。全程坚定、礼貌，每条通常一句、10–25 个英文词，一个诉求；短句、口语、自然缩写。\n\n1. 确认目标卡：优先用用户提供的信息和本页内容，只补问无法确定的卡号尾号。不先盘问预算、消费历史等整套信息；先查有什么 offer。\n2. 打开聊天，读取最近对话，直接问：\"Hi, any retention offers for my [card] ending [digits]?\"\n3. 普通客服无法查询时，请求转接：\"Could you transfer me to the retention team?\" 等待转接完成。\n4. 客服反复介绍福利时，简短承认后拉回目标：\"Got it. Any bonus points or statement credit available?\" \n5. 有 offer 就追问积分与现金选项、消费门槛及较低消费版本。把“新给积分/credit”与“用现有 MR 抵年费”分清；后者需要消耗用户的积分。不要把旧积分抵扣当作免费优惠。\n6. 无效客服自动 HUCA：简短重申一次或请求转接，仍推诿、矛盾、绕圈就道谢，closeChat({mode:'end'})，确认聊天已结束，再 openChat，确认新客服接入后重问。无需再问用户是否继续；保持前后事实一致。\n7. 多个客服确认同一个系统结果时，不反复堆砌话术或快速重连。询问是否还有其他可选方案、何时可再查询，以及这张卡实际的年费退款截止日期。当前页面无法再推进时，给用户明确状态与下一步；不自行打电话、开新页面或承诺后台稍后继续。\n8. 对具体 offer 核实：奖励、合格消费金额、消费起止日期、激活时间、奖励到账时间、排除交易、需保持账户开放的期限和提前关卡/降级/退款的影响。未知项直接问当前客服，不套用固定的 30 天或 13 个月说法。\n9. 用一句话向用户呈现条件，例如“25,000 MR，三个月消费 $2,500，需持卡 X 个月，是否接受？”调用 notifyUser({reason}) 提醒并等待回答。不能用用户沉默代替接受；有约束力条款按平台要求交给用户确认。\n10. 明确同意并完成必要操作后，请客服确认登记状态和生效日期。结束时简短报告实际 offer、是否登记、消费截止日和待处理项。口头报价、成功登记、奖励到账是不同状态。绝不发送“请关掉我的卡”来试探 offer。保留原卡时只说 \"I’ll keep the card as is. Thanks!\"；仅在对方准备关卡或有歧义时补 \"Please don’t close it.\"，不每轮重复保留账户声明。"
  },
  "fee-waiver": {
    "name": "fee-waiver",
    "sop": "你是当前 Amex 网页内的客服代理。目标：为指定的已收取费用争取减免、冲正或等额 courtesy credit。全程坚定、礼貌，每条通常一句、10–25 个英文词；短句、口语、自然缩写。\n\n1. 从用户描述和本页确认目标卡、费用名称、金额、入账日期。区分 late fee、interest charge、returned payment fee 和 annual fee；若用户只说“手续费”且无法识别，问一个澄清问题。\n2. 若涉及逾期或付款退回，先确认当前付款状态，不把“已设置 autopay”当作“已成功还款”。需要还款或更改付款设置时提醒用户处理，不能靠等待减免替代还款，也不自行发起付款。\n3. 打开聊天，读已有对话，具体请求：\"Could you waive the $[amount] [fee] from [date] as a courtesy?\" \n4. 有 late fee 又有 interest 时，分开问清两项能否调整。减免一项不代表另一项也免除；确认是否还有待入账利息或后续利息，以及客服建议如何避免继续计息。\n5. 对“system declined”，问：\"Could you try a manual review?\" 需要时请求有权限的团队；不要把“无法自动 waive”直接当最终结果。\n6. 客服推诿或不愿核查，简短跟进一次仍无进展就自动 HUCA：记录这笔费用和已有 case，礼貌结束聊天，重新连接并确认新客服接入。同一事项已有 review/case 时先查进度，避免重复提交相同 case。\n7. returned payment fee、late fee 和 interest 分别查询，不假设规则相同，也不声称“一年必能免一次”。多个客服确认系统拒绝且没有人工复核途径时，记录明确障碍与可用下一步，停止无效快速重连。\n8. 对 annual fee，先明确询问是否有直接 waiver/adjustment 或无需消费的 courtesy credit。若只提供留卡奖励，征得用户目标上的同意后载入 retention SOP；不要把留卡消费任务、积分抵年费、关卡退款混称为年费豁免。不能未经用户决定就关卡或降级。\n9. 客服同意处理时确认：具体调整哪一项、金额、是 fee reversal 还是独立 credit、是否已经批准、预计到账日。若只是提交 review，拿 case 编号及预计答复时间，报告“待审核”，不是“已减免”。\n10. 需要额外事实或接受附加条件时，用 notifyUser({reason}) 只问一个具体问题，等待真实回复。最后报告“申请/批准/已入账”中的实际状态、金额和预计到账时间。"
  },
  "welcome-bonus-check": {
    "name": "welcome-bonus-check",
    "sop": "你是当前 Amex 网页内的客服代理。目标：核实已开卡账户实际登记的 welcome bonus、消费进度和奖励状态。全程简短、坚定、礼貌；不申请新卡，不制造测试消费。\n\n1. 确认本次查询的卡号尾号。先利用本页已有 tracker、奖励和交易信息；用户提供的申请奖励截图/文字用作比对，不把页面广告或其他卡的 offer 当成本账户条款。\n2. 打开客服聊天，直接问：\"Hi, what's the welcome bonus on my [card] ending [digits]?\" 拿到回复后再单独问：\"How much do I need to spend, and by what date?\" 区分 welcome、upgrade、retention 和附属卡奖励。\n3. 要求客服给出本账户的奖励数额/类型、消费门槛、消费期起止日期、是否已登记且 eligible。不能只凭没有弹窗、有 NLL 字样或客服说“应该有”就确认奖励。\n4. 刚开卡而客服看不到 offer 时，问是尚未同步、缺少登记还是明确不符合资格，确认何时可再查。不要把暂时看不到直接判为无奖励，具体时间按当前账户回复记录。\n5. 查消费进度：询问后台统计的 eligible spend、还差多少、统计截至何日。区分 posted 与 pending，核实退款、年费、利息等不计入项；不拿本页部分交易自行求和冒充完整官方进度。\n6. 客服回复与用户保存的申请条款、tracker 或另一位客服冲突时，请其复核该卡的 offer 与起止日期。答非所问、混淆卡片或拒绝核对时自动 HUCA；保存现有说法，换客服重新核实。\n7. 仍不一致或明确缺少登记时，把差异简短告诉用户，询问是否提交调查；需用户提供截图或决定升级处理时调用 notifyUser({reason})。不能把“可以开 case”当作“已经有 bonus”。获授权后请求记录奖励条款、case 编号及答复时间。\n8. 已达到消费门槛却未到账时，确认达标日期、预计 posting 时间、奖励是否 pending/issued，以及入账到哪里（MR、酒店/航司会员账户或 statement credit）。联名卡核对关联会员号的必要尾号，不要求公开完整敏感信息。超出客服给定窗口后，请求查询或调查。\n9. 不通过购买再退款机票、礼卡、虚假消费或其他测试交易验证 SUB。需要登录、验证码或用户才知道的申请信息时，提示音并等待用户。\n10. 结束时用简表汇报：已登记奖励；消费要求；截止日期；已计入/剩余消费；奖励当前状态；未解决项与 case。查不到就写“未确认”，明确被拒就写原因；不会因为客服语气肯定就宣称奖励已到账。"
  }
};

let notificationAudio;
let notificationInFlight;
let lastChimeAt = -Infinity;
let userNotice;

async function playUserChime() {
  if (Date.now() - lastChimeAt < 30000) return 'throttled';
  if (notificationInFlight) return notificationInFlight;
  notificationInFlight = (async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return 'unsupported';
    try {
      if (!notificationAudio || notificationAudio.state === 'closed') notificationAudio = new AudioContext();
      if (notificationAudio.state !== 'running') {
        // resume() can remain pending indefinitely under autoplay restrictions.
        let timer;
        try {
          await Promise.race([
            notificationAudio.resume(),
            new Promise(resolve => { timer = setTimeout(resolve, 800); }),
          ]);
        } finally { clearTimeout(timer); }
      }
      if (notificationAudio.state !== 'running') return 'needs_user_gesture';
      const start = notificationAudio.currentTime + 0.02;
      // Distinct two-part rising motif, rather than a generic chat ding.
      const motif = [[0, 392], [0.14, 523.25], [0.28, 659.25], [0.46, 1046.5]];
      const notes = [0, 0.9].flatMap(repeat => motif.map(([at, hz]) => [at + repeat, hz]));
      notes.forEach(([offset, frequency]) => {
        const oscillator = notificationAudio.createOscillator();
        const gain = notificationAudio.createGain();
        const at = start + offset;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.06, at + 0.02);
        gain.gain.linearRampToValueAtTime(0, at + 0.16);
        oscillator.connect(gain);
        gain.connect(notificationAudio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + 0.18);
      });
      lastChimeAt = Date.now();
      return 'played';
    } catch (error) {
      return error?.name === 'NotAllowedError' ? 'needs_user_gesture' : 'unavailable';
    }
  })();
  try { return await notificationInFlight; }
  finally { notificationInFlight = null; }
}

function showUserNotice(reason) {
  if (userNotice?.isConnected) userNotice.remove();
  const notice = document.createElement('aside');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-label', 'xgoose needs your input');
  notice.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:min(360px,calc(100vw - 32px));padding:16px;border:1px solid #94a3b8;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 24px #0003;font:14px/1.5 system-ui;overflow-wrap:anywhere';
  const title = document.createElement('strong');
  title.textContent = 'xgoose · 需要你的回复 / Your input needed';
  const message = document.createElement('p');
  message.textContent = reason;
  const soundStatus = document.createElement('p');
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = '播放提示音 / Play sound';
  play.style.cssText = 'padding:6px 10px;margin-right:8px;cursor:pointer';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '关闭 / Dismiss';
  dismiss.style.cssText = 'padding:6px 10px;cursor:pointer';
  const updateSound = status => {
    soundStatus.textContent = status === 'needs_user_gesture'
      ? '点击“播放提示音”以启用声音。 / Click Play sound to enable audio.'
      : ['unsupported', 'unavailable'].includes(status)
        ? '声音不可用，请查看上方问题。 / Audio unavailable; please read the question above.' : '';
  };
  play.addEventListener('click', async () => updateSound(await playUserChime()));
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(title, message, soundStatus, play, dismiss);
  const parent = document.body || document.documentElement;
  if (!parent) return { visible: false, updateSound };
  parent.append(notice);
  userNotice = notice;
  return { visible: true, updateSound };
}

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

const localMessageIds = new WeakMap();
let localMessageSerial = 0;
let lastSend = null;
let replyCursor = null;

function messageIdentity(el) {
  const native = el.getAttribute('data-message-id');
  if (native) return native;
  if (!localMessageIds.has(el)) localMessageIds.set(el, `xg-local-${Date.now()}-${++localMessageSerial}`);
  return localMessageIds.get(el);
}

function resolveSentMessage(messages) {
  if (!lastSend) return null;
  const echo = messages.findLast(m => m.role === 'user' && m.text === lastSend.text && !lastSend.before.has(m.messageId));
  if (echo) lastSend.cursor = echo.messageId;
  return lastSend.cursor;
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

  const messageId = messageIdentity(el);
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

const chatOptions = {
  instructions: `你是当前 Amex 网页内的单页面 agent，只在本页和本页客服会话中推进用户已授权的目标；不打开其他页面、不拨打电话、不启动页面外任务。语气坚定、礼貌、像日常在线聊天：默认一次一句，通常 10–25 个英文词，必要时两句；一个明确诉求。用短句和自然缩写（I’m / I’d / I’ll / don’t / can’t / that’s / what’s），可用 MR、pts、thanks、ok、got it。无需完整书面句，允许 "Any other offers?" / "And the deadline?" 这类自然断句。先答对方问题，再问下一项，别一口气塞三四个问题。同一轮可拆成连续 2–3 条短消息，每条一个意思，不必等客服逐条回复。每条确认发送回显后间隔约 1–2 秒再发下一条；不发碎词、不重复轰炸。发完这一组后，使用最后一条已发送消息的 cursor 等回复。例如分开发 "I’ll keep the card." 和 "Thanks for checking!"。删掉重复称呼、复述背景、每轮感谢，以及 "I understand" / "I’d like to inquire" / "Please rest assured" 这类客服腔。卡名尾号首次说清或被问时再补，不每轮重复；不要每条都声明保持账户开放。例："Hi, any retention offers for my Surpass ending 23000?" → "Any statement credit instead?" → "What’s the spend requirement?" → "I’ll keep the card as is. Thanks!"。遇到条款、日期、金额仍须清楚准确，不为缩短而省略关键条件。保持简短、礼貌。按客服语言沟通，按用户语言汇报；给用户的结果默认 2–4 行，只报本次任务的结果、条件或下一步，不附带无关旧聊天记录。
已知页面问题：Amex 打开客服后可能先返回空消息，随后才补载几周前的对话；历史加载不是客服刚刚回复。readMessages 保留全部已加载历史的读取能力：默认最近 5 条，offset 向前分页，limit:0 读取全部，结合 conversationDate 和本次消息 cursor 判断所属会话。排查、回顾先前承诺或核实上下文时可主动读旧记录；不要仅因它是旧消息就丢弃。但旧记录里的问句、报价和操作不能当成本轮新指令，也不要无故在本轮总结里报告无关旧事项。waitForReply 只等本次发送/上次已读游标之后的客服回复，不能用它替代历史读取。
目标明确就主动 openChat → readMessages → sendMessage → waitForReply，正常推进不反复问用户是否继续。sendMessage 会核实发送回显并返回 cursor，等待用 waitForReply({sinceMessageId:cursor})；pending 时只读取或等待，不重发。后续继续等待使用上次 waitForReply 返回的 cursor。不要猜 ID，不从默认 5 条分页消息计算 sinceCount；晚加载的历史不是新回复。每次等待最多 60 秒，读到完整回复再回答；不盲目重发。客服明确要求等待就等，仅在长时间无回复且确有必要时发一句保活。
不要因一次拒绝放弃。对不愿检查、答非所问或反复兜圈的客服，简短重申一次或请求合适团队；仍无法推进就自动 HUCA，不另问许可：记录当前结果，礼貌道谢，closeChat({mode:'end'}) 结束的是聊天，然后 openChat 重新连接并简述诉求。确认旧会话真正结束、新客服接入；重新打开窗口不等于已经换人。失败状态须处理，不循环点击。遇到同一客服/排队/限流就退避，保留目标与下一步；改变问法或转接团队继续争取；当前页面已无可执行步骤时明确报告阻碍，不承诺后台定时重试。用户叫停立即停止；明确的登录、验证码、服务关闭等障碍如实说明，绝不把未解决说成已解决。
只在确实缺少信息或需要用户决策时提一个具体问题，调用 notifyUser({reason}) 播放网页提示音并等待真实回答。音频被阻止时使用可见提示和播放按钮，不宣称用户已听到。等待用户答复。结束聊天不代表授权关卡；关卡、降级、兑换积分或接受有约束力条款须由用户明确决定并按平台要求接管。
任务 SOP 按需载入：留卡优惠用 getContext({name:'retention'})，费用减免用 getContext({name:'fee-waiver'})，开卡奖励核实用 getContext({name:'welcome-bonus-check'})。只读当前任务需要的一份，不一次展开全部。点击 context 只载入 SOP，是否联系客服遵循当前用户任务。`,
  actions: [
  {
    "id": "retention-context",
    "label": "Retention SOP",
    "prompt": "载入 amex-chat 的 retention SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。",
    "js": "return await xgoose.skills.amexchat.getContext({ name: 'retention' });"
  },
  {
    "id": "fee-waiver-context",
    "label": "费用减免 SOP",
    "prompt": "载入 amex-chat 的 fee-waiver SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。",
    "js": "return await xgoose.skills.amexchat.getContext({ name: 'fee-waiver' });"
  },
  {
    "id": "welcome-bonus-check-context",
    "label": "开卡奖励核实 SOP",
    "prompt": "载入 amex-chat 的 welcome-bonus-check SOP，供当前任务按需执行；没有对应已授权任务时只展示 SOP。",
    "js": "return await xgoose.skills.amexchat.getContext({ name: 'welcome-bonus-check' });"
  }
],
};

const chatSkill = defineSkill({
  getContext: fn({
    summary: 'Load one task SOP on demand: retention, fee-waiver, or welcome-bonus-check. Read-only; no chat or messages. Only load the context matching the current user goal.',
    input: z.object({ name: z.enum(['retention', 'fee-waiver', 'welcome-bonus-check']) }),
    examples: [{ args: { name: 'retention' } }],
    handler: ({ name } = {}) => {
      if (!Object.hasOwn(TASK_CONTEXTS, name)) throw new Error('amexchat.getContext: unknown context');
      return JSON.parse(JSON.stringify(TASK_CONTEXTS[name]));
    },
  }),

  notifyUser: fn({
    summary: 'Ask for required user input with a visible question and a brief page chime. Returns { status: "input_required", audio, visible, reason }. Audio may be blocked/unsupported; played means scheduled, not confirmed audible. Repeated sounds are throttled for 30 seconds.',
    input: z.object({ reason: z.string().min(1).max(500).describe('One focused question in the user’s language. Do not include passwords, full card numbers or verification codes.') }),
    examples: [{ args: { reason: '这项处理需要你确认，请在 xgoose 中回复。' } }],
    handler: async ({ reason } = {}) => {
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
        throw new Error('amexchat.notifyUser: reason must contain 1–500 characters');
      }
      const notice = showUserNotice(reason.trim());
      const audio = await playUserChime();
      notice.updateSound(audio);
      return { status: 'input_required', audio, visible: notice.visible, reason: reason.trim() };
    },
  }),

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
      'Send and verify the outgoing bubble. Returns { status: sent|pending|drafted|no_input|send_disabled|chat_not_open|session_expired, sentText, cursor? }. pending means clicked but echo unconfirmed: wait/read, NEVER blindly resend. Pass cursor to waitForReply.',
    input: z.object({
      text: z.string().min(1).describe('Non-empty message body.'),
      submit: z.boolean().optional().describe('Default true. false = type but do not click send.'),
    }),
    examples: [{ args: { text: "Hi, can you help with my Platinum card?" } }],
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
        return { status: 'drafted', sentText: text };
      }

      const sendBtn = findFirst(SEND_QUERIES);
      if (!sendBtn) return { status: 'no_input', sentText: text };

      const enabled = await waitFor(() => (!isSendDisabled(sendBtn) ? sendBtn : null), 1000, 50);
      if (!enabled) return { status: 'send_disabled', sentText: text };

      lastSend = { text: text.trim(), before: new Set(readAllMessagesUnsliced().messages.map(m => m.messageId)), cursor: null };
      replyCursor = null;
      sendBtn.click();
      const cursor = await waitFor(() => resolveSentMessage(readAllMessagesUnsliced().messages), 2000, 100);
      return { status: cursor ? 'sent' : 'pending', sentText: text, cursor };

    },
  }),

  readMessages: fn({
    summary:
      'Read latest 5 loaded bubbles by default, including historical conversations. KNOWN AMEX QUIRK: old transcripts hydrate late; newly visible is not newly received. Check conversationDate. offset paginates history; limit:0 reads ALL loaded history. Returns { messages: ChatMessage[], totalVisible, agentCount, cursor, isOpen, isMinimized }. ChatMessage = { role, text, agentName, timestamp, messageId, conversationDate, _domIndex }.',
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

      return { messages, totalVisible, agentCount: all.messages.filter(m => m.role === 'agent').length, cursor: all.messages.at(-1)?.messageId ?? null, isOpen: all.isOpen, isMinimized: all.isMinimized };
    },
  }),

  waitForReply: fn({
    summary:
      'Block until a new agent bubble appears. Returns { status: "reply"|"timeout"|"session_expired"|"chat_not_open", newMessages, tail, isOpen, isMinimized, elapsedMs }. cursor marks the last returned reply. Default waits after the verified last send/reply; late-loaded history before that send is excluded. Never use a made-up ID. By default tail is empty (compact).',
    input: z.object({
      sinceMessageId: z.string().nullable().optional().describe('Use the exact cursor returned by sendMessage/readMessages/waitForReply. Unknown IDs never fall back to message counts.'),
      sinceCount: z.number().int().min(0).optional().describe('Deprecated compatibility parameter. A verified outgoing-message cursor takes precedence; do not compute this from a paginated read.'),
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

      // Always apply the last outgoing-message boundary, even when a stale
      // sinceCount is supplied. Amex hydrates old transcripts asynchronously.
      const sinceMessageId = params.sinceMessageId ?? replyCursor ?? lastSend?.cursor ?? baseline.messages.at(-1)?.messageId ?? null;

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

        const sentCursor = resolveSentMessage(snap.messages);
        const sentIndex = sentCursor ? snap.messages.findIndex(m => m.messageId === sentCursor) : -1;
        const sinceIndex = sinceMessageId ? snap.messages.findIndex(m => m.messageId === sinceMessageId) : -1;
        // If a send has not echoed, or an explicit cursor disappeared, fail
        // closed instead of treating a batch of historical messages as new.
        const missingSend = lastSend && sentIndex < 0;
        const missingExplicit = params.sinceMessageId != null && sinceIndex < 0;
        const boundary = Math.max(sentIndex, sinceIndex);
        const newMessages = !missingSend && !missingExplicit && boundary >= 0
          ? snap.messages.slice(boundary + 1).filter(m => m.role === 'agent') : [];

        if (newMessages.length > 0) {
          replyCursor = newMessages.at(-1).messageId;
          return {
            cursor: replyCursor,
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
}, chatOptions);

// Older marketplace bundlers ignore defineSkill’s options argument. Keep
// metadata explicit so installed bundles expose the same policy/actions.
Object.assign(chatSkill.__meta__, chatOptions);
export default chatSkill;
