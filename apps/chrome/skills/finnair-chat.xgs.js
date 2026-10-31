// ==XGooseSkill==
// @name         finnair-chat
// @namespace    finnairchat
// @version      0.1.5
// @description  Finnair customer-service chat: human agent first, profile-assisted setup, partner award quotes, long queues and Amex-style audible alerts.
// @match        https://finnair.com/*
// @match        https://*.finnair.com/*
// @detect       /(^|\.)finnair\.com$/.test(location.hostname)
// @run-at       document_idle
// @primary      openChat
// @connect      <self>
// @keyword      finnair
// @keyword      芬航客服
// @keyword      Finnair Plus
// @keyword      Avios
// @keyword      American Airlines award
// @action       找人工客服 | 使用 finnair-chat 打开当前客服会话，直接要求转人工并进入队列，持续等待真人回复。
// @action       积分票询价 | 使用 finnair-chat，先转人工，再按我提供的航线日期询问每人 Avios 和全部现金费用、币种及客服出票费。
// ==/XGooseSkill==

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

// Salesforce's host-page events and utilAPI work across its messaging iframe.
// https://developer.salesforce.com/docs/service/messaging-web/guide/event-listeners.html
// https://developer.salesforce.com/docs/service/messaging-web/guide/send-message.html
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
  notice.setAttribute('aria-label', 'Finnair chat notification');
  notice.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:min(360px,calc(100vw - 32px));padding:16px;border:1px solid #94a3b8;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 24px #0003;font:14px/1.5 system-ui;overflow-wrap:anywhere';
  const title = document.createElement('strong');
  title.textContent = 'xgoose · Finnair';
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

const STATE_KEY = 'xgoose.finnair-chat.v1';
const HUMAN_REQUEST = 'Please transfer me to a human agent.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = node => (node?.innerText || node?.textContent || '').trim();
const buttons = () => [...document.querySelectorAll('button')];
const button = label => buttons().find(el => (el.getAttribute('aria-label') || text(el)) === label);
const dialog = () => document.querySelector('[role="dialog"]');
const unpack = value => typeof value === 'string' ? JSON.parse(value) : value;
function save(s) {
  sessionStorage.setItem(STATE_KEY, JSON.stringify({messages:s.messages,conversationId:s.conversationId,phase:s.phase,cursor:s.cursor,humanRequested:s.humanRequested,monitor:s.monitor,queuedAt:s.queuedAt,alerts:s.alerts}));
}
function state() {
  if (window.__xgooseFinnairChat) return window.__xgooseFinnairChat;
  const stored = JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}');
  const s = Object.assign({messages:[],phase:'closed',conversationId:null,cursor:null,humanRequested:false,monitor:false,queuedAt:null,alerts:[],firstBot:false,pending:null},stored);
  window.__xgooseFinnairChat = s;
  const on = (name,handler) => window.addEventListener(name,event => handler(event.detail || {}));
  const record = detail => {
    const entry=detail.conversationEntry;if(!entry)return;
    const payload=unpack(entry.entryPayload),sender=unpack(entry.sender)||{};
    const messageText=payload.abstractMessage?.staticContent?.text;
    if(!messageText)return;
    const id=entry.identifier || payload.id;
    if(s.messages.some(m=>m.id===id))return;
    const role=String(sender.role||'').toLowerCase().replace(/\s/g,'');
    const m={id,role:role==='enduser'?'user':role==='agent'?'agent':role==='chatbot'?'bot':'system',name:entry.senderDisplayName||'',text:messageText,at:entry.transcriptedTimestamp||Date.now()};
    s.messages.push(m);s.cursor=id;
    if(m.role==='bot'){s.firstBot=true;if(s.phase!=='queued'&&s.phase!=='human')s.phase='bot';}
    if(m.role==='agent'){
      s.phase='human';
      if(s.monitor){const first=!s.alerts.includes('human');if(first)s.alerts.push('human');void notify(first?'Finnair 人工客服已接入。':`Finnair 客服回复：${m.text.slice(0,180)}`);}
    }
    if(/please wait for (?:a |an )?(?:customer service |live )?agent|added you to (?:the )?queue|your (?:queue )?position is/i.test(m.text)&&m.role!=='user'){
      s.phase='queued';s.queuedAt ||= Date.now();
    }
    save(s);
    if(s.pending&&s.firstBot)void flushPending(s);
  };
  on('onEmbeddedMessageSent',record);
  on('onEmbeddedMessagingFirstBotMessageSent',detail=>{s.firstBot=true;record(detail);if(s.pending)void flushPending(s);});
  on('onEmbeddedMessagingConversationStarted',detail=>{
    if(s.conversationId&&s.conversationId!==detail.conversationId){s.messages=[];s.cursor=null;s.humanRequested=false;s.alerts=[];s.firstBot=false;}
    s.conversationId=detail.conversationId;s.phase='connecting';save(s);
  });
  on('onEmbeddedMessagingConversationOpened',()=>{if(s.phase==='closed')s.phase='connecting';save(s);});
  on('onEmbeddedMessagingSessionStatusUpdate',detail=>{
    const p=unpack(detail.conversationEntry?.entryPayload || detail),status=p.sessionStatus || p.status;
    if(status==='Waiting'){s.phase='queued';s.queuedAt ||= Date.now();}
    if(status==='Ended')s.phase='ended';
    save(s);
  });
  on('onEmbeddedMessagingConversationClosed',()=>{s.phase='ended';save(s);});
  on('onEmbeddedMessagingWindowClosed',()=>{s.phase='closed';save(s);});
  return s;
}
async function notify(reason) {
  const notice=showUserNotice(reason),audio=await playUserChime();notice.updateSound(audio);
  return {reason,audio,visible:notice.visible};
}
function snapshot() {
  const s=state(),panel=dialog(),fields=panel?[...panel.querySelectorAll('input')].filter(el=>el.type!=='radio'&&el.type!=='hidden'):[];
  const missing=fields.filter(el=>el.required&&!el.value).map(el=>el.getAttribute('aria-label')||el.name||el.id);
  const frame=document.querySelector('#embeddedMessagingFrame');
  return {status:fields.length?'profile_form':panel?'prechat_loading':s.phase,conversationId:s.conversationId,cursor:s.cursor,humanRequested:s.humanRequested,monitoring:s.monitor,queuedAt:s.queuedAt,messageCount:s.messages.length,missingFields:missing,chatFrame:!!frame,notice:panel?text(panel).slice(0,1200):null};
}
async function send(textToSend) {
  const s=state(),sdk=window.embeddedservice_bootstrap?.utilAPI;
  if(!sdk?.sendTextMessage)return {status:'chat_not_ready',...snapshot()};
  const before=s.messages.length;
  await sdk.sendTextMessage(textToSend);
  const until=Date.now()+5000;
  do {
    const echo=s.messages.slice(before).find(m=>m.role==='user'&&m.text===textToSend);
    if(echo)return {status:'sent',cursor:echo.id,text:echo.text};
    await sleep(100);
  }while(Date.now()<until);
  return {status:'pending',cursor:s.cursor,text:textToSend};
}
async function flushPending(s) {
  if(s.sending)return;s.sending=true;
  const pending=s.pending;s.pending=null;
  try{s.lastSend=await send(pending);if(s.lastSend.status==='chat_not_ready')s.pending=pending;else s.humanRequested=true;}
  catch(error){s.lastError=error.message;s.pending=pending;}
  finally{s.sending=false;save(s);}
}
const instructions = `你是当前 Finnair 网页内的客服代理。每次先找真人：openChat → requestHuman → readMessages / waitForReply。Sisu 只用于转接、选主题和进入人工队列；先单独发送 "Please transfer me to a human agent."，开场不附加积分票问题；被问原因才简短说明 partner award quote；不要让机器人代替人工报价。对方询问是否加入队列，发送 "Yes please, thank you."。等待一两小时也保留原会话和队列位置，不因安静就刷新、重开或 HUCA。
客服沟通沿用 Amex chat 风格：简短、坚定、礼貌，通常一句 10–25 个英文词，一个意思；自然缩写，不写长信，不重复称呼、背景或每轮感谢。先回答对方的问题，再问下一项。真人接入后才分条说清日期、方向、舱位和乘客数，并要求每人 Avios、全部现金费用和币种；再问是否包含附加费和客服出票费。用户只问报价时，拿到完整信息即可。
账户姓名、邮箱等先用 readProfile 和预填表单，缺什么再补什么。航班号与方向一起核对；PVG→DFW 与用户给的 AA127 可能不一致，交给真人确认，保持用户路线。使用完整年份和日期，查相邻日期时沿用用户给的范围。报价按当前客服答复，别拿旧聊天或积分表当作今天的完整税费报价。
openChat 会沿现有页面按钮进入预填表单；按钮消失但聊天窗口未出现时，使用 Salesforce 官方 launchChat 打开现有会话。profile_form 且 missingFields 非空就读取 profile 补齐后再继续。prechat_loading 表示正在加载预填资料，保留当前弹窗继续等待；connecting 表示聊天还在加载，不等于已排队。requestHuman 在首条机器人消息到达后通过 Salesforce 官方发送 API 请求转人工。pending 表示回显未确认，用 readMessages / waitForReply 核对，不重复发同一句。
readMessages 默认紧凑输出，cursor 是实际消息 ID。waitForReply 使用上次返回的 cursor，每次最多 60 秒；timeout 时继续等，不结束任务。用 startMonitoring 开启真人接入与新回复提示音；需要用户回答或拿到完整报价时调用 notifyUser。声音使用与 Amex chat 相同的上升音型；首次点一次页面上的“播放提示音”可启用浏览器音频。等待仍需保持 xgoose 对话运行；停止后不能声称 agent 会继续自动答复。按用户语言简短报告结果、未回答项或实际阻碍。`;

export default defineSkill({
  openChat: fn({summary:'Open Finnair chat and advance its populated pre-chat form. Returns the current stage; connecting is not queued.',input:z.object({waitMs:z.number().int().min(500).max(30000).optional()}),handler:async({waitMs=10000}={})=>{
    const s=state();s.monitor=true;save(s);
    if(['queued','human','bot'].includes(s.phase))return snapshot();
    const deadline=Date.now()+waitMs;
    let launch;
    while(Date.now()<deadline){
      const p=dialog(),start=button('Start the chat');
      if(start){
        const fields=[...p.querySelectorAll('input')].filter(el=>el.required&&el.type!=='radio');
        if(fields.some(el=>!el.value))return snapshot();
        const no=[...p.querySelectorAll('input[type="radio"]')].find(el=>el.getAttribute('aria-label')==='No'||el.labels?.[0]?.textContent.trim()==='No'||el.value==='false');
        if(no&&!no.checked)(no.labels?.[0]||no).click();
        start.click();s.phase='connecting';save(s);return snapshot();
      }
      const next=button('Start chat')||(!p&&(button('Chat')||button('Start a chat')));
      if(document.querySelector('#embeddedMessagingFrame'))return snapshot();
      const sdk=window.embeddedservice_bootstrap?.utilAPI;
      if(!launch&&sdk?.launchChat&&(s.phase==='connecting'||!next)){
        s.phase='connecting';save(s);
        launch=sdk.launchChat().then(()=>({launched:true}),error=>({error:error.message}));
      }
      if(launch){
        const result=await Promise.race([launch,sleep(200).then(()=>null)]);
        if(result?.error)return {...snapshot(),status:'launch_failed',error:result.error};
        if(result?.launched)return snapshot();
      }else if(next){next.click();await sleep(300);}
      else await sleep(200);
    }
    return snapshot();
  }}),
  readProfile: fn({summary:'Read account header and currently populated contact fields from visible profile/pre-chat UI.',input:z.object({open:z.boolean().optional()}),handler:({open=false}={})=>{
    const b=button('Display my profile information');if(open&&b)b.click();
    const p=dialog(),fields=p?[...p.querySelectorAll('input')].filter(e=>e.type!=='hidden'&&e.type!=='radio').map(e=>({label:e.getAttribute('aria-label')||e.labels?.[0]?.textContent.trim()||e.name||e.id,value:e.value})):[];
    return {signedIn:!!b,accountName:b?text(b):null,fields,profileText:open?text(document.querySelector('header')).slice(0,1800):null};
  }}),
  requestHuman: fn({summary:'Ask for a live agent immediately or queue the request until Salesforce emits its first bot message. Reuses the active queue.',input:z.object({reason:z.string().optional()}),handler:async({reason}={})=>{
    const s=state();if(s.humanRequested||s.phase==='human'||s.phase==='queued')return snapshot();
    s.monitor=true;s.pending=reason?`Hi, could you connect me with a live agent, please? ${reason}`:HUMAN_REQUEST;
    if(s.firstBot||s.messages.some(m=>m.role==='bot')||document.querySelector('#embeddedMessagingFrame'))await flushPending(s);
    return {...snapshot(),status:s.pending?'waiting_for_chat':s.lastSend?.status||s.phase};
  }}),
  readMessages: fn({summary:'Read observed Salesforce message events. Default last 5; limit 0 reads all captured messages; cursor is a real message ID.',input:z.object({limit:z.number().int().min(0).optional(),after:z.string().optional()}),handler:({limit=5,after}={})=>{
    const s=state(),at=after?s.messages.findIndex(m=>m.id===after):-1;
    if(after&&at<0)return {status:'cursor_not_found',cursor:s.cursor,messages:[]};
    const rows=s.messages.slice(at+1);return {...snapshot(),messages:limit?rows.slice(-limit):rows};
  }}),
  sendMessage: fn({summary:'Send through the official Salesforce end-user API and verify the outgoing echo. pending requires reading before retrying.',input:z.object({text:z.string().min(1).max(4000)}),handler:({text})=>send(text)}),
  waitForReply: fn({summary:'Wait up to 60 seconds for a new bot/human message after the real cursor. timeout preserves the queue and should be followed by another wait.',input:z.object({cursor:z.string().nullable().optional(),timeoutMs:z.number().int().min(1000).max(60000).optional()}),handler:async({cursor,timeoutMs=45000}={})=>{
    const s=state(),anchor=cursor??s.cursor,at=anchor?s.messages.findIndex(m=>m.id===anchor):-1;
    if(anchor&&at<0)return {status:'cursor_not_found',cursor:s.cursor,messages:[]};
    const deadline=Date.now()+timeoutMs;
    do{const messages=s.messages.slice(at+1).filter(m=>m.role!=='user');if(messages.length)return {...snapshot(),status:'reply',messages};if(s.phase==='ended')return snapshot();await sleep(250);}while(Date.now()<deadline);
    return {...snapshot(),status:'timeout',messages:[]};
  }}),
  startMonitoring: fn({summary:'Enable automatic visible and audible notices for live agent replies in this tab. The chat session and agent remain in the same page.',input:z.object({}),handler:()=>{const s=state();s.monitor=true;save(s);const notice=showUserNotice('Finnair：正在关注客服回复。点击播放提示音启用声音。');return {...snapshot(),visible:notice.visible};}}),
  stopMonitoring: fn({summary:'Stop this skill’s automatic reply alerts without closing or changing the Finnair conversation.',input:z.object({}),handler:()=>{const s=state();s.monitor=false;save(s);return snapshot();}}),
  notifyUser: fn({summary:'Play the Amex-style rising chime and show a visible reason or the completed quote.',input:z.object({reason:z.string().min(1).max(500)}),handler:({reason})=>notify(reason)}),
  getStatus: fn({summary:'Read current chat phase, observed message cursor and queue/monitor state without opening or sending.',input:z.object({}),handler:()=>snapshot()}),
},{instructions});
