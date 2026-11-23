import { BUG_ICON, BUG_REPORT_CSS } from "./bugReport";
import {APPEARANCE_STYLE_CSS} from "./appearanceStyles";
import {PANEL_CSS,GOOSE_MARK} from "./panelStyles";
import {mountMotion} from "./motion";
import {applyAppearance,type AppearanceState} from "./appearance";
// Shadow-DOM floating chat panel: launcher, header, skills bar, conversation,
// history, todos and composer. Styles live in panelStyles.ts. Tool calls and
// reasoning render as one collapsed activity line per run of consecutive steps;
// expanding it lists each call with its input and output.

import {prepareImage,imageDataUrl,MAX_ATTACHMENTS,type ImageAttachment} from "./images";
import { renderMarkdown } from "./markdown";
import { describeToolCall, summarizeToolResult } from "./toolLabels";
import { DEFAULT_LAYOUT, type Corner, type Layout } from "./layout";

const HTML = `
<button class="toggle" title="Open xgoose">${GOOSE_MARK}</button>
<div class="panel">
  <div class="resize-handle corner" data-axis="corner"></div>
  <div class="resize-handle edge" data-axis="h"></div>
  <div class="resize-handle edge" data-axis="v"></div>
  <div class="hdr">
    <div class="hdr-title"><span class="hdr-mark">${GOOSE_MARK}</span><span>xgoose</span></div>
    <div class="hdr-actions">
      <div class="hdr-tools" role="group" aria-label="Conversation tools">
        <button class="btn-history hdr-icon-btn" title="Past conversations" aria-label="History"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8m0 0V4m0 4h4M12 8v4.5l3 1.8"/></svg></button>
        <button class="btn-todos hdr-icon-btn" title="Todo list" aria-label="Todos"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m4.5 7 1.5 1.5L9 5.5M4.5 13 6 14.5 9 11.5M4.5 19 6 20.5 9 17.5M12 7h8M12 13h8M12 19h8"/></svg><span class="todo-count"></span></button>
        <button class="btn-bug hdr-icon-btn" type="button" title="Report a bug" aria-label="Report a bug" hidden>${BUG_ICON}</button>
        <button class="btn-settings hdr-icon-btn" title="Open settings" aria-label="Settings"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.07.07a2 2 0 1 1-2.83 2.83l-.07-.07a1.7 1.7 0 0 0-1.83-.3 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.54 1.7 1.7 0 0 0-1.83.3l-.07.07a2 2 0 1 1-2.83-2.83l.07-.07A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.83l-.07-.07a2 2 0 1 1 2.83-2.83l.07.07A1.7 1.7 0 0 0 9 4.64h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.83-.3l.07-.07a2 2 0 1 1 2.83 2.83l-.07.07a1.7 1.7 0 0 0-.3 1.83V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1Z"/></svg></button>
        <button class="btn-expand hdr-icon-btn" title="Toggle wide overlay" aria-label="Toggle wide overlay"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 9V5h4M20 9V5h-4M4 15v4h4m12-4v4h-4"/></svg></button>
      </div>
      <button class="btn-new" title="New conversation"><span class="btn-new-glyph" aria-hidden="true">+</span><span class="btn-new-label">New</span></button>
      <button class="btn-close hdr-icon-btn hdr-close" title="Minimize chat" aria-label="Minimize"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 12h14"/></svg></button>
    </div>
  </div>
  <div class="skills-bar">
    <span class="label">Skills</span>
    <span class="skills-list"><span class="empty">No skills active on this page</span></span>
  </div>
  <div class="history"></div>
  <p class="skills-login-hint" hidden>Some searches may require signing in to this website.</p>
  <div class="todos">
    <div class="todos-header">
      <div class="todos-title">
        <span>Todo list</span>
        <span class="todos-summary"></span>
      </div>
      <button class="todos-clear" type="button" title="Clear all todos">Clear all</button>
    </div>
    <div class="todos-list"></div>
  </div>
  <div class="msgs"></div>
  <div class="gen-bar"><div class="gen-bar-inner"></div></div>
  <div class="status-row">
    <span class="loading-status"><span class="sp"></span><span class="loading-text"></span></span>
    <span class="status"></span>
    <span class="context-meter" hidden></span>
    <span class="metrics" title=""></span>
  </div>
  <div class="shortcuts"></div>
  <div class="queued-row"></div>
  <div class="image-previews" aria-label="Attached images" hidden></div>
  <div class="image-error" role="status" hidden></div>
  <div class="input-area">
    <input class="image-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
    <button class="btn-attach" type="button" aria-label="Attach images" title="Attach images (PNG, JPEG, WebP)">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 4 3 4-6 4 5"/></svg>
    </button>
    <textarea class="in-text" rows="1" placeholder="Ask anything about this page…"></textarea>
    <div class="input-actions">
      <button class="btn-stop" title="Stop the current turn">Stop</button>
      <button class="btn-send">Send</button>
    </div>
  </div>
</div>
`;

export type PanelTheme = "light" | "dark";

export type ToolCardHandle = {
  el: HTMLElement;
  /** Set the result on the card (also flips it to done / error and writes the summary). */
  setResult(output: unknown, error?: string): void;
};

export type ReasoningBlockHandle = {
  el: HTMLElement;
  appendDelta(text: string): void;
  finalize(): void;
};

export type AssistantBubbleHandle = {
  el: HTMLElement;
  updateMarkdown(text: string): void;
  finalize(): void;
};

export type HistoryItem = {
  id: string;
  title: string;
  origin: string;
  updatedAt: number;
  messageCount: number;
  current?: boolean;
};

export type TodoUiStatus = "pending" | "in_progress" | "completed";
export type TodoUiItem = {
  id: string;
  content: string;
  activeForm: string;
  status: TodoUiStatus;
};

/** Optional host customisation for the panel chrome. Extension hosts pass
 *  nothing and get the historical defaults; the embedded host uses these
 *  to lock down the toolbar (no settings tab) and rebrand the header
 *  + floating button. Settings panel is always opt-in: hosts that want
 *  it set `buttons.settings = true`. */
export type CreatePanelOpts = {
  imageUploads?: boolean;
  /** Safari keeps controls within the visible page when zoom or a keyboard changes it. */
  visualViewport?: boolean;
  editableSkills?: boolean;
};

export type Panel = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setTheme(theme: PanelTheme): void;
  setAppearance(state: AppearanceState): void;
  /** Show / hide the floating ✦ launcher button (the closed-state entry
   *  point). Hiding never affects an open panel — an in-progress chat can't
   *  vanish — it only suppresses the launcher while the panel is closed. Used
   *  by the "show button only on sites with a matching skill" setting. */
  setLauncherVisible(visible: boolean): void;
  setSkills(
    skills: Array<{
      name: string;
      namespace: string;
      userAuthored?: boolean;
      enabled?: boolean;
      activeOnThisPage?: boolean;
    }>,
  ): void;
  onSkillAction(
    handler: (
      action: "edit" | "disable" | "enable" | "read",
      name: string,
    ) => void,
  ): void;
  setShortcuts(shortcuts: Array<{ label: string; text: string }>): void;
  /** Author-declared skill actions; rendered as send-on-click buttons in the
   *  shortcuts row (distinct from prefill shortcuts, which they coexist with). */
  setSkillActions(
    actions: Array<{ id?: string; label: string; prompt: string; js?: string }>,
  ): void;
  onSkillActionRun(
    cb: (action: { label: string; prompt: string; js?: string }) => void,
  ): void;
  setApiKeyMissing(missing: boolean, openSettings: () => void): void;
  clear(): void;

  addUserMessage(text: string, images?: ImageAttachment[]): HTMLElement;
  addAssistantBubble(): AssistantBubbleHandle;
  addToolCard(name: string, input: unknown): ToolCardHandle;
  addReasoningBlock(): ReasoningBlockHandle;
  addErrorMessage(text: string): void;
  addInterruptedTurn(text: string, actions: { retry?: () => void; report: () => void; detail?: string }): void;
  onReportBug(open: () => void): void;
  showThinking(label?: string): void;
  removeThinking(): void;

  setGenerating(active: boolean): void;
  setStatus(text: string): void;
  /** Show an inline spinner + label in the status row (null clears it). */
  setLoadingStatus(text: string | null): void;
  setSending(sending: boolean): void;
  /** Webagent-style cumulative usage rollup pinned to the right of the
   *  status bar. Pass `null` (or a zero-tokens usage) to hide it. The
   *  caller owns the data shape; we render `{tokens}t · {cached%} cache ·
   *  {turns}× · ${cost}` with a tooltip breakdown for input / output /
   *  reasoning / cache. */
  setUsage(usage: import("@xgoose/core").ConversationUsage | null): void;
  setContextUsage(usage:{textBytes:number;limitBytes:number}|{tokens:number;contextWindow:number;outputReserve:number;estimated:boolean;model:string}|null):void;
  /** Replace the visible queued-prompts tray. Pass `[]` to hide it. The
   *  panel doesn't own queue state — the content script does — this just
   *  reflects whatever the caller hands us. Each item is rendered as a
   *  truncated pill with a × button (which fires `onCancelQueued`). */
  setQueuedMessages(items: string[]): void;

  setHistory(items: HistoryItem[]): void;
  showHistory(visible: boolean): void;
  isHistoryOpen(): boolean;

  /** Replace the rendered todo list. Pass `[]` to show the empty state.
   *  The toolbar counter pill is updated in lockstep ("done/total"), and
   *  the button tints purple while there's an in_progress item. */
  setTodos(items: TodoUiItem[]): void;
  showTodos(visible: boolean): void;
  isTodosOpen(): boolean;

  /** Apply a persisted layout (button position, panel size). */
  applyLayout(layout: Layout): void;
  /** Fires whenever the user drags the button or resizes the panel. */
  onLayoutChange(cb: (layout: Layout) => void): void;

  // Event wiring
  onSend(cb: (text: string, images?: ImageAttachment[]) => void): void;
  onStop(cb: () => void): void;
  /** Fires when the user clicks × on a queued-message pill. Index matches
   *  the array last passed to `setQueuedMessages`. */
  onCancelQueued(cb: (index: number) => void): void;
  onNew(cb: () => void): void;
  onSettings(cb: () => void): void;
  onHistory(cb: () => void): void;
  /** Fires when the user opens the Todos panel via the toolbar button. */
  onTodos(cb: () => void): void;
  /** Fires when the user clicks a todo's status circle to cycle its status.
   *  The content script is responsible for enforcing the single-in_progress
   *  invariant and calling `setTodos()` with the new list. */
  onTodoToggle(cb: (id: string, nextStatus: TodoUiStatus) => void): void;
  /** Fires when the user clicks "Clear all" in the Todos panel header. */
  onTodoClear(cb: () => void): void;
  onLoadConversation(cb: (id: string) => void): void;
  onDeleteConversation(cb: (id: string) => void): void;
  onExportConversation(cb: (id: string) => void): void;
  onReplyPost(
    cb: (raw: string, replyTo: string | null) => Promise<unknown>,
  ): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
};

export function createPanel(opts: CreatePanelOpts = {}): Panel {
  const host = document.createElement("div");
  host.id = "xgoose-root";
  const shadow = host.attachShadow({ mode: "open" });

  // Outside the shadow root, keyboard targets become the host DIV. Sites
  // such as Discord then mistake typing here for a page shortcut and focus
  // their own composer. Stop bubbling at the boundary, after panel controls
  // have handled the event; keep native editing and browser shortcuts intact.
  for (const type of ["keydown", "keypress", "keyup"]) {
    shadow.addEventListener(type, (event) => event.stopPropagation());
  }

  const style = document.createElement("style");
  style.textContent = PANEL_CSS+APPEARANCE_STYLE_CSS+BUG_REPORT_CSS;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.innerHTML = HTML;
  shadow.appendChild(wrap);
  document.body.appendChild(host);
  // Root-element fullscreen still contains the extension. Hide it explicitly
  // without closing the conversation or losing the current draft.
  const syncFullscreen = () => host.toggleAttribute("data-fullscreen", Boolean(document.fullscreenElement || (document as Document & {webkitFullscreenElement?: Element}).webkitFullscreenElement));
  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("webkitfullscreenchange", syncFullscreen);
  syncFullscreen();

  const $ = <T extends Element = Element>(sel: string): T =>
    shadow.querySelector(sel) as T;
  const toggleBtn = $(".toggle") as HTMLButtonElement;
  const panel = $(".panel") as HTMLDivElement;
  const reportButton = $<HTMLButtonElement>(".btn-bug");
  let openBugReport: (() => void) | undefined;
  reportButton.addEventListener("click", (event) => {
    if (event.isTrusted) openBugReport?.();
  });
  const msgs = $(".msgs") as HTMLDivElement;
  const historyEl = $(".history") as HTMLDivElement;
  const genBar = $(".gen-bar") as HTMLDivElement;
  mountMotion(panel);
  const statusEl = $(".status") as HTMLSpanElement;
  const metricsEl = $(".metrics") as HTMLSpanElement;
  const contextMeter=$(".context-meter") as HTMLSpanElement;
  const loadingEl = $(".loading-status") as HTMLSpanElement;
  const loadingTextEl = $(".loading-text") as HTMLSpanElement;
  const inputEl = $(".in-text") as HTMLTextAreaElement;
  const sendBtn = $(".btn-send") as HTMLButtonElement;
  sendBtn.disabled = true;
  const attachBtn=$(".btn-attach") as HTMLButtonElement;
  const imageFile=$(".image-file") as HTMLInputElement;
  const previewEl=$(".image-previews") as HTMLDivElement;
  const imageError=$(".image-error") as HTMLDivElement;
  let pendingImages:ImageAttachment[]=[];
  let imagePreparing=false, imageGeneration=0;
  attachBtn.hidden=!opts.imageUploads;
  function renderImages(){
    previewEl.replaceChildren();previewEl.hidden=!pendingImages.length;
    pendingImages.forEach((image,index)=>{
      const wrap=document.createElement("div");wrap.className="image-preview";
      const img=document.createElement("img");img.src=imageDataUrl(image);img.alt=image.name;
      const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label",`Remove ${image.name}`);
      remove.onclick=()=>{pendingImages.splice(index,1);renderImages();};
      wrap.append(img,remove);previewEl.append(wrap);
    });
    if(pendingImages.length){const hint=document.createElement("span");hint.className="image-hint";hint.textContent="Images are resized locally and sent with this message to your AI provider.";previewEl.append(hint);}
  }
  async function attachFiles(files:File[]){
    if(imagePreparing||!opts.imageUploads)return;
    const generation=imageGeneration;imagePreparing=true;attachBtn.disabled=true;sendBtn.disabled=true;imageError.hidden=true;
    try{
      for(const file of files){
        if(pendingImages.length>=MAX_ATTACHMENTS)throw Error(`Attach up to ${MAX_ATTACHMENTS} images per message.`);
        const image=await prepareImage(file);if(generation!==imageGeneration)return;
        pendingImages.push(image);renderImages();
      }
    }catch(error){if(generation===imageGeneration){imageError.textContent=error instanceof Error?error.message:"Could not read this image.";imageError.hidden=false;}}
    finally{imagePreparing=false;attachBtn.disabled=false;sendBtn.disabled=!handlers.send;imageFile.value="";}
  }
  attachBtn.onclick=()=>imageFile.click();
  imageFile.onchange=()=>void attachFiles(Array.from(imageFile.files??[]));
  inputEl.addEventListener("paste",event=>{
    const files=Array.from(event.clipboardData?.files??[]).filter(file=>file.type.startsWith("image/"));
    if(opts.imageUploads&&files.length){event.preventDefault();void attachFiles(files);}
  });
  const stopBtn = $(".btn-stop") as HTMLButtonElement;
  const queuedRow = $(".queued-row") as HTMLDivElement;
  const shortcutsEl = $(".shortcuts") as HTMLDivElement;
  const skillsList = $(".skills-list") as HTMLSpanElement;

  let skillMenu: HTMLDivElement | null = null;

  function closeSkillMenu(): void {
    if (skillMenu) {
      skillMenu.remove();
      skillMenu = null;
    }
  }

  function openSkillMenu(
    anchor: HTMLElement,
    skill: {
      name: string;
      namespace: string;
      userAuthored?: boolean;
      enabled?: boolean;
      activeOnThisPage?: boolean;
    },
  ): void {
    closeSkillMenu();
    const menu = document.createElement("div");
    menu.className = "skill-menu";
    const addItem = (
      label: string,
      action: "edit" | "disable" | "enable" | "read",
    ): void => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        closeSkillMenu();
        handlers.skillAction?.(action, skill.name);
      });
      menu.appendChild(btn);
    };
    addItem("Read source", "read");
    if(opts.editableSkills!==false)addItem("Edit (open settings)", "edit");
    addItem(
      skill.enabled === false ? "Enable" : "Disable for all pages",
      skill.enabled === false ? "enable" : "disable",
    );

    // Inside the panel the menu takes its theme and follows its position and scale.
    panel.appendChild(menu);
    const rect = anchor.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const scale = box.width / panel.offsetWidth || 1;
    menu.style.left = `${Math.max(8, Math.min((rect.left - box.left) / scale, panel.clientWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${(rect.bottom - box.top) / scale + 4}px`;
    skillMenu = menu;

    const onDocClick = (e: MouseEvent): void => {
      if (e.composedPath().includes(menu)) return;
      closeSkillMenu();
      document.removeEventListener("mousedown", onDocClick, true);
    };
    setTimeout(
      () => document.addEventListener("mousedown", onDocClick, true),
      0,
    );
  }
  const btnNew = $(".btn-new") as HTMLButtonElement;
  const btnHistory = $(".btn-history") as HTMLButtonElement;
  const btnTodos = $(".btn-todos") as HTMLButtonElement;
  const todoCountEl = $(".btn-todos .todo-count") as HTMLSpanElement;
  const todosEl = $(".todos") as HTMLDivElement;
  const todosListEl = $(".todos-list") as HTMLDivElement;
  const todosSummaryEl = $(".todos-summary") as HTMLSpanElement;
  const todosClearBtn = $(".todos-clear") as HTMLButtonElement;
  const btnSettings = $(".btn-settings") as HTMLButtonElement;
  const btnClose = $(".btn-close") as HTMLButtonElement;
  const btnExpand = $(".btn-expand") as HTMLButtonElement;

  const handlers = {
    send: null as null | ((t: string, images?: ImageAttachment[]) => void),
    stop: null as null | (() => void),
    cancelQueued: null as null | ((index: number) => void),
    fresh: null as null | (() => void),
    settings: null as null | (() => void),
    history: null as null | (() => void),
    todos: null as null | (() => void),
    todoToggle: null as null | ((id: string, nextStatus: TodoUiStatus) => void),
    todoClear: null as null | (() => void),
    loadConvo: null as null | ((id: string) => void),
    deleteConvo: null as null | ((id: string) => void),
    exportConvo: null as null | ((id: string) => void),
    open: null as null | (() => void),
    close: null as null | (() => void),
    reply: null as
      | null
      | ((raw: string, replyTo: string | null) => Promise<unknown>),
    layout: null as null | ((layout: Layout) => void),
    skillAction: null as
      | null
      | ((
          action: "edit" | "disable" | "enable" | "read",
          name: string,
        ) => void),
    skillActionRun: null as
      | null
      | ((action: { label: string; prompt: string; js?: string }) => void),
  };

  // ── layout: button position + panel size ──

  const mobileMq = matchMedia("(max-width: 520px)");
  const isMobile = () => mobileMq.matches || Boolean(opts.visualViewport && Math.min(screen.width,screen.height)<=520);

  let layout: Layout = { ...DEFAULT_LAYOUT };
  const resizeHandles = Array.from(
    shadow.querySelectorAll<HTMLDivElement>(".resize-handle"),
  );
  const cornerHandle = resizeHandles.find((h) => h.dataset.axis === "corner")!;
  const hEdgeHandle = resizeHandles.find((h) => h.dataset.axis === "h")!;
  const vEdgeHandle = resizeHandles.find((h) => h.dataset.axis === "v")!;

  function buttonViewport() {
    const vp = opts.visualViewport ? window.visualViewport : null;
    return vp
      ? {left: vp.offsetLeft, top: vp.offsetTop, width: vp.width, height: vp.height, scale: vp.scale}
      : {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, scale: 1};
  }

  function clampToViewport(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { x: number; y: number } {
    const vp = buttonViewport(), margin = 8 / vp.scale;
    return {
      x: Math.max(vp.left + margin, Math.min(vp.left + vp.width - w - margin, x)),
      y: Math.max(vp.top + margin, Math.min(vp.top + vp.height - h - margin, y)),
    };
  }

  function applyButtonPosition(
    corner: Corner,
    offset: { h: number; v: number },
  ): void {
    // Reset all four insets first so the previous anchor doesn't fight the new one.
    toggleBtn.style.left =
      toggleBtn.style.right =
      toggleBtn.style.top =
      toggleBtn.style.bottom =
        "";
    const horiz = corner === "br" || corner === "tr" ? "right" : "left";
    const vert = corner === "br" || corner === "bl" ? "bottom" : "top";
    toggleBtn.style[horiz] =
      `max(8px, min(${offset.h}px, calc(100vw - 56px)), env(safe-area-inset-${horiz}, 0px))`;
    toggleBtn.style[vert] =
      `max(8px, min(${offset.v}px, calc(100vh - 56px)), env(safe-area-inset-${vert}, 0px))`;
  }

  // The corner the panel is *actually* anchored to (after the mobile override
  // below). Resize math reads this instead of layout.panelCorner so dragging
  // grows the panel in the correct direction. See applyPanelPosition.
  let effectivePanelCorner: Corner = DEFAULT_LAYOUT.panelCorner;

  function applyPanelPosition(
    corner: Corner,
    size: { w: number; h: number },
  ): void {
    panel.style.left =
      panel.style.right =
      panel.style.top =
      panel.style.bottom =
        "";
    const mobile = isMobile();
    // On mobile the composer permanently occupies the bottom of the card, so
    // the panel must always dock to the bottom: that keeps the resize grips up
    // top (over the header/empty area) where they're reachable. If we let the
    // panel dock to the top (following the button), the grips flip to the
    // bottom and land on top of the composer's <textarea>/Send button — and on
    // iOS WebKit the native control swallows the touch, so resize silently
    // stops working. Force the vertical anchor to bottom while keeping the
    // user's chosen horizontal side.
    if (mobile) {
      corner = corner === "tr" ? "br" : corner === "tl" ? "bl" : corner;
    }
    effectivePanelCorner = corner;
    const margin = mobile ? 6 : 16;
    panel.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    panel.style.maxHeight = `calc(100vh - ${margin * 2}px)`;
    let w = size.w;
    let h = size.h;
    // On mobile, an untouched (default) size means "near-fullscreen card"; once
    // the user resizes, panelSize differs from the default and we honor it.
    if (
      mobile &&
      size.w === DEFAULT_LAYOUT.panelSize.w &&
      size.h === DEFAULT_LAYOUT.panelSize.h
    ) {
      w = window.innerWidth - margin * 2;
      h = window.innerHeight - margin * 2;
    }
    const horiz = corner === "br" || corner === "tr" ? "right" : "left";
    const vert = corner === "br" || corner === "bl" ? "bottom" : "top";
    panel.style[horiz] = mobile ? `${margin}px` : "10px";
    panel.style[vert] = mobile ? `${margin}px` : "20px";
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;

    // Move all resize handles to the side opposite the anchor so dragging
    // them grows the panel away from the docked edge. For corner: opposite
    // corner; for h-edge: opposite vertical-edge (top or bottom); for
    // v-edge: opposite horizontal-edge (left or right).
    const oppositeCorner: Corner =
      corner === "br"
        ? "tl"
        : corner === "bl"
          ? "tr"
          : corner === "tr"
            ? "bl"
            : "br";
    cornerHandle.classList.remove("br", "bl", "tr", "tl");
    cornerHandle.classList.add(oppositeCorner);

    const hEdgeSide = corner === "br" || corner === "bl" ? "n" : "s";
    hEdgeHandle.classList.remove("n", "s");
    hEdgeHandle.classList.add(hEdgeSide);

    const vEdgeSide = corner === "br" || corner === "tr" ? "w" : "e";
    vEdgeHandle.classList.remove("e", "w");
    vEdgeHandle.classList.add(vEdgeSide);
  }

  function nearestCorner(x: number, y: number, w: number, h: number): Corner {
    const vp = buttonViewport();
    const cx = x + w / 2;
    const cy = y + h / 2;
    const left = cx < vp.left + vp.width / 2;
    const top = cy < vp.top + vp.height / 2;
    return left ? (top ? "tl" : "bl") : top ? "tr" : "br";
  }

  // When the iOS soft-keyboard is up we pin the panel to the visual viewport
  // (see the visualViewport block below); applyLayout must respect that so a
  // stray window "resize" event doesn't yank the panel back under the keyboard.
  let keyboardPinned = false;
  const IOS_KEYBOARD_CHROME_RESERVE_PX = 92;

  function moveButton(x: number, y: number): void {
    if (opts.visualViewport && window.visualViewport) {
      // Keep dragging in the same client-coordinate transform as docking.
      // Adding left/top to this transform would apply the position twice.
      for (const [key, value] of Object.entries({left: '0px', top: '0px', right: 'auto', bottom: 'auto',
        transform: `translate(${x}px, ${y}px) scale(${1 / buttonViewport().scale})`, 'transform-origin': 'top left'})) {
        toggleBtn.style.setProperty(key, value, 'important');
      }
    } else {
      toggleBtn.style.right = toggleBtn.style.bottom = '';
      toggleBtn.style.left = `${x}px`;
      toggleBtn.style.top = `${y}px`;
    }
  }

  function applySafariViewport(): boolean {
    const vp=window.visualViewport;
    if(!opts.visualViewport || !vp)return false;
    const scale=vp.scale || 1,margin=6;
    const availableWidth=vp.width*scale,availableHeight=vp.height*scale;
    const left=layout.buttonCorner.endsWith('l'),top=layout.buttonCorner.startsWith('t');
    const buttonX=left?layout.buttonOffset.h:availableWidth-layout.buttonOffset.h-48;
    const buttonY=top?layout.buttonOffset.v:availableHeight-layout.buttonOffset.v-48;
    const button = clampToViewport(drag?.moved ? drag.x : vp.offsetLeft + buttonX / scale,
      drag?.moved ? drag.y : vp.offsetTop + buttonY / scale, 48 / scale, 48 / scale);
    moveButton(button.x, button.y);
    const compact=isMobile();
    const defaultSize=layout.panelSize.w===DEFAULT_LAYOUT.panelSize.w&&layout.panelSize.h===DEFAULT_LAYOUT.panelSize.h;
    const width=Math.max(1,Math.min(availableWidth-margin*2,compact&&defaultSize?availableWidth:layout.panelSize.w));
    const height=Math.max(1,Math.min(availableHeight-margin*2,compact&&defaultSize?availableHeight:layout.panelSize.h));
    // Dimensions are screen CSS pixels; translate in document coordinates and
    // counter the page's zoom so native Safari chrome cannot clip the controls.
    for(const [key,value] of Object.entries({left:'0px',top:'0px',right:'auto',bottom:'auto',width:`${width}px`,height:`${height}px`,'max-width':'none','max-height':'none',transform:`translate(${vp.offsetLeft+(availableWidth-width-margin)/scale}px, ${vp.offsetTop+margin/scale}px) scale(${1/scale})`,'transform-origin':'top left'}))panel.style.setProperty(key,value,'important');
    return true;
  }

  function pinToVisualViewport(): void {
    const vp = (window as any).visualViewport as VisualViewport | undefined;
    if (!vp) return;
    // iOS (WKWebView / Safari, incl. in-app browsers like Arc) lays out
    // `position:fixed` elements against the *layout* viewport, which does NOT
    // shrink when the soft keyboard opens. Setting `top`/`left` insets is
    // therefore ignored for the visible region — the panel drifts and the
    // composer ends up floating above the keyboard with the page showing
    // through (the visual-viewport offset is composited separately by the
    // browser). Anchoring at 0,0 and applying the offset via `transform`
    // (honored by the compositor) pins the panel flush to the visible area so
    // the composer sits right on top of the keyboard.
    panel.style.setProperty("left", "0px", "important");
    panel.style.setProperty("top", "0px", "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");
    panel.style.setProperty("width", `${vp.width}px`, "important");
    // iOS Safari's bottom address bar / keyboard accessory strip can overlay
    // the visual viewport instead of shrinking it. If we size the panel to the
    // full `visualViewport.height`, the composer lands under that native chrome
    // (user sees the URL pill + input accessory bar covering the panel). Reserve
    // a small strip while our textarea is focused so the composer stays above
    // Safari's own controls as well as above the keyboard.
    const reserve =
      document.activeElement === inputEl ? IOS_KEYBOARD_CHROME_RESERVE_PX : 0;
    panel.style.setProperty(
      "height",
      `${Math.max(260, vp.height - reserve)}px`,
      "important",
    );
    panel.style.setProperty("max-width", "none", "important");
    panel.style.setProperty("max-height", "none", "important");
    panel.style.setProperty(
      "transform",
      `translate(${vp.offsetLeft}px, ${vp.offsetTop}px)`,
      "important",
    );
    panel.style.setProperty("transform-origin", "top left", "important");
  }

  function unpinVisualViewport(): void {
    for (const p of [
      "left", "top", "right", "bottom",
      "width", "height", "max-width", "max-height",
      "transform", "transform-origin",
    ]) {
      panel.style.removeProperty(p);
    }
  }

  function applyLayout(next: Layout): void {
    layout = next;
    applyButtonPosition(next.buttonCorner, next.buttonOffset);
    if (applySafariViewport()) {
      // Safari uses the same visual bounds with and without its keyboard.
    } else if (keyboardPinned && isMobile()) {
      // Keyboard is open: keep the panel pinned above it. Geometry is restored
      // by onVvChange once the keyboard dismisses.
      pinToVisualViewport();
    } else {
      applyPanelPosition(next.panelCorner, next.panelSize);
    }
    // Resize handles are available on every form factor now (incl. mobile).
    for (const h of resizeHandles) h.style.display = "";
  }

  function persistLayout(): void {
    handlers.layout?.(layout);
  }

  // Re-apply on viewport changes (orientation, window resize, mobile keyboard).
  mobileMq.addEventListener?.("change", () => applyLayout(layout));
  window.addEventListener("resize", () => {
    // While the soft keyboard is up, the visualViewport handler below owns
    // positioning. Re-docking here would race it and leave the panel
    // mispositioned — composer mid-screen with the page showing through the
    // gap to the keyboard. Skip the re-dock in that case.
    const vp = (window as any).visualViewport as VisualViewport | undefined;
    if (
      vp &&
      isMobile() &&
      panel.classList.contains("open") &&
      window.innerHeight - (vp.height + vp.offsetTop) > 80
    ) {
      pinToVisualViewport();
      return;
    }
    applyLayout(layout);
  });

  // ── iOS soft-keyboard handling via visualViewport ──
  // When the on-screen keyboard pops up, the visual viewport shrinks (and may
  // scroll) even though window.innerHeight stays the same, so a position:fixed
  // panel drifts and the composer ends up hidden behind the keyboard. We pin the
  // panel to the visual viewport while the keyboard is up so the input stays
  // visible, then restore the user's layout when it dismisses.
  const vv = (window as any).visualViewport as VisualViewport | undefined;
  if (vv) {
    const onVvChange = (): void => {
      if(applySafariViewport())return;
      const isOpen = panel.classList.contains("open");
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      if (isOpen && isMobile() && overlap > 80) {
        keyboardPinned = true;
        pinToVisualViewport();
      } else if (keyboardPinned) {
        keyboardPinned = false;
        unpinVisualViewport();
        applyLayout(layout);
      }
    };
    vv.addEventListener("resize", onVvChange);
    vv.addEventListener("scroll", onVvChange);
    const sampleVvDuringKeyboardAnimation = (): void => {
      for (const delay of [60, 160, 320, 520]) {
        window.setTimeout(onVvChange, delay);
      }
    };
    // iOS doesn't always fire a visualViewport "resize" when the composer
    // gains focus (the keyboard animation can complete without one), and the
    // Safari bottom toolbar can settle later than the keyboard itself. Sample a
    // few animation frames so we don't pin to a transient geometry.
    inputEl.addEventListener("focus", sampleVvDuringKeyboardAnimation);
    inputEl.addEventListener("blur", sampleVvDuringKeyboardAnimation);
  }

  // ── pointer-drag the toggle button ──

  type DragState = {
    startX: number;
    startY: number;
    btnX: number;
    btnY: number;
    x: number;
    y: number;
    moved: boolean;
    pointerId: number;
  };
  let drag: DragState | null = null;
  const DRAG_THRESHOLD_PX = 6;

  toggleBtn.addEventListener("pointerdown", (e: PointerEvent) => {
    // Only respond to primary button / touch / pen.
    if (e.button !== undefined && e.button !== 0) return;
    const rect = toggleBtn.getBoundingClientRect();
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      btnX: rect.left,
      btnY: rect.top,
      x: rect.left,
      y: rect.top,
      moved: false,
      pointerId: e.pointerId,
    };
    // `setPointerCapture` is only valid for browser-managed active pointers.
    // Synthetic PointerEvents (e.g. MCP / tests dispatching pointerdown) do
    // not create an active pointer and Chrome correctly throws NotFoundError.
    // Skip capture for untrusted events; they can still exercise click/open
    // behavior through the matching synthetic pointerup.
    if (e.isTrusted) {
      toggleBtn.setPointerCapture(e.pointerId);
    }
  });

  toggleBtn.addEventListener("pointermove", (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (pendingOpen !== null) { clearTimeout(pendingOpen); pendingOpen = null; }
    lastTapAt = 0;
    e.preventDefault();
    toggleBtn.classList.add("dragging");
    const rect = toggleBtn.getBoundingClientRect();
    const clamped = clampToViewport(
      drag.btnX + dx,
      drag.btnY + dy,
      rect.width,
      rect.height,
    );
    drag.x = clamped.x; drag.y = clamped.y;
    moveButton(clamped.x, clamped.y);
  });

  // Double-tap detection for "snap back to default position" escape hatch.
  // We disambiguate single vs double tap by waiting a short window after the
  // first pointerup before committing to open(); a second pointerup inside
  // that window triggers a layout reset instead.
  let pendingOpen: number | null = null;
  let lastTapAt = 0;
  const DBL_TAP_MS = 320;

  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    toggleBtn.classList.remove("dragging");
    try {
      toggleBtn.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (wasDrag) {
      // Snap to nearest corner and compute the offset from that corner.
      const rect = toggleBtn.getBoundingClientRect();
      const corner = nearestCorner(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      );
      const vp = buttonViewport();
      const horiz =
        corner.endsWith('r') ? vp.left + vp.width - rect.right : rect.left - vp.left;
      const vert =
        corner.startsWith('b') ? vp.top + vp.height - rect.bottom : rect.top - vp.top;
      layout = {
        ...layout,
        buttonCorner: corner,
        buttonOffset: { h: Math.max(8, horiz * vp.scale), v: Math.max(8, vert * vp.scale) },
        // Panel follows the button to the same corner on drag.
        panelCorner: corner,
      };
      applyLayout(layout);
      persistLayout();
      lastTapAt = 0;
      return;
    }
    if (e.type === 'pointercancel') return;
    const now = Date.now();
    if (now - lastTapAt < DBL_TAP_MS) {
      // Second tap of a double-tap: cancel the pending open and reset layout.
      if (pendingOpen != null) {
        clearTimeout(pendingOpen);
        pendingOpen = null;
      }
      lastTapAt = 0;
      applyLayout({ ...DEFAULT_LAYOUT });
      persistLayout();
      return;
    }
    lastTapAt = now;
    if (pendingOpen != null) clearTimeout(pendingOpen);
    pendingOpen = window.setTimeout(() => {
      pendingOpen = null;
      open();
    }, DBL_TAP_MS);
  };
  toggleBtn.addEventListener("pointerup", endDrag);
  toggleBtn.addEventListener("pointercancel", endDrag);

  toggleBtn.title =
    "xgoose — tap to open · drag to move · double-tap to reset position";

  // ── pointer-resize the panel ──
  // Three handles (corner + 2 edges) all share the same logic. `axes` controls
  // which axes the handle affects: corner = both, h-edge = vertical only
  // (resizes height), v-edge = horizontal only (resizes width).

  type ResizeAxes = "corner" | "h" | "v";
  type ResizeState = {
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    pointerId: number;
    corner: Corner;
    axes: ResizeAxes;
    handle: HTMLElement;
  };
  let resize: ResizeState | null = null;

  function attachResizeHandle(handle: HTMLElement, axes: ResizeAxes): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      // Resizing is available on mobile too now; only the desktop "overlay"
      // (expand) mode ignores manual resize.
      if (panel.classList.contains("overlay")) return;
      e.stopPropagation();
      const rect = panel.getBoundingClientRect();
      resize = {
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
        pointerId: e.pointerId,
        corner: effectivePanelCorner,
        axes,
        handle,
      };
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      panel.classList.add("resizing");
    });

    handle.addEventListener("pointermove", (e: PointerEvent) => {
      if (!resize || e.pointerId !== resize.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - resize.startX;
      const dy = e.clientY - resize.startY;
      const horizSign =
        resize.corner === "br" || resize.corner === "tr" ? -1 : 1;
      const vertSign =
        resize.corner === "br" || resize.corner === "bl" ? -1 : 1;
      if (resize.axes === "corner" || resize.axes === "v") {
        const w = Math.max(
          320,
          Math.min(window.innerWidth - 16, resize.startW + dx * horizSign),
        );
        panel.style.width = `${w}px`;
      }
      if (resize.axes === "corner" || resize.axes === "h") {
        const h = Math.max(
          400,
          Math.min(window.innerHeight - 16, resize.startH + dy * vertSign),
        );
        panel.style.height = `${h}px`;
      }
    });

    const end = (e: PointerEvent): void => {
      if (!resize || e.pointerId !== resize.pointerId) return;
      const rect = panel.getBoundingClientRect();
      const h = resize.handle;
      resize = null;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      h.classList.remove("dragging");
      panel.classList.remove("resizing");
      layout = {
        ...layout,
        panelSize: { w: Math.round(rect.width), h: Math.round(rect.height) },
      };
      persistLayout();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  attachResizeHandle(cornerHandle, "corner");
  attachResizeHandle(hEdgeHandle, "h");
  attachResizeHandle(vEdgeHandle, "v");

  // Initial application of defaults (will be replaced by saved layout when
  // content/index.ts calls applyLayout()).
  applyLayout(layout);

  let userScrolledUp = false;
  msgs.addEventListener("scroll", () => {
    const distFromBottom =
      msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
    userScrolledUp = distFromBottom > 40;
  });

  function scroll(): void {
    if (userScrolledUp) return;
    requestAnimationFrame(() => {
      msgs.scrollTop = msgs.scrollHeight;
    });
  }

  function el(cls: string, html?: string): HTMLElement {
    const d = document.createElement("div");
    d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function append(node: HTMLElement): HTMLElement {
    clearEmptyState();
    msgs.appendChild(node);
    scroll();
    return node;
  }

  function clearEmptyState(): void {
    const empty = msgs.querySelector(".empty-state");
    if (empty) empty.remove();
  }

  function renderEmptyState(): void {
    msgs.innerHTML = `
      <div class="empty-state">
        <h3>What's on your mind?</h3>
        <p>Ask anything about this page. Skills active on this URL are listed above.</p>
        <p class="empty-hint">Try: "summarize this page", or "find the form on the page and tell me which fields are required".</p>
      </div>
    `;
  }
  renderEmptyState();

  // ── header buttons ──
  function open(): void {
    panel.classList.add("open");
    toggleBtn.classList.add("panel-open");
    if(opts.visualViewport)applyLayout(layout);
    handlers.open?.();
    if(!opts.visualViewport)setTimeout(() => inputEl.focus(), 50);
  }
  function close(): void {
    panel.classList.remove("open");
    toggleBtn.classList.remove("panel-open");
    handlers.close?.();
  }
  function toggle(): void {
    if (panel.classList.contains("open")) close();
    else open();
  }

  // (toggleBtn open-on-tap is handled inside endDrag — pointerup with no
  // movement counts as a tap and calls open().)
  btnClose.addEventListener("click", close);
  btnNew.addEventListener("click", () => {
    imageGeneration++;pendingImages=[];renderImages();imageError.hidden=true;
    handlers.fresh?.();
  });
  btnSettings.addEventListener("click", () => handlers.settings?.());
  btnExpand.addEventListener("click", () => panel.classList.toggle("overlay"));
  btnHistory.addEventListener("click", () => {
    const wasOpen = historyEl.classList.contains("open");
    // Mutual exclusion: opening History closes Todos and vice versa.
    todosEl.classList.remove("open");
    historyEl.classList.toggle("open", !wasOpen);
    if (!wasOpen) handlers.history?.();
  });

  btnTodos.addEventListener("click", () => {
    const wasOpen = todosEl.classList.contains("open");
    historyEl.classList.remove("open");
    todosEl.classList.toggle("open", !wasOpen);
    if (!wasOpen) handlers.todos?.();
  });

  // Cycle a todo's status when the user clicks its status circle. Order is
  // pending → in_progress → completed → pending. The content script enforces
  // the single-in_progress invariant before echoing the result back via
  // `setTodos`, so any rendering correction lands on the next tick.
  todosListEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const statusBtn = target.closest(".todo-status") as HTMLElement | null;
    if (!statusBtn) return;
    const item = statusBtn.closest(".todo-item") as HTMLElement | null;
    if (!item?.dataset.id) return;
    const current =
      (item.dataset.status as TodoUiStatus | undefined) ?? "pending";
    const next: TodoUiStatus =
      current === "pending"
        ? "in_progress"
        : current === "in_progress"
          ? "completed"
          : "pending";
    handlers.todoToggle?.(item.dataset.id, next);
  });

  todosClearBtn.addEventListener("click", () => {
    if (todosClearBtn.disabled) return;
    handlers.todoClear?.();
  });

  historyEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const act = target.closest(".history-act") as HTMLElement | null;
    if (act) {
      e.stopPropagation();
      const id = (act.closest(".history-item") as HTMLElement | null)?.dataset
        .id;
      if (!id) return;
      const action = act.dataset.action;
      if (action === "export") handlers.exportConvo?.(id);
      else if (action === "delete") handlers.deleteConvo?.(id);
      return;
    }
    const row = target.closest(".history-item") as HTMLElement | null;
    if (row?.dataset.id) {
      historyEl.classList.remove("open");
      handlers.loadConvo?.(row.dataset.id);
    }
  });

  // ── input ──
  function resizeInput(): void {
    inputEl.style.height = "auto";
    const css = getComputedStyle(inputEl);
    const borders = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    inputEl.style.height = Math.min(inputEl.scrollHeight + borders, 120) + "px";
  }
  inputEl.addEventListener("input", resizeInput);
  // Stop appearing, panel resizing and page zoom can all change line wrapping.
  let inputWidth = 0;
  const inputResizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(width - inputWidth) < 0.5) return;
    inputWidth = width;
    resizeInput();
  });
  inputResizeObserver.observe(inputEl);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // Send button always sends — the input stays enabled while the agent is
  // running, and the content script's onSend handler decides whether to
  // start a turn or queue the prompt for after the current turn finishes.
  // Stop is its own dedicated button (only visible while running).
  sendBtn.addEventListener("click", () => {
    const text = inputEl.value.trim();
    if (!handlers.send || imagePreparing || (!text && !pendingImages.length)) return;
    const images=pendingImages;pendingImages=[];renderImages();imageError.hidden=true;
    inputEl.value = "";
    inputEl.style.height = "auto";
    handlers.send?.(text || "What is in this image?", images);
  });

  stopBtn.addEventListener("click", () => {
    if (stopBtn.disabled) return;
    // Immediate visual feedback — even with the new abort-propagation fix
    // it takes one network round-trip for the LLM stream to actually close,
    // so without disabling here the button looks dead for ~100-300ms after
    // click. `setSending(false)` re-enables it once the stream tears down.
    stopBtn.disabled = true;
    stopBtn.textContent = "Stopping…";
    loadingTextEl.textContent = "Stopping…";
    loadingEl.classList.add("active");
    genBar.classList.add("active");
    handlers.stop?.();
  });

  // Delegated click on queued-message pills: × removes that index.
  queuedRow.addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement | null)?.closest(
      ".qrm",
    ) as HTMLButtonElement | null;
    if (!rm) return;
    const pill = rm.closest(".queued-pill") as HTMLElement | null;
    const idx = pill ? Number(pill.dataset.idx ?? "-1") : -1;
    if (idx >= 0) handlers.cancelQueued?.(idx);
  });

  shortcutsEl.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    // Skill actions SEND immediately (prompt, optionally js-then-analyze).
    const actionBtn = el?.closest(
      "button[data-skill-action]",
    ) as HTMLButtonElement | null;
    if (actionBtn) {
      handlers.skillActionRun?.({
        label: actionBtn.textContent ?? "",
        prompt: actionBtn.dataset.prompt ?? "",
        js: actionBtn.dataset.js || undefined,
      });
      return;
    }
    // Prefill shortcuts (example prompts): just populate the composer.
    const btn = el?.closest(
      "button[data-text]",
    ) as HTMLButtonElement | null;
    if (!btn) return;
    inputEl.value = btn.dataset.text ?? "";
    inputEl.dispatchEvent(new Event("input"));
    inputEl.focus();
  });

  // ── delegated handlers (tool expand, reasoning expand, reply post) ──
  msgs.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const replyBtn = target.closest(
      ".reply-post-btn",
    ) as HTMLButtonElement | null;
    if (replyBtn && !replyBtn.disabled) {
      const block = replyBtn.closest(".reply-block") as HTMLElement | null;
      const raw = block?.dataset.raw ?? "";
      const replyTo = block?.dataset.replyTo ?? null;
      if (!raw || !handlers.reply) return;
      replyBtn.disabled = true;
      replyBtn.textContent = "Posting…";
      handlers
        .reply(raw, replyTo)
        .then(() => {
          replyBtn.textContent = "Posted";
          replyBtn.classList.add("posted");
        })
        .catch((err) => {
          replyBtn.textContent = "Error";
          replyBtn.classList.add("errored");
          replyBtn.title = String(err?.message ?? err);
          setTimeout(() => {
            replyBtn.disabled = false;
            replyBtn.textContent = "Post";
            replyBtn.classList.remove("errored");
          }, 3000);
        });
      return;
    }

    const stepsHdr = target.closest(".steps-hdr") as HTMLElement | null;
    if (stepsHdr) {
      const open = stepsHdr.parentElement!.classList.toggle("open");
      stepsHdr.setAttribute("aria-expanded", String(open));
      return;
    }

    const toolHdr = target.closest(".tool-hdr") as HTMLElement | null;
    if (toolHdr) {
      const card = toolHdr.parentElement as HTMLElement | null;
      card?.querySelector(".tool-detail")?.classList.toggle("open");
      return;
    }

    const reasonHdr = target.closest(".reason-hdr") as HTMLElement | null;
    if (reasonHdr) {
      reasonHdr.parentElement?.classList.toggle("open");
    }
  });

  // ── tool card helpers ──

  function renderToolDetail(
    detail: HTMLElement,
    name: string,
    input: unknown,
    output: unknown,
    error?: string,
  ): void {
    const parts: string[] = [];

    if (input && typeof input === "object") {
      const inputObj = input as Record<string, unknown>;
      // js_exec: show chip strip + code body verbatim (the "summary of code"
      // the user wants visible while the tool runs / after it completes).
      if (name === "js_exec") {
        const chips = chipsFor(inputObj, [
          "purpose",
          "parallel_safe",
          "timeout_ms",
          "args",
        ]);
        if (chips) parts.push(`<div class="section">Input</div>${chips}`);
        const code = String(inputObj.code ?? "");
        if (code) {
          parts.push(
            `<div class="section">Code</div><pre class="code">${esc(code)}</pre>`,
          );
        }
      } else {
        const knownKeys = Object.keys(inputObj);
        if (knownKeys.length) {
          const chips = chipsFor(inputObj, knownKeys);
          if (chips) parts.push(`<div class="section">Input</div>${chips}`);
        }
      }
    }

    if (error) {
      parts.push(`<div class="section">Error</div><pre>${esc(error)}</pre>`);
    } else if (output !== undefined) {
      const raw = typeof output === "string" ? output : safeJson(output);
      const trunc =
        raw.length > 4000 ? raw.slice(0, 4000) + "\n…[truncated]" : raw;
      parts.push(`<div class="section">Output</div><pre>${esc(trunc)}</pre>`);
    }

    detail.innerHTML = parts.join("");
  }

  // ── activity groups ──
  // A run of consecutive tool calls and reasoning blocks shares one line that
  // shows the step in progress, then the count once the run is finished.
  // Failed calls are only marked inside the expanded list.

  function activityList(): HTMLElement {
    const last = msgs.lastElementChild;
    if (last?.classList.contains("steps")) return last.querySelector(".steps-list") as HTMLElement;
    const group = append(el(
      "steps",
      `<button class="steps-hdr" type="button" aria-expanded="false"><span class="steps-st"></span><span class="steps-label"></span><svg class="steps-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="steps-list"></div>`,
    ));
    return group.querySelector(".steps-list") as HTMLElement;
  }

  function syncActivity(list: HTMLElement): void {
    const group = list.parentElement as HTMLElement;
    const items = Array.from(list.children);
    const active = items.filter((item) => item.matches(".running,.waiting")).at(-1);
    const tools = items.filter((item) => item.classList.contains("tool"));
    const status = group.querySelector(".steps-st") as HTMLElement;
    status.className = active ? "steps-st" : "steps-st done";
    status.innerHTML = active ? '<div class="sp"></div>' : "✓";
    (group.querySelector(".steps-label") as HTMLElement).textContent = active
      ? (active.querySelector(".tool-title,.reason-label") as HTMLElement).textContent
      : tools.length
        ? `${tools.length} action${tools.length === 1 ? "" : "s"}`
        : "Thought";
  }

  function createToolCard(name: string, input: unknown): ToolCardHandle {
    const meta = describeToolCall(name, input);
    const card = el(
      "tool running",
      `
      <div class="tool-hdr">
        <div class="tool-st running"><div class="sp"></div></div>
        <div class="tool-body">
          <div class="tool-title"></div>
          <div class="tool-sub"></div>
        </div>
      </div>
      <div class="tool-detail"></div>
    `,
    );
    card.dataset.toolName = name;
    (card.querySelector(".tool-title") as HTMLElement).textContent = meta.title;
    (card.querySelector(".tool-sub") as HTMLElement).textContent =
      meta.subtitle;
    const detail = card.querySelector(".tool-detail") as HTMLElement;
    renderToolDetail(detail, name, input, undefined);
    const list = activityList();
    list.appendChild(card);
    syncActivity(list);
    scroll();
    return {
      el: card,
      setResult(output, error) {
        // Tools report expected failures as {ok:false,error}; show them as failures.
        const failure = error ?? ((output as {ok?: boolean})?.ok === false ? String((output as {error?: unknown}).error ?? "Tool failed") : undefined);
        const st = card.querySelector(".tool-st") as HTMLElement;
        const sub = card.querySelector(".tool-sub") as HTMLElement;
        card.classList.remove("running", "waiting", "done", "error");
        if (failure) {
          card.classList.add("error");
          st.className = "tool-st error";
          st.textContent = "✕";
          sub.textContent = truncate(failure, 120);
        } else if (name === "wait_agents" && (output as {waiting?: boolean})?.waiting) {
          card.classList.add("waiting");
          st.className = "tool-st running";
          st.innerHTML = '<div class="sp"></div>';
          sub.textContent = "Waiting for peer results…";
        } else {
          card.classList.add("done");
          st.className = "tool-st done";
          st.textContent = "✓";
          sub.textContent = summarizeToolResult(name, output);
        }
        renderToolDetail(detail, name, input, output, failure);
        syncActivity(card.parentElement as HTMLElement);
        scroll();
      },
    };
  }

  // ── reasoning ──

  let _reasonBuf = "";
  let _reasonTimer: number | null = null;
  let _reasonBody: HTMLElement | null = null;
  const RENDER_INTERVAL = 80;

  function addReasoningBlock(): ReasoningBlockHandle {
    const block = el(
      "reason running",
      `
      <div class="reason-hdr">
        <span class="reason-arrow">▶</span>
        <span class="reason-label">Thinking…</span>
      </div>
      <div class="reason-body"></div>
    `,
    );
    const list = activityList();
    list.appendChild(block);
    syncActivity(list);
    scroll();
    _reasonBuf = "";
    _reasonBody = null;
    if (_reasonTimer != null) {
      clearTimeout(_reasonTimer);
      _reasonTimer = null;
    }
    return {
      el: block,
      appendDelta(text: string) {
        _reasonBuf += text;
        if (!_reasonBody) _reasonBody = block.querySelector(".reason-body");
        if (_reasonTimer != null) return;
        _reasonTimer = window.setTimeout(() => {
          _reasonTimer = null;
          if (_reasonBody) {
            _reasonBody.appendChild(document.createTextNode(_reasonBuf));
          }
          _reasonBuf = "";
          scroll();
        }, RENDER_INTERVAL);
      },
      finalize() {
        if (_reasonTimer != null) {
          clearTimeout(_reasonTimer);
          _reasonTimer = null;
        }
        const body = block.querySelector(".reason-body") as HTMLElement;
        if (_reasonBuf) {
          body.appendChild(document.createTextNode(_reasonBuf));
          _reasonBuf = "";
        }
        body.normalize();
        _reasonBody = null;
        const label = block.querySelector(".reason-label") as HTMLElement;
        label.textContent = `Thinking · ${body.textContent!.length} chars`;
        block.classList.remove("running");
        syncActivity(list);
      },
    };
  }

  // ── thinking + streaming + assistant bubble ──

  let _thinkingEl: HTMLElement | null = null;
  function showThinking(label?: string): void {
    if (_thinkingEl) return;
    _thinkingEl = append(
      el(
        "thinking",
        `<div class="sp"></div><span>${esc(label || "Thinking…")}</span>`,
      ),
    );
  }
  function removeThinking(): void {
    if (!_thinkingEl) return;
    _thinkingEl.remove();
    _thinkingEl = null;
  }

  function addUserMessage(text: string, images:ImageAttachment[]=[]): HTMLElement {
    userScrolledUp = false;
    const wrap = el("msg-user-wrap");
    const bubble = document.createElement("div");
    bubble.className = "msg-user";
    bubble.textContent = text;
    for(const image of images){const img=document.createElement("img");img.src=imageDataUrl(image);img.alt=image.name||"Attached image";bubble.append(img);}
    wrap.appendChild(bubble);
    return append(wrap);
  }

  function addAssistantBubble(): AssistantBubbleHandle {
    const node = el("msg-ai");
    append(node);
    let cached = "";
    let renderTimer: number | null = null;
    function updateMarkdown(text: string): void {
      cached = text;
      if (renderTimer != null) return;
      renderTimer = window.setTimeout(() => {
        renderTimer = null;
        // While streaming, render as plain text to avoid expensive re-parsing
        node.style.whiteSpace = "pre-wrap";
        node.textContent = cached.replace(/<br\s*\/?>/gi, "\n");
        scroll();
      }, RENDER_INTERVAL);
    }
    function finalize(): void {
      if (renderTimer != null) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      node.style.whiteSpace = "";
      node.innerHTML = renderMarkdown(cached);
      scroll();
    }
    return { el: node, updateMarkdown, finalize };
  }

  function addErrorMessage(text: string): void {
    const node = el("msg-err");
    node.textContent = text;
    append(node);
  }

  // ── public API ──

  return {
    open,
    close,
    toggle,
    isOpen: () => panel.classList.contains("open"),

    setAppearance(state) {
      const dark=matchMedia("(prefers-color-scheme: dark)").matches;
      applyAppearance(host,state,dark);applyAppearance(panel,state,dark);
      panel.classList.toggle("light",host.dataset.xgMode==="light");
      panel.style.fontFamily="var(--xg-font,inherit)";
    },

    setTheme(theme) {
      panel.classList.toggle("light", theme === "light");
    },

    setLauncherVisible(visible) {
      // `panel-open` already hides the launcher while the chat is open, so a
      // `false` here only suppresses the closed/launcher state.
      toggleBtn.classList.toggle("launcher-hidden", !visible);
    },

    setSkills(skills) {
      ($(".skills-login-hint") as HTMLElement).hidden = !skills.some(skill => skill.enabled !== false);
      skillsList.innerHTML = "";
      if (!skills.length) {
        const span = document.createElement("span");
        span.className = "empty";
        span.textContent = "none active on this page";
        skillsList.appendChild(span);
        return;
      }
      for (const s of skills) {
        const chip = document.createElement("button");
        chip.className = "skill-chip";
        if (s.userAuthored) chip.classList.add("user-authored");
        if (s.enabled === false) chip.classList.add("disabled");
        chip.type = "button";
        chip.textContent = s.namespace;
        const titleBits = [`${s.name} (namespace: ${s.namespace})`];
        if (s.userAuthored) titleBits.push("custom");
        if (s.enabled === false) titleBits.push("disabled");
        chip.title = titleBits.join(" · ") + "\nClick for actions";
        chip.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openSkillMenu(chip, s);
        });
        skillsList.appendChild(chip);
      }
    },
    onSkillAction(handler) {
      handlers.skillAction = handler;
    },
    onSkillActionRun(cb) {
      handlers.skillActionRun = cb;
    },

    setShortcuts(shortcuts) {
      // Only clear prefill shortcuts; leave any skill-action buttons intact.
      shortcutsEl
        .querySelectorAll("button[data-text]")
        .forEach((b) => b.remove());
      for (const sc of shortcuts) {
        const b = document.createElement("button");
        b.dataset.text = sc.text;
        b.textContent = sc.label;
        shortcutsEl.appendChild(b);
      }
    },

    setSkillActions(actions) {
      // Replace only the skill-action buttons; keep prefill shortcuts.
      shortcutsEl
        .querySelectorAll("button[data-skill-action]")
        .forEach((b) => b.remove());
      for (const a of actions) {
        if (!a?.label || !a?.prompt) continue;
        const b = document.createElement("button");
        b.dataset.skillAction = "1";
        b.dataset.prompt = a.prompt;
        if (a.js) b.dataset.js = a.js;
        b.textContent = a.label;
        shortcutsEl.appendChild(b);
      }
    },

    setApiKeyMissing(missing, openSettings) {
      if (!missing) return;
      msgs.innerHTML = "";
      const wrap = el("empty-state");
      wrap.innerHTML = `
        <h3>API key needed</h3>
        <p>You've selected a bring-your-own-key provider. Add a key in settings, or switch to xgoose Hosted AI to chat for free with no key.</p>
        <div class="api-warn">Open settings to add a key or switch to Hosted AI.</div>
      `;
      const btn = document.createElement("button");
      btn.className = "api-cta";
      btn.textContent = "Open settings";
      btn.addEventListener("click", openSettings);
      wrap.appendChild(btn);
      msgs.appendChild(wrap);
    },

    clear() {
      imageGeneration++;pendingImages=[];renderImages();imageError.hidden=true;
      msgs.innerHTML = "";
      statusEl.textContent = "";
      metricsEl.classList.remove("active");
      metricsEl.textContent = "";
      metricsEl.title = "";
      contextMeter.hidden=true;
      renderEmptyState();
    },

    addUserMessage,
    addAssistantBubble,
    addToolCard: createToolCard,
    addReasoningBlock,
    addErrorMessage,
    addInterruptedTurn(text, actions) {
      const node = el("msg-recovery");
      const message = document.createElement("div");
      message.className = "recovery-message";
      message.textContent = text;
      message.setAttribute("role", "status");
      message.setAttribute("data-no-i18n", "");
      const controls = el("recovery-actions");
      if (actions.retry) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "bug-control recovery-retry";
        retry.textContent = "Retry";
        retry.addEventListener("click", event => { if (event.isTrusted) actions.retry?.(); });
        controls.append(retry);
      }
      const report = document.createElement("button");
      report.type = "button";
      report.className = "bug-control recovery-report";
      report.textContent = "Report a bug";
      report.addEventListener("click", event => {
        if (event.isTrusted) actions.report();
      });
      controls.append(report);
      node.append(message, controls);
      if (actions.detail) {
        const details = el("recovery-detail");
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Error details";
        const detail = el("msg-err");
        detail.textContent = actions.detail;
        disclosure.append(summary, detail);
        details.append(disclosure);
        node.append(details);
      } else {
        message.classList.add("msg-err");
      }
      append(node);
    },
    onReportBug(open) {
      openBugReport = open;
      reportButton.hidden = false;
    },
    showThinking,
    removeThinking,

    setGenerating(active) {
      genBar.classList.toggle("active", active);
    },
    setStatus(text) {
      statusEl.textContent = text;
    },
    setLoadingStatus(text) {
      if (text == null || text === "") {
        loadingEl.classList.remove("active");
        loadingTextEl.textContent = "";
        genBar.classList.remove("active");
      } else {
        loadingTextEl.textContent = text;
        loadingEl.classList.add("active");
        genBar.classList.add("active");
      }
    },
    setUsage(usage) {
      if (!usage || usage.totalTokens <= 0) {
        metricsEl.classList.remove("active");
        metricsEl.textContent = "";
        metricsEl.title = "";
        return;
      }
      const tokens = formatTokens(usage.totalTokens);
      const turns = `${usage.turns}\u00d7`;
      const cachePct =
        usage.inputTokens > 0
          ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
          : 0;
      const cacheCls = cachePct >= 25 ? "cache-hit" : "cache-miss";
      const parts: string[] = [];
      parts.push(`<span>${tokens}t</span>`);
      if (usage.inputTokens > 0) {
        parts.push('<span class="sep">\u00b7</span>');
        parts.push(
          `<span class="${cacheCls}" data-cache>${cachePct}%\u21bb</span>`,
        );
      }
      parts.push('<span class="sep">\u00b7</span>');
      parts.push(`<span>${turns}</span>`);
      if (usage.costUsd > 0) {
        const marker = usage.unpricedTurns > 0 ? "*" : "";
        parts.push('<span class="sep">\u00b7</span>');
        parts.push(
          `<span class="cost">${formatUsd(usage.costUsd)}${marker}</span>`,
        );
      }
      metricsEl.innerHTML = parts.join("");
      const tip: string[] = [];
      tip.push(`input: ${usage.inputTokens.toLocaleString()}`);
      if (usage.cachedInputTokens > 0) {
        tip.push(
          `  cached: ${usage.cachedInputTokens.toLocaleString()} (${cachePct}%)`,
        );
      }
      tip.push(`output: ${usage.outputTokens.toLocaleString()}`);
      if (usage.reasoningTokens > 0) {
        tip.push(`reasoning: ${usage.reasoningTokens.toLocaleString()}`);
      }
      tip.push(`total: ${usage.totalTokens.toLocaleString()}`);
      tip.push(`turns: ${usage.turns}`);
      if (usage.costUsd > 0) {
        tip.push(
          `cost: ${formatUsd(usage.costUsd)}` +
            (usage.unpricedTurns > 0
              ? ` (* ${usage.unpricedTurns} turn${usage.unpricedTurns === 1 ? "" : "s"} on unpriced model${usage.unpricedTurns === 1 ? "" : "s"} excluded)`
              : ""),
        );
      }
      metricsEl.title = tip.join("\n");
      metricsEl.classList.add("active");
    },
    setContextUsage(usage){
      if(usage&&'tokens' in usage){
        if(!Number.isFinite(usage.tokens)||!Number.isFinite(usage.contextWindow)||usage.contextWindow<=0){contextMeter.hidden=true;return;}
        contextMeter.hidden=false;contextMeter.textContent=`Context ${Math.round(100*usage.tokens/usage.contextWindow)}%`;
        contextMeter.title=`${usage.model}: ${usage.estimated?'Estimated current input':'Current input'} ${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens; ${usage.outputReserve.toLocaleString()} tokens reserved for output. Includes system instructions, tools and images. Provider limits are authoritative. Cumulative conversation token usage is separate.`;
        contextMeter.setAttribute('aria-label',contextMeter.title);return;
      }
      if(!usage||!Number.isFinite(usage.textBytes)||!Number.isFinite(usage.limitBytes)||usage.limitBytes<=0){contextMeter.hidden=true;return;}
      contextMeter.hidden=false;contextMeter.textContent=`Context ${Math.round(100*usage.textBytes/usage.limitBytes)}%`;
      contextMeter.title=`Gateway measured current request: ${usage.textBytes.toLocaleString()} / ${usage.limitBytes.toLocaleString()} UTF-8 bytes. Image bytes are excluded. Conversation token totals are separate.`;
      contextMeter.setAttribute("aria-label",contextMeter.title);
    },
    setSending(sending) {
      // Input stays enabled the whole time — typing while the agent is
      // running queues the next prompt instead of being blocked. The
      // Send button stays "Send"; Stop is a dedicated button that only
      // appears while a turn is in progress.
      inputEl.disabled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      sendBtn.classList.remove("stop");
      stopBtn.classList.toggle("active", sending);
      resizeInput();
      if (!sending) {
        stopBtn.disabled = false;
        stopBtn.textContent = "Stop";
      }
    },
    setQueuedMessages(items) {
      queuedRow.innerHTML = "";
      if (!items.length) {
        queuedRow.classList.remove("active");
        return;
      }
      const label = document.createElement("span");
      label.className = "qlabel";
      label.textContent =
        items.length === 1 ? "queued:" : `${items.length} queued:`;
      queuedRow.appendChild(label);
      items.forEach((text, idx) => {
        const pill = document.createElement("span");
        pill.className = "queued-pill";
        pill.dataset.idx = String(idx);
        const preview =
          text.length > 80 ? text.slice(0, 77).trimEnd() + "…" : text;
        const single = preview.replace(/\s+/g, " ");
        const txt = document.createElement("span");
        txt.className = "qtext";
        txt.textContent = single;
        txt.title = text;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "qrm";
        rm.title = "Remove from queue";
        rm.textContent = "\u00d7";
        pill.appendChild(txt);
        pill.appendChild(rm);
        queuedRow.appendChild(pill);
      });
      queuedRow.classList.add("active");
    },

    setHistory(items) {
      historyEl.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent =
          "No saved conversations yet. Start one in the chat and it will show up here.";
        historyEl.appendChild(empty);
        return;
      }
      // Group by origin: this site first, then others.
      const here = location.origin;
      const sameOrigin = items.filter((i) => i.origin === here);
      const otherOrigin = items.filter((i) => i.origin !== here);
      if (sameOrigin.length) {
        historyEl.appendChild(makeHistorySection("This site"));
        for (const it of sameOrigin) historyEl.appendChild(makeHistoryRow(it));
      }
      if (otherOrigin.length) {
        historyEl.appendChild(makeHistorySection("Other sites"));
        for (const it of otherOrigin) historyEl.appendChild(makeHistoryRow(it));
      }
    },
    showHistory(visible) {
      historyEl.classList.toggle("open", visible);
      if (visible) {
        todosEl.classList.remove("open");
        handlers.history?.();
      }
    },
    isHistoryOpen: () => historyEl.classList.contains("open"),

    setTodos(items) {
      const total = items.length;
      const done = items.filter((t) => t.status === "completed").length;
      const hasActive = items.some((t) => t.status === "in_progress");

      // Toolbar counter pill: hidden when there are no todos.
      if (total === 0) {
        todoCountEl.classList.remove("active");
        todoCountEl.textContent = "";
        btnTodos.classList.remove("has-active");
      } else {
        todoCountEl.classList.add("active");
        todoCountEl.textContent = `${done}/${total}`;
        btnTodos.classList.toggle("has-active", hasActive);
      }

      // Panel header summary mirrors the pill plus the active item's verb.
      if (total === 0) {
        todosSummaryEl.textContent = "";
      } else {
        const active = items.find((t) => t.status === "in_progress");
        const base = `${done}/${total} done`;
        todosSummaryEl.textContent = active
          ? `${base} · in progress: ${active.activeForm}`
          : base;
      }
      todosClearBtn.disabled = total === 0;

      todosListEl.innerHTML = "";
      if (total === 0) {
        const empty = document.createElement("div");
        empty.className = "todos-empty";
        empty.innerHTML =
          "No todos yet. The agent populates this list when it calls <code>todo_write</code> for multi-step tasks. You can also click a status circle here to nudge progress manually.";
        todosListEl.appendChild(empty);
        return;
      }
      for (const t of items) todosListEl.appendChild(makeTodoRow(t));
    },
    showTodos(visible) {
      todosEl.classList.toggle("open", visible);
      if (visible) {
        historyEl.classList.remove("open");
        handlers.todos?.();
      }
    },
    isTodosOpen: () => todosEl.classList.contains("open"),

    applyLayout,
    onLayoutChange(cb) {
      handlers.layout = cb;
    },

    onSend(cb) {
      handlers.send = cb;
      sendBtn.disabled = imagePreparing;
    },
    onStop(cb) {
      handlers.stop = cb;
    },
    onCancelQueued(cb) {
      handlers.cancelQueued = cb;
    },
    onNew(cb) {
      handlers.fresh = cb;
    },
    onSettings(cb) {
      handlers.settings = cb;
    },
    onHistory(cb) {
      handlers.history = cb;
      // A user can open history while the host is still restoring its session.
      if (historyEl.classList.contains("open")) cb();
    },
    onTodos(cb) {
      handlers.todos = cb;
    },
    onTodoToggle(cb) {
      handlers.todoToggle = cb;
    },
    onTodoClear(cb) {
      handlers.todoClear = cb;
    },
    onLoadConversation(cb) {
      handlers.loadConvo = cb;
    },
    onDeleteConversation(cb) {
      handlers.deleteConvo = cb;
    },
    onExportConversation(cb) {
      handlers.exportConvo = cb;
    },
    onReplyPost(cb) {
      handlers.reply = cb;
    },
    onOpen(cb) {
      handlers.open = cb;
    },
    onClose(cb) {
      handlers.close = cb;
    },
  };
}

function makeHistorySection(label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "history-section";
  el.textContent = label;
  return el;
}

function makeHistoryRow(item: HistoryItem): HTMLElement {
  const row = document.createElement("div");
  row.className = "history-item" + (item.current ? " current" : "");
  row.dataset.id = item.id;
  const body = document.createElement("div");
  body.className = "history-item-body";
  const title = document.createElement("div");
  title.className = "history-item-title";
  title.textContent = item.title || "Untitled";
  title.title = item.title || "";
  const meta = document.createElement("div");
  meta.className = "history-item-meta";
  const ago = formatRelative(item.updatedAt);
  const hostname = hostnameOf(item.origin);
  meta.textContent = `${ago} · ${item.messageCount} msg · ${hostname}`;
  body.appendChild(title);
  body.appendChild(meta);

  const actions = document.createElement("span");
  actions.className = "history-item-actions";
  const exportBtn = document.createElement("span");
  exportBtn.className = "history-act export";
  exportBtn.dataset.action = "export";
  exportBtn.title = "Export as Markdown";
  exportBtn.textContent = "↓";
  const del = document.createElement("span");
  del.className = "history-act del";
  del.dataset.action = "delete";
  del.title = "Delete";
  del.textContent = "×";
  actions.appendChild(exportBtn);
  actions.appendChild(del);

  row.appendChild(body);
  row.appendChild(actions);
  return row;
}

function makeTodoRow(item: TodoUiItem): HTMLElement {
  const row = document.createElement("div");
  row.className = `todo-item ${item.status}`;
  row.dataset.id = item.id;
  row.dataset.status = item.status;

  const status = document.createElement("button");
  status.type = "button";
  status.className = "todo-status";
  status.title =
    item.status === "pending"
      ? "Mark in progress"
      : item.status === "in_progress"
        ? "Mark completed"
        : "Reopen";

  const text = document.createElement("div");
  text.className = "todo-text";
  // Show the active-form verb while in progress to match the agent's
  // convention (matches the system reminder rendering).
  text.textContent =
    item.status === "in_progress" ? item.activeForm : item.content;

  row.appendChild(status);
  row.appendChild(text);
  return row;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Compact token count rendering for the status bar: 1234 → "1.2K",
// 1_234_567 → "1.2M". Keeps things to <=4 chars wide so the status row
// doesn't push the cost off-screen on narrow mobile panels.
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  if (n < 1_000_000) return Math.round(n / 1000) + "K";
  return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
}

// USD rendering tuned for small per-conversation totals. <$0.01 shows 4
// decimals so the user can see they spent _something_; >=$1 trims to 2.
function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.01) return "$" + usd.toFixed(4);
  if (usd < 1) return "$" + usd.toFixed(3);
  return "$" + usd.toFixed(2);
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin || "unknown";
  }
}

// ── helpers ──

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function chipsFor(obj: Record<string, unknown>, keys: string[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(
      `<span class="chip"><span class="chip-key">${esc(k)}</span><span class="chip-eq">=</span><span class="chip-val">${esc(
        stringifyChipValue(v),
      )}</span></span>`,
    );
  }
  if (!parts.length) return "";
  return `<div class="chip-strip">${parts.join("")}</div>`;
}

function stringifyChipValue(v: unknown): string {
  if (typeof v === "string")
    return v.length > 60 ? '"' + v.slice(0, 57) + '…"' : '"' + v + '"';
  if (Array.isArray(v)) {
    const s = v
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(",");
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  }
  if (typeof v === "object" && v !== null) {
    const s = safeJson(v).replace(/\s+/g, " ");
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  }
  return String(v);
}
