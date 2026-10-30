// Shadow-DOM floating chat panel.
//
// Ported as closely as practical from uscardforum-qa's src/ui.js so behaviour
// matches the reference userscript (tool cards with running spinner → done
// check, reasoning blocks with char-count + arrow, debounced streaming text
// render, thinking indicator, generation progress bar, gradient toggle, reuse
// of completed tool cards for repeat calls, scroll-up auto-pause, expand-to-
// overlay button, reply-block fences). xgoose-specific additions:
//   • skills chip row showing which skills are active on the current page
//   • Settings/History buttons open extension-level UI (no inline settings
//     panel — settings live on the dedicated options page)
//   • tool-card details know about `js_exec` and render a chip strip
//     (purpose/parallel_safe/timeout_ms) plus a syntax-highlighted code body
//     so the user can read what the model is about to run before it runs.

import {prepareImage,imageDataUrl,MAX_ATTACHMENTS,type ImageAttachment} from "./images";
import { renderMarkdown } from "./markdown";
import {
  describeToolCall,
  summarizeToolResult,
  type ToolDescription,
} from "./toolLabels";
import { DEFAULT_LAYOUT, type Corner, type Layout } from "./layout";

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:host{
  all:initial;
  font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI Variable','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  font-size:13px;line-height:1.5;
  font-feature-settings:'cv11','ss01','ss03',normal;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  text-rendering:optimizeLegibility;
  color-scheme:dark light;
}

/* ── theme tokens ──
 * Aligned with the xgoose.org design system: indigo (252) → violet (280) →
 * pink (326) gradient on near-black ink. The panel exposes the same
 * --gradient-from / via / to as the marketing site so any element can opt
 * into the brand gradient with one declaration.
 */
.panel{
  --bg:#08080d;
  --bg-elevated:rgba(22,22,30,.78);
  --bg-input:rgba(255,255,255,.04);
  --bg-hover:rgba(139,92,246,.10);
  --bg-active:rgba(139,92,246,.18);
  --border:rgba(255,255,255,.07);
  --border-strong:rgba(139,92,246,.28);
  --border-input:rgba(255,255,255,.09);
  --text:#d4d8e0;
  --text-strong:#f7f7fb;
  --text-muted:#888a96;
  --text-faint:#4a4a52;
  --text-ai:#c6cad3;
  --text-ai-head:#ececf2;
  --code-bg:rgba(6,6,12,.85);
  --code-text:#c7b8ff;
  --code-inline:rgba(168,85,247,.14);
  --tool-bg:rgba(22,22,30,.6);
  --tool-border:rgba(255,255,255,.08);
  --reason-bg:rgba(22,22,30,.55);
  --err-bg:rgba(239,68,68,.10);
  --err-border:rgba(239,68,68,.30);
  --err-text:#fda4af;
  --table-border:rgba(168,85,247,.20);
  --table-th-bg:rgba(168,85,247,.10);
  --send-disabled-bg:rgba(255,255,255,.04);
  --chip-bg:rgba(168,85,247,.12);
  --chip-key:#c4b5fd;
  --chip-val:#ede9fe;
  --select-opt-bg:#13131c;
  --gradient-from:#6366f1;
  --gradient-via:#a855f7;
  --gradient-to:#ec4899;
  --grad-from-rgb:99,102,241;
  --grad-via-rgb:168,85,247;
  --grad-to-rgb:236,72,153;
  --grad-soft:0deg,rgba(99,102,241,.22),rgba(168,85,247,.20),rgba(236,72,153,.18);
  --halo-1:rgba(99,102,241,.18);
  --halo-2:rgba(168,85,247,.16);
  --halo-3:rgba(236,72,153,.14);
  --shadow:
    0 1px 0 rgba(255,255,255,.04) inset,
    0 0 0 1px rgba(168,85,247,.15),
    0 24px 60px -12px rgba(0,0,0,.65),
    0 0 60px -12px rgba(99,102,241,.30);
}
.panel.light{
  --bg:#ffffff;
  --bg-elevated:rgba(244,244,251,.85);
  --bg-input:rgba(15,23,42,.04);
  --bg-hover:rgba(99,102,241,.06);
  --bg-active:rgba(99,102,241,.12);
  --border:rgba(15,23,42,.08);
  --border-strong:rgba(99,102,241,.30);
  --border-input:rgba(15,23,42,.12);
  --text:#1c1c25;
  --text-strong:#0a0a14;
  --text-muted:#5b5b6c;
  --text-faint:#a1a1ad;
  --text-ai:#2a2a36;
  --text-ai-head:#0a0a14;
  --code-bg:#f3f2fb;
  --code-text:#6d28d9;
  --code-inline:rgba(99,102,241,.10);
  --tool-bg:rgba(248,248,253,.85);
  --tool-border:rgba(15,23,42,.08);
  --reason-bg:rgba(248,248,253,.85);
  --err-bg:rgba(239,68,68,.06);
  --err-border:rgba(239,68,68,.25);
  --err-text:#dc2626;
  --table-border:rgba(99,102,241,.18);
  --table-th-bg:rgba(99,102,241,.06);
  --send-disabled-bg:rgba(15,23,42,.06);
  --chip-bg:rgba(99,102,241,.08);
  --chip-key:#5b21b6;
  --chip-val:#3730a3;
  --select-opt-bg:#ffffff;
  --halo-1:rgba(99,102,241,.10);
  --halo-2:rgba(168,85,247,.10);
  --halo-3:rgba(236,72,153,.08);
  --shadow:
    0 1px 0 rgba(255,255,255,.9) inset,
    0 0 0 1px rgba(99,102,241,.12),
    0 18px 48px -16px rgba(15,23,42,.18),
    0 0 36px -14px rgba(99,102,241,.18);
}

/* ── floating toggle ──
 * Drag anywhere; double-tap to reset; default bottom-right with safe-area
 * insets baked in. The button is a brand-gradient pebble with an animated
 * conic halo for the "alive" feel.
 */
.toggle{
  position:fixed;
  width:48px;height:48px;border-radius:16px;
  background:linear-gradient(135deg,#6366f1,#a855f7 55%,#ec4899);
  background-size:220% 220%;
  -webkit-animation:gshift 6s ease infinite;animation:gshift 6s ease infinite;
  color:#fff;border:none;cursor:grab;
  z-index:2147483647;
  display:flex;align-items:center;justify-content:center;
  font-size:21px;font-weight:600;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.10) inset,
    0 6px 18px -2px rgba(99,102,241,.45),
    0 18px 36px -8px rgba(0,0,0,.55);
  transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease,
             left .2s ease,top .2s ease,right .2s ease,bottom .2s ease,
             border-radius .2s ease;
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;touch-action:none;
  isolation:isolate;
}
/* Animated halo ring behind the button — hidden when reduced motion. */
.toggle::before{
  content:"";position:absolute;inset:-6px;border-radius:22px;
  background:conic-gradient(from 0deg,
    rgba(99,102,241,.55),rgba(168,85,247,.55),
    rgba(236,72,153,.55),rgba(99,102,241,.55));
  filter:blur(10px);opacity:.55;
  z-index:-1;
  -webkit-animation:halo 8s linear infinite;animation:halo 8s linear infinite;
  pointer-events:none;
}
.toggle:hover{transform:translateY(-2px) scale(1.06)}
.toggle:hover::before{opacity:.85}
.toggle.dragging{
  cursor:grabbing;transform:scale(1.12);
  transition:transform .12s ease,box-shadow .12s ease,border-radius .12s ease;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.12) inset,
    0 0 32px rgba(168,85,247,.55),
    0 20px 48px -6px rgba(0,0,0,.65);
}
.toggle.dragging::before{opacity:1;-webkit-animation-duration:3s;animation-duration:3s}
.toggle.panel-open{display:none}
.toggle.launcher-hidden{display:none}
@-webkit-keyframes gshift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@keyframes gshift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@-webkit-keyframes halo{to{transform:rotate(360deg)}}
@keyframes halo{to{transform:rotate(360deg)}}

/* ── panel shell ──
 * Glassmorphic shell with an animated brand gradient hairline (rendered as
 * a ::before that uses mask compositing so the gradient only shows on the
 * border). Falls back to a solid border on engines without mask support.
 *
 * Position/size are set inline by JS; defaults below are mobile-first.
 */
.panel{
  position:fixed;
  background:
    radial-gradient(800px 600px at 0% 0%,var(--halo-1),transparent 55%),
    radial-gradient(700px 500px at 100% 0%,var(--halo-2),transparent 55%),
    radial-gradient(900px 600px at 50% 110%,var(--halo-3),transparent 60%),
    var(--bg);
  color:var(--text);
  border-radius:20px;
  box-shadow:var(--shadow);
  display:none;flex-direction:column;
  z-index:2147483646;overflow:clip;
  min-width:0;min-height:0;
  -webkit-backdrop-filter:saturate(160%) blur(22px);
  backdrop-filter:saturate(160%) blur(22px);
  transition:box-shadow .25s ease,border-radius .25s ease;
  isolation:isolate;
}
/* Static gradient hairline; it must never rotate through panel content. */
.panel::before{
  content:"";position:absolute;inset:0;pointer-events:none;
  border-radius:inherit;padding:1px;
  background:conic-gradient(from 220deg,
    rgba(99,102,241,.7),rgba(168,85,247,.55),rgba(236,72,153,.7),
    rgba(99,102,241,.7));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
          mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  opacity:.55;z-index:2;
  /* Keep the border fixed: rotating this box creates overflowing diagonal
     edges and lets browser focus scrolling shift all panel content. */
  transform:none;
}
.panel.light::before{opacity:.40}
/* Engines without mask compositing get a static gradient border via box-shadow. */
@supports not ((-webkit-mask-composite:xor) or (mask-composite:exclude)){
  .panel::before{display:none}
  .panel{box-shadow:0 0 0 1px rgba(168,85,247,.30),var(--shadow)}
}
/* Engines without backdrop-filter get a solid opaque background. */
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .panel{background:var(--bg)}
}
.panel > :not(.resize-handle){min-width:0;max-width:100%}
.panel.open{display:flex}
.panel.overlay{
  /* Overlay = "fill the viewport with breathing room"; ignores user size. */
  left:12px !important;right:12px !important;
  top:12px !important;bottom:12px !important;
  width:auto !important;height:auto !important;
  max-width:none !important;max-height:none !important;
}

/* Mobile (<=520px): the panel is a draggable, resizable floating card whose
 * geometry is set by JS (applyPanelPosition) — it defaults to a near-fullscreen
 * card but the user can grab the corner/edge handles to resize it. When the
 * soft keyboard opens, JS pins the panel to the visual viewport so the composer
 * stays above the keyboard (see pinToVisualViewport / onVvChange). */
@media(max-width:520px), (pointer:coarse) and (max-device-width:520px), (pointer:coarse) and (max-device-height:520px){
  .panel::before{display:none}
  .toggle{
    width:48px;height:48px;font-size:20px;border-radius:16px;
  }
  /* Expand-to-overlay is desktop-only; on mobile the user resizes directly. */
  .btn-expand{display:none !important}
  /* Fatter touch targets for the resize grips on touch screens. !important so
     these win over the base .resize-handle.corner rule declared later in the
     sheet (equal specificity → source order would otherwise shrink them). */
  .resize-handle.corner{width:34px !important;height:34px !important}
  .resize-handle.edge.n,.resize-handle.edge.s{height:16px}
  .resize-handle.edge.e,.resize-handle.edge.w{width:16px}
  /* Touch screens have no hover, so edge handles would be invisible and
     undiscoverable. Give them a faint persistent grip indicator. */
  .resize-handle.edge.n,.resize-handle.edge.s{
    background:linear-gradient(90deg,transparent,rgba(168,85,247,.28),transparent);
  }
  .resize-handle.edge.e,.resize-handle.edge.w{
    background:linear-gradient(0deg,transparent,rgba(168,85,247,.28),transparent);
  }
  /* Bigger touch targets in the header tool cluster — keep icons square. */
  .hdr-actions{gap:8px}
  .hdr-tools{gap:2px;padding:3px;border-radius:13px}
  .hdr-icon-btn{width:38px;height:38px;border-radius:10px}
  .hdr-icon-btn .hdr-glyph{width:18px;height:18px}
  .btn-todos .todo-count{top:-2px;right:-2px;font-size:10px;min-height:15px;min-width:15px}
  .hdr-sep{height:24px}
  .btn-new{height:38px;padding:0 16px;font-size:13px;border-radius:11px}
  .btn-new .btn-new-glyph{font-size:16px}
  .skills-bar{padding:9px 14px;font-size:12px}
  .skills-bar .skill-chip{padding:5px 10px;font-size:12px;min-height:28px}
  /* iOS auto-zooms inputs whose font-size is < 16px on focus. */
  .input-area textarea{font-size:16px;padding:11px 14px;min-height:30px}
  .btn-send{padding:11px 20px;font-size:14px;min-height:44px}
  .btn-stop{padding:11px 18px;font-size:14px;min-height:44px}
  .in-text{font-size:16px}
  .tool-hdr{padding:10px 12px}
  .tool-ico{width:30px;height:30px;flex-basis:30px}
  .tool-title{font-size:13.5px}
  .tool-sub{font-size:11.5px}
  /* Make message bubbles a bit roomier. */
  .msg-user{padding:10px 16px;font-size:14px;max-width:90%}
  .msg-ai{font-size:14px;max-width:97%}
}

/* ── resize handles (desktop/tablet only) ──
 * One corner handle + two adjacent edge handles. Their positions are flipped
 * via the JS-applied corner class so the user always grabs an edge that grows
 * the panel away from the docked corner.
 *
 * Classes set by JS:
 *   .resize-handle.corner.{br,bl,tr,tl}  – diagonal grip
 *   .resize-handle.edge.{n,s,e,w}        – cardinal edge handles
 */
.resize-handle{
  position:absolute;z-index:2147483647;
  touch-action:none;-webkit-user-select:none;user-select:none;
}
.resize-handle.corner{
  width:22px;height:22px;
  background:
    linear-gradient(135deg,
      transparent 38%,
      rgba(168,85,247,.45) 38%,rgba(168,85,247,.45) 48%,
      transparent 48%,transparent 58%,
      rgba(236,72,153,.60) 58%,rgba(236,72,153,.60) 68%,
      transparent 68%);
}
.resize-handle.corner.br{right:0;bottom:0;cursor:nwse-resize;border-bottom-right-radius:18px}
.resize-handle.corner.bl{left:0;bottom:0;cursor:nesw-resize;-webkit-transform:scaleX(-1);transform:scaleX(-1);border-bottom-left-radius:18px}
.resize-handle.corner.tr{right:0;top:0;cursor:nesw-resize;-webkit-transform:scaleY(-1);transform:scaleY(-1);border-top-right-radius:18px}
.resize-handle.corner.tl{left:0;top:0;cursor:nwse-resize;-webkit-transform:scale(-1,-1);transform:scale(-1,-1);border-top-left-radius:18px}

/* Edge handles: thin strip along one side. */
.resize-handle.edge{background:transparent;transition:background .15s}
.resize-handle.edge:hover,.resize-handle.edge.dragging{
  background:linear-gradient(90deg,transparent,rgba(168,85,247,.22),transparent);
}
.resize-handle.edge.n{top:0;left:24px;right:24px;height:6px;cursor:ns-resize}
.resize-handle.edge.s{bottom:0;left:24px;right:24px;height:6px;cursor:ns-resize}
.resize-handle.edge.w{left:0;top:24px;bottom:24px;width:6px;cursor:ew-resize}
.resize-handle.edge.e{right:0;top:24px;bottom:24px;width:6px;cursor:ew-resize}

.panel.resizing{transition:none;-webkit-user-select:none;user-select:none}

/* ── header ──
 * Glass strip with a faint gradient sheen on top to read as the chrome of
 * the panel.
 */
.hdr{
  position:relative;
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 12px;gap:10px;
  background:linear-gradient(180deg,rgba(168,85,247,.10),rgba(168,85,247,0));
  border-bottom:1px solid var(--border);
  flex:0 0 auto;
  z-index:3;
}
.panel.light .hdr{background:linear-gradient(180deg,rgba(99,102,241,.06),rgba(99,102,241,0))}
.hdr-title{
  font-weight:650;font-size:13.5px;letter-spacing:.01em;
  color:var(--text-strong);
  display:flex;align-items:center;gap:8px;
  flex:0 1 auto;min-width:0;overflow:hidden;
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:transparent;
}
.hdr-title > span:not(.hdr-dot){
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.hdr-title .hdr-dot{
  -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:initial;
}
.hdr-dot{
  width:8px;height:8px;border-radius:50%;
  background:#22c55e;
  box-shadow:0 0 0 3px rgba(34,197,94,.18),0 0 12px rgba(34,197,94,.45);
  -webkit-animation:pdot 2.6s ease-in-out infinite;animation:pdot 2.6s ease-in-out infinite;
  flex:0 0 auto;
}
@-webkit-keyframes pdot{
  0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,.18),0 0 8px rgba(34,197,94,.40)}
  50%{box-shadow:0 0 0 5px rgba(34,197,94,.10),0 0 16px rgba(34,197,94,.75)}
}
@keyframes pdot{
  0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,.18),0 0 8px rgba(34,197,94,.40)}
  50%{box-shadow:0 0 0 5px rgba(34,197,94,.10),0 0 16px rgba(34,197,94,.75)}
}

/* Action cluster on the right side of the header.
   Layout:
     [ icon · icon · icon · icon ]  |  [ + New ]  [ × ]
   The four secondary actions (History / Todos / Settings / Expand) live
   inside a .hdr-tools chip so they read as a single group; the gradient
   "+ New" button is the primary CTA, and close gets its own clearly
   destructive affordance. */
.hdr-actions{
  display:flex;align-items:center;gap:6px;flex:0 0 auto;
}
.hdr-tools{
  display:inline-flex;align-items:center;gap:2px;padding:2px;
  background:rgba(255,255,255,.025);
  border:1px solid var(--border);
  border-radius:11px;
}
.panel.light .hdr-tools{background:rgba(15,23,42,.03)}
.hdr-sep{
  width:1px;height:18px;flex:0 0 auto;
  background:linear-gradient(180deg,transparent,var(--border-strong),transparent);
  opacity:.55;
}

/* Icon-only square buttons used inside the tools cluster + close. */
.hdr-icon-btn{
  width:28px;height:28px;padding:0;
  display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:1px solid transparent;color:var(--text-muted);
  border-radius:8px;cursor:pointer;
  font-family:inherit;
  position:relative;
  transition:background .15s ease,color .15s ease,border-color .15s ease,
             box-shadow .15s ease,transform .15s ease;
  -webkit-tap-highlight-color:transparent;
}
.hdr-icon-btn:hover{
  background:var(--bg-hover);color:var(--text-strong);
  box-shadow:0 0 0 3px rgba(168,85,247,.08);
}
.hdr-icon-btn:active{transform:translateY(1px)}
.hdr-icon-btn:focus-visible{
  outline:none;
  box-shadow:0 0 0 2px rgba(168,85,247,.55),0 0 0 4px rgba(168,85,247,.18);
}
.hdr-icon-btn .hdr-glyph{
  width:15px;height:15px;display:block;
}

/* Minimizing preserves the conversation; use the same neutral hover as tools. */
.hdr-close:hover{
  background:var(--bg-hover);color:var(--text-strong);
  box-shadow:0 0 0 3px var(--bg-hover);
}
.panel.light .hdr-close:hover{color:var(--text-strong)}

/* "+ New" primary CTA — gradient pill, drops "New" label on narrow widths. */
.btn-new{
  display:inline-flex;align-items:center;gap:6px;
  height:28px;padding:0 11px;
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  background-size:200% 100%;background-position:0% 50%;
  color:#fff;border:none;border-radius:9px;
  font-family:inherit;font-size:11.5px;font-weight:600;letter-spacing:.01em;
  cursor:pointer;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 16px -6px rgba(168,85,247,.55);
  transition:background-position .35s ease,box-shadow .25s ease,transform .15s ease;
  -webkit-tap-highlight-color:transparent;white-space:nowrap;
}
.btn-new:hover{background-position:100% 50%;transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 10px 22px -6px rgba(168,85,247,.65)}
.btn-new:active{transform:translateY(0)}
.btn-new:focus-visible{
  outline:none;
  box-shadow:0 0 0 2px var(--gradient-via),0 0 0 5px rgba(168,85,247,.22),0 6px 16px -6px rgba(168,85,247,.55);
}
.btn-new .btn-new-glyph{
  font-weight:700;font-size:14px;line-height:1;display:inline-block;
}
.btn-new .btn-new-label{line-height:1}

/* ── skills bar ──
 * Compact strip listing the skills active on this page. When no skills
 * are active we collapse to a single subtle hint line so the bar doesn't
 * eat real estate above the chat. Modern engines use :has() for the
 * empty-state styling; older engines simply fall back to the chips
 * layout, which still reads fine. */
.skills-bar{
  display:flex;gap:6px;flex-wrap:wrap;
  padding:8px 14px;
  background:var(--bg-elevated);border-bottom:1px solid var(--border);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  flex:0 0 auto;font-size:11px;align-items:center;
  position:relative;z-index:3;
  transition:padding .15s ease;
}
.skills-bar .label{
  color:var(--text-muted);font-weight:700;flex-shrink:0;
  text-transform:uppercase;letter-spacing:.08em;font-size:10px;
}
.skills-bar .skill-chip{
  display:inline-flex;align-items:center;gap:4px;
  background:var(--chip-bg);color:var(--chip-key);
  border:1px solid var(--border-strong);border-radius:999px;
  padding:3px 10px;font-size:11px;font-family:inherit;
  cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .15s ease,color .15s ease,border-color .15s ease,
             box-shadow .15s ease,transform .15s ease;
}
.skills-bar .skill-chip:hover{
  background:var(--bg-active);color:var(--text-strong);
  box-shadow:0 0 0 3px rgba(168,85,247,.12);
}
.skills-bar .skill-chip:active{transform:translateY(1px)}
.skills-bar .skill-chip.disabled{opacity:.55;text-decoration:line-through}
.skills-bar .skill-chip.user-authored{
  background:linear-gradient(120deg,rgba(99,102,241,.18),rgba(236,72,153,.18));
  border-color:rgba(168,85,247,.45);
}
.skills-bar .skills-list{
  display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center;
  flex:1 1 auto;min-width:0;
}
.skills-bar .empty{
  color:var(--text-faint);font-style:normal;letter-spacing:.02em;
}
.skills-login-hint{margin:0;padding:4px 14px 6px;color:var(--text-faint);font-size:11px;line-height:1.4}
/* When the skills list only contains the empty hint, collapse the row. */
.skills-bar:has(.skills-list > .empty:only-child){
  padding:5px 14px;background:transparent;
  -webkit-backdrop-filter:none;backdrop-filter:none;
}
.skills-bar:has(.skills-list > .empty:only-child) .label{display:none}
.skills-bar:has(.skills-list > .empty:only-child) .empty::before{
  content:"✦";margin-right:6px;color:rgba(168,85,247,.65);
  font-style:normal;font-size:9px;vertical-align:1px;
}

/* ── scroll area ──
 * Firefox via scrollbar-{width,color}; WebKit via ::-webkit-scrollbar.
 */
.msgs{
  flex:1 1 0;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;
  padding:14px 14px;
  scrollbar-width:thin;scrollbar-color:rgba(168,85,247,.30) transparent;
  scroll-behavior:smooth;
  position:relative;z-index:1;
  -webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;
}
.msgs::-webkit-scrollbar{width:7px;height:7px}
.msgs::-webkit-scrollbar-track{background:transparent}
.msgs::-webkit-scrollbar-thumb{
  background:linear-gradient(180deg,rgba(99,102,241,.35),rgba(168,85,247,.35),rgba(236,72,153,.35));
  border-radius:4px;
}
.msgs::-webkit-scrollbar-thumb:hover{
  background:linear-gradient(180deg,rgba(99,102,241,.55),rgba(168,85,247,.55),rgba(236,72,153,.55));
}

.msgs > *{display:block;margin-bottom:10px;-webkit-animation:msgIn .35s cubic-bezier(.22,1,.36,1) both;animation:msgIn .35s cubic-bezier(.22,1,.36,1) both}
.msgs > *:last-child{margin-bottom:0}
@-webkit-keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ── empty state ── */
.empty-state{
  text-align:center;padding:54px 20px 42px;color:var(--text-muted);
}
.empty-state h3{
  color:var(--text-strong);margin:0 0 10px;font-size:18px;font-weight:650;
  letter-spacing:-.01em;
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:transparent;
}
.empty-state p{margin:.4em 0;font-size:12.5px;line-height:1.55}
.empty-state .api-warn{
  margin-top:14px;padding:9px 12px;background:var(--err-bg);
  color:var(--err-text);border:1px solid var(--err-border);border-radius:10px;
  font-size:12px;text-align:left;
}
.empty-state .api-cta{
  margin-top:14px;padding:9px 18px;
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  background-size:200% 100%;background-position:0% 50%;
  color:#fff;border:none;border-radius:10px;font:inherit;font-weight:600;
  cursor:pointer;
  box-shadow:0 6px 18px -4px rgba(168,85,247,.45);
  transition:background-position .4s ease,transform .15s ease,box-shadow .25s ease;
}
.empty-state .api-cta:hover{background-position:100% 50%;transform:translateY(-1px)}
.empty-state .api-cta:focus-visible{
  outline:none;
  box-shadow:0 0 0 3px rgba(168,85,247,.45),0 6px 18px -4px rgba(168,85,247,.45);
}

/* ── user bubble ── */
.msg-user-wrap{text-align:right}
.msg-user{
  display:inline-block;text-align:left;
  max-width:88%;
  background-image:linear-gradient(135deg,var(--gradient-from),var(--gradient-via) 55%,var(--gradient-to));
  color:#fff;padding:9px 15px;
  border-radius:16px 16px 4px 16px;font-size:13px;line-height:1.5;
  box-shadow:
    0 1px 0 rgba(255,255,255,.10) inset,
    0 6px 18px -4px rgba(99,102,241,.40);
  word-wrap:break-word;white-space:pre-wrap;
}

/* ── assistant text ── */
.msg-ai{
  max-width:95%;
  color:var(--text-ai);font-size:13px;line-height:1.55;
  word-wrap:break-word;overflow-wrap:anywhere;
}
.msg-ai h1,.msg-ai h2,.msg-ai h3{color:var(--text-ai-head);margin:8px 0 4px;font-size:13.5px;font-weight:650;letter-spacing:-.005em}
.msg-ai h1{font-size:15.5px}
.msg-ai pre{
  background:var(--code-bg);color:var(--code-text);
  padding:11px 12px;border-radius:10px;
  border:1px solid rgba(168,85,247,.18);overflow-x:auto;
  font-size:11.5px;margin:6px 0;line-height:1.5;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  -webkit-overflow-scrolling:touch;
}
.msg-ai code{
  background:var(--code-inline);padding:2px 6px;border-radius:5px;font-size:11.5px;
  color:var(--code-text);
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.msg-ai pre code{background:none;padding:0;color:var(--code-text)}
.msg-ai a{
  color:var(--code-text);text-decoration:underline;
  text-underline-offset:3px;text-decoration-color:rgba(168,85,247,.45);
  text-decoration-thickness:1.5px;
  transition:text-decoration-color .15s ease;
}
.msg-ai a:hover{text-decoration-color:currentColor}
.msg-ai ul,.msg-ai ol{margin:4px 0;padding-left:20px}
.msg-ai li{margin:2px 0}
.msg-ai blockquote{
  border-left:2px solid var(--border-strong);margin:6px 0;padding:2px 12px;
  color:var(--text-muted);
}
.msg-ai p{margin:5px 0}
.msg-ai strong{color:var(--text-ai-head);font-weight:650}
.msg-ai hr{
  border:none;height:1px;margin:10px 0;
  background:linear-gradient(90deg,transparent,var(--border-strong),transparent);
}
.msg-ai table{
  border-collapse:collapse;width:100%;margin:8px 0;font-size:12px;
  table-layout:fixed;word-break:break-word;
  border:1px solid var(--table-border);border-radius:8px;overflow:hidden;
}
.msg-ai th,.msg-ai td{border:1px solid var(--table-border);padding:6px 9px;text-align:left}
.msg-ai th{background:var(--table-th-bg);color:var(--text-ai-head);font-weight:650;font-size:11.5px}
.msg-ai td{color:var(--text-muted)}

/* ── error ── */
.msg-err{
  background:var(--err-bg);border:1px solid var(--err-border);
  color:var(--err-text);font-size:12px;text-align:center;
  padding:9px 14px;border-radius:12px;
}

/* ── tool card ── */
.tool{
  background:var(--tool-bg);
  border:1px solid var(--tool-border);border-radius:12px;
  transition:border-color .25s ease,box-shadow .25s ease,background .25s ease;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
}
.tool.running{
  border-color:rgba(168,85,247,.40);
  box-shadow:0 0 0 3px rgba(168,85,247,.08);
}
.tool.done{
  border-color:rgba(16,185,129,.30);
  box-shadow:0 0 0 3px rgba(16,185,129,.06);
}
.tool.error{
  border-color:rgba(239,68,68,.40);
  box-shadow:0 0 0 3px rgba(239,68,68,.08);
}
.tool-hdr{
  display:flex;align-items:center;gap:9px;
  padding:7px 12px;cursor:pointer;
  -webkit-user-select:none;user-select:none;
  transition:background .15s ease;
  border-radius:11px;
  -webkit-tap-highlight-color:transparent;
}
.tool-hdr:hover{background:var(--bg-hover)}
.tool-ico{
  width:24px;height:24px;border-radius:8px;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;flex:0 0 24px;
  border:1px solid rgba(255,255,255,.05);
}
.tool-ico.search{background:rgba(14,165,233,.18);color:#7dd3fc}
.tool-ico.browse{background:rgba(234,179,8,.16);color:#fde68a}
.tool-ico.user{background:rgba(168,85,247,.18);color:#d8b4fe}
.tool-ico.list{background:rgba(16,185,129,.16);color:#6ee7b7}
.tool-ico.code{background:rgba(99,102,241,.20);color:#c7d2fe}
.tool-ico.mem{background:rgba(236,72,153,.18);color:#f9a8d4}
.tool-body{flex:1;min-width:0}
.tool-title{color:var(--text);font-weight:550;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tool-sub{
  color:var(--text-muted);font-size:10.5px;margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
/* Compact single-line layout when there's no subtitle yet (e.g. fallback
   "done" placeholder cards for tools that don't register a label). */
.tool-sub:empty{display:none}
.tool-st{
  flex:0 0 20px;width:20px;height:20px;
  display:flex;align-items:center;justify-content:center;font-size:12px;
}
.tool-st.running .sp{
  width:13px;height:13px;border:2px solid rgba(168,85,247,.20);
  border-top-color:var(--gradient-via);border-radius:50%;
  -webkit-animation:spin .8s linear infinite;animation:spin .8s linear infinite;
}
.tool-st.done{color:#4ade80;text-shadow:0 0 6px rgba(74,222,128,.45)}
.tool-st.error{color:#f87171;text-shadow:0 0 6px rgba(248,113,113,.45)}
.tool-detail{display:none;padding:0 12px 10px;max-height:280px;overflow:auto;-webkit-overflow-scrolling:touch}
.tool-detail.open{display:block}
.tool-detail .section{
  margin-top:8px;font-size:10px;text-transform:uppercase;letter-spacing:.10em;
  color:var(--text-faint);font-weight:700;
}
.tool-detail pre{
  margin:5px 0 0;white-space:pre-wrap;word-break:break-word;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10.5px;line-height:1.45;color:var(--text-muted);
}
.tool-detail pre.code{
  background:var(--code-bg);color:var(--code-text);
  padding:9px 10px;border-radius:8px;border:1px solid rgba(168,85,247,.18);
  font-size:11px;line-height:1.45;
  white-space:pre;overflow-x:auto;word-break:normal;-webkit-overflow-scrolling:touch;
}

/* ── chip strip (tool inputs) ── */
.chip-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.chip{
  display:inline-flex;align-items:baseline;gap:3px;
  background:var(--chip-bg);
  border:1px solid rgba(168,85,247,.18);
  border-radius:6px;padding:2px 7px;font-size:10.5px;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  max-width:100%;overflow:hidden;
}
.chip-key{color:var(--chip-key);font-weight:600}
.chip-eq{color:var(--text-faint)}
.chip-val{color:var(--chip-val);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── reply block (fenced "reply" code block) ── */
.reply-block{
  background:var(--bg-elevated);
  border:1px solid var(--border);
  border-left:3px solid transparent;
  border-image:linear-gradient(180deg,var(--gradient-from),var(--gradient-via),var(--gradient-to)) 1;
  border-radius:12px;margin:8px 0;overflow:hidden;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
}
.reply-body{padding:11px 13px;font-size:12px;line-height:1.6;color:var(--text);word-break:break-word;white-space:pre-wrap}
.reply-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 12px 10px}
.reply-to{
  font-size:11px;color:var(--text-muted);margin-right:auto;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.reply-post-btn{
  padding:6px 16px;border:none;border-radius:8px;
  font-size:12px;font-weight:600;
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  background-size:200% 100%;background-position:0% 50%;
  color:#fff;cursor:pointer;
  box-shadow:0 4px 14px -4px rgba(168,85,247,.45);
  transition:background-position .35s ease,opacity .15s ease,transform .15s ease;
  font-family:inherit;
  -webkit-tap-highlight-color:transparent;
}
.reply-post-btn:hover{background-position:100% 50%;transform:translateY(-1px)}
.reply-post-btn:disabled{opacity:.55;cursor:default;transform:none;box-shadow:none}
.reply-post-btn.posted{background:linear-gradient(120deg,#10b981,#22c55e);background-size:100% 100%}
.reply-post-btn.errored{background:linear-gradient(120deg,#ef4444,#dc2626);background-size:100% 100%}

/* ── reasoning ── */
.reason{
  background:var(--reason-bg);
  border:1px solid var(--border-strong);border-radius:12px;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
}
.reason-hdr{
  display:flex;align-items:center;gap:7px;
  padding:7px 11px;cursor:pointer;-webkit-user-select:none;user-select:none;
  color:var(--text-muted);font-size:11px;font-weight:550;
  transition:color .15s ease;
  -webkit-tap-highlight-color:transparent;
}
.reason-hdr:hover{color:var(--text-strong)}
.reason-arrow{
  font-size:9px;transition:transform .2s ease;display:inline-block;
  color:var(--chip-key);
}
.reason.open .reason-arrow{-webkit-transform:rotate(90deg);transform:rotate(90deg)}
.reason-hdr .sp{
  width:11px;height:11px;border:1.5px solid rgba(168,85,247,.20);
  border-top-color:var(--gradient-via);border-radius:50%;
  -webkit-animation:spin .8s linear infinite;animation:spin .8s linear infinite;
}
.reason-body{
  display:none;padding:0 12px 10px;color:var(--text-muted);
  font-size:11px;line-height:1.5;max-height:240px;overflow-y:auto;
  white-space:pre-wrap;word-break:break-word;-webkit-overflow-scrolling:touch;
  scrollbar-width:thin;scrollbar-color:rgba(168,85,247,.30) transparent;
}
.reason-body::-webkit-scrollbar{width:6px}
.reason-body::-webkit-scrollbar-thumb{background:rgba(168,85,247,.30);border-radius:3px}
.reason.open .reason-body{display:block}

/* ── thinking indicator ── */
.thinking{
  display:flex;align-items:center;gap:8px;padding:4px 2px;
  color:var(--text-muted);font-size:11.5px;
}
.thinking .sp{
  width:14px;height:14px;border:2px solid rgba(168,85,247,.18);
  border-top-color:var(--gradient-via);border-radius:50%;
  -webkit-animation:spin .8s linear infinite;animation:spin .8s linear infinite;
}

@-webkit-keyframes spin{to{-webkit-transform:rotate(360deg);transform:rotate(360deg)}}
@keyframes spin{to{-webkit-transform:rotate(360deg);transform:rotate(360deg)}}

/* ── generation bar ──
 * A 2px shimmer pinned just above the status row while the agent is
 * streaming. Uses the brand gradient so it doubles as a brand cue.
 */
.gen-bar{
  flex:0 0 2px;overflow:hidden;opacity:0;
  transition:opacity .25s ease;
  background:rgba(168,85,247,.06);
}
.gen-bar.active{opacity:1}
.gen-bar-inner{
  width:40%;height:100%;
  background:linear-gradient(90deg,
    rgba(99,102,241,0),
    var(--gradient-from),
    var(--gradient-via),
    var(--gradient-to),
    rgba(236,72,153,0));
  -webkit-animation:gen-slide 1.4s ease-in-out infinite;
          animation:gen-slide 1.4s ease-in-out infinite;
}
@-webkit-keyframes gen-slide{
  0%{-webkit-transform:translateX(-100%);transform:translateX(-100%)}
  100%{-webkit-transform:translateX(350%);transform:translateX(350%)}
}
@keyframes gen-slide{
  0%{-webkit-transform:translateX(-100%);transform:translateX(-100%)}
  100%{-webkit-transform:translateX(350%);transform:translateX(350%)}
}

/* ── status bar ── */
.status-row{
  display:flex;align-items:center;gap:8px;
  padding:6px 14px;font-size:10px;color:var(--text-faint);
  flex:0 0 auto;border-top:1px solid var(--border);
  background:rgba(8,8,13,.35);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  letter-spacing:.04em;
  min-height:24px;position:relative;z-index:3;
}
.panel.light .status-row{background:rgba(255,255,255,.55)}
.loading-status{
  display:none;align-items:center;gap:7px;color:var(--text-muted);
  white-space:nowrap;
}
.loading-status.active{display:flex}
.loading-status .sp{
  width:10px;height:10px;border:1.5px solid rgba(168,85,247,.18);
  border-top-color:var(--gradient-via);border-radius:50%;
  -webkit-animation:spin .8s linear infinite;animation:spin .8s linear infinite;
}
.status{
  flex:1 1 auto;text-align:center;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* webagent-style usage rollup pinned to the right side of the status bar */
.metrics{
  flex:0 0 auto;display:none;align-items:center;gap:6px;
  color:var(--text-muted);white-space:nowrap;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10px;
}
.context-meter{flex:0 0 auto;white-space:nowrap;color:var(--text-muted);font-size:9px}.context-meter[hidden]{display:none}
.loading-status{min-width:0;overflow:hidden;flex:0 1 auto}.loading-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.metrics.active{display:inline-flex}
.metrics .sep{opacity:.45}
.metrics .cost{color:var(--text-strong);font-weight:600}
.metrics .cache-hit{color:#22c55e;font-weight:600}
.metrics .cache-miss{color:var(--text-faint)}

/* ── history sidebar (slides over msgs) ── */
.history{
  display:none;flex:1 1 0;overflow-y:auto;padding:10px 12px;
  scrollbar-width:thin;scrollbar-color:rgba(168,85,247,.30) transparent;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
}
.history::-webkit-scrollbar{width:7px}
.history::-webkit-scrollbar-thumb{
  background:linear-gradient(180deg,rgba(99,102,241,.35),rgba(168,85,247,.35),rgba(236,72,153,.35));
  border-radius:4px;
}
.history.open{display:block}
.history.open ~ .msgs{display:none}
.history.open ~ .status-row{display:none}
.history.open ~ .gen-bar{display:none}
.history.open ~ .shortcuts{display:none}
.history.open ~ .input-area{display:none}
.history-empty{color:var(--text-faint);font-size:12px;text-align:center;padding:32px 12px;line-height:1.55}
.history-section{
  font-size:10px;text-transform:uppercase;letter-spacing:.10em;
  color:var(--text-faint);font-weight:700;padding:10px 4px 6px;
}
.history-item{
  display:flex;align-items:center;gap:8px;
  padding:10px 12px;border:1px solid transparent;border-radius:12px;cursor:pointer;
  transition:background .15s ease,border-color .15s ease,box-shadow .15s ease;
  margin-bottom:3px;
  -webkit-tap-highlight-color:transparent;
}
.history-item:hover{background:var(--bg-hover);border-color:var(--border)}
.history-item.current{
  background:linear-gradient(120deg,rgba(99,102,241,.10),rgba(236,72,153,.06));
  border-color:var(--border-strong);
  box-shadow:0 0 0 3px rgba(168,85,247,.10);
}
.history-item-body{flex:1;min-width:0}
.history-item-title{color:var(--text-strong);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550}
.history-item-meta{
  color:var(--text-faint);font-size:10px;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.history-item-actions{
  flex:0 0 auto;display:flex;gap:2px;opacity:0;transition:opacity .15s ease;
}
.history-item:hover .history-item-actions,
.history-item.current .history-item-actions{opacity:1}
.history-item-actions .history-act{
  color:var(--text-muted);font-size:13px;cursor:pointer;
  padding:4px 8px;border-radius:6px;
  transition:color .15s ease,background .15s ease;
  display:inline-flex;align-items:center;justify-content:center;line-height:1;
  -webkit-tap-highlight-color:transparent;
}
.history-item-actions .history-act:hover{color:var(--text-strong);background:var(--bg-active)}
.history-item-actions .history-act.del:hover{color:#f87171;background:rgba(239,68,68,.10)}
/* On mobile the actions need to always be visible (no hover state). */
@media (pointer:coarse){
  .history-item-actions{opacity:1}
  .history-item-actions .history-act{padding:8px 12px;font-size:15px}
}

/* ── Todos: dedicated UI for the agent's todo_write list ──
   Lives as a sibling of .history; same overlay-style slide-in so opening
   one closes the other. The toolbar button shows a small "done/total"
   counter pill, and tints purple when there's an in_progress item. */
/* Todos action lives inside .hdr-tools; the counter floats as a small
   notification badge over the top-right corner of the icon button. */
.btn-todos .todo-count{
  position:absolute;top:-4px;right:-4px;
  display:none;
  background:linear-gradient(135deg,var(--gradient-via),var(--gradient-to));
  color:#fff;
  border-radius:999px;padding:0 5px;font-size:9px;font-weight:700;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  line-height:1.5;min-height:13px;min-width:13px;
  text-align:center;letter-spacing:0;
  box-shadow:0 0 0 2px var(--bg),0 4px 8px -2px rgba(168,85,247,.55);
  font-variant-numeric:tabular-nums;
}
.btn-todos .todo-count.active{display:inline-flex;align-items:center;justify-content:center}
.btn-todos.has-active{
  color:var(--text-strong);
  background:linear-gradient(135deg,rgba(99,102,241,.18),rgba(236,72,153,.18));
  box-shadow:inset 0 0 0 1px rgba(168,85,247,.35);
}

.todos{
  display:none;flex-direction:column;flex:1 1 auto;min-height:0;
  overflow:hidden;padding:0;
  background:linear-gradient(180deg,rgba(168,85,247,.05),transparent 60%);
}
.todos.open{display:flex}
.todos.open ~ .msgs{display:none}
.todos.open ~ .status-row{display:none}
.todos.open ~ .gen-bar{display:none}
.todos.open ~ .shortcuts{display:none}
.todos.open ~ .input-area{display:none}
.todos.open ~ .queued-row{display:none}
.todos-header{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:11px 14px 9px;border-bottom:1px solid var(--border);
  flex:0 0 auto;
}
.todos-header .todos-title{
  color:var(--text-strong);font-size:12.5px;font-weight:650;
  display:flex;align-items:center;gap:8px;letter-spacing:.005em;
}
.todos-header .todos-summary{
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10.5px;color:var(--text-faint);font-weight:500;
}
.todos-header .todos-clear{
  background:transparent;border:1px solid var(--border-input);
  color:var(--text-muted);font-size:11px;font-family:inherit;
  padding:5px 10px;border-radius:8px;cursor:pointer;
  transition:background .15s ease,color .15s ease,border-color .15s ease;
  -webkit-tap-highlight-color:transparent;
}
.todos-header .todos-clear:hover{
  background:rgba(239,68,68,.10);color:#f87171;border-color:rgba(239,68,68,.40);
}
.todos-header .todos-clear:disabled{opacity:.4;cursor:default}
.todos-list{
  flex:1 1 auto;min-height:0;overflow-y:auto;
  padding:10px 12px 16px;
  scrollbar-width:thin;scrollbar-color:rgba(168,85,247,.30) transparent;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
}
.todos-list::-webkit-scrollbar{width:7px}
.todos-list::-webkit-scrollbar-thumb{
  background:linear-gradient(180deg,rgba(99,102,241,.35),rgba(168,85,247,.35),rgba(236,72,153,.35));
  border-radius:4px;
}
.todos-empty{
  color:var(--text-faint);font-size:12px;text-align:center;
  padding:32px 12px;line-height:1.6;
}
.todos-empty code{
  background:var(--bg-input);color:var(--text);
  padding:2px 6px;border-radius:6px;
  font-family:'SF Mono','JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;
  border:1px solid var(--border);
}

.todo-item{
  display:flex;align-items:flex-start;gap:10px;
  padding:9px 11px;border-radius:11px;margin-bottom:3px;
  transition:background .15s ease;
  border:1px solid transparent;
}
.todo-item:hover{background:var(--bg-hover);border-color:var(--border)}
.todo-item .todo-status{
  flex:0 0 auto;width:22px;height:22px;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;cursor:pointer;
  border:1.5px solid var(--border-input);background:transparent;
  color:var(--text-muted);
  transition:border-color .2s ease,background .2s ease,color .2s ease,box-shadow .2s ease;
  line-height:1;margin-top:1px;
  -webkit-appearance:none;appearance:none;
  font-family:inherit;
  -webkit-tap-highlight-color:transparent;
}
.todo-item .todo-status:hover{
  border-color:var(--border-strong);color:var(--chip-key);
}
.todo-item .todo-text{
  flex:1 1 auto;color:var(--text);font-size:12.5px;line-height:1.55;
  word-break:break-word;
}
/* pending: open circle, normal text */
.todo-item.pending .todo-status::before{content:''}
/* in_progress: filled half-circle + pulsing aura + bold accent text */
.todo-item.in_progress .todo-status{
  border-color:transparent;color:#fff;
  background-image:linear-gradient(135deg,var(--gradient-from),var(--gradient-via));
  box-shadow:0 0 0 0 rgba(168,85,247,.45);
  -webkit-animation:todoPulse 2.4s ease-in-out infinite;
          animation:todoPulse 2.4s ease-in-out infinite;
}
.todo-item.in_progress .todo-status::before{content:'\\25B6';font-size:9px;line-height:1}
.todo-item.in_progress .todo-text{
  color:var(--text-strong);font-weight:600;
}
/* completed: filled check, strikethrough text */
.todo-item.completed .todo-status{
  border-color:transparent;
  background-image:linear-gradient(135deg,#10b981,#22c55e);color:#fff;
  box-shadow:0 4px 12px -4px rgba(16,185,129,.55);
}
.todo-item.completed .todo-status::before{content:'\\2713';font-size:13px;line-height:1;font-weight:700}
.todo-item.completed .todo-text{
  text-decoration:line-through;color:var(--text-faint);
}

@-webkit-keyframes todoPulse{
  0%,100%{box-shadow:0 0 0 0 rgba(168,85,247,.45)}
  50%{box-shadow:0 0 0 7px rgba(168,85,247,0)}
}
@keyframes todoPulse{
  0%,100%{box-shadow:0 0 0 0 rgba(168,85,247,.45)}
  50%{box-shadow:0 0 0 7px rgba(168,85,247,0)}
}

/* Mobile: bigger touch targets. */
@media (pointer:coarse){
  .todo-item{padding:12px 10px}
  .todo-item .todo-status{width:28px;height:28px;font-size:14px}
  .todo-item .todo-text{font-size:13.5px}
  .todos-header .todos-clear{padding:8px 12px;font-size:12.5px}
}

/* ── shortcuts row ── */
.shortcuts{display:flex;gap:6px;padding:8px 12px 0;flex-wrap:wrap}
.shortcuts:empty{display:none}
.shortcuts button{
  background:var(--bg-input);color:var(--text-muted);
  border:1px solid var(--border-input);
  border-radius:999px;padding:5px 12px;font-size:11.5px;font-family:inherit;
  cursor:pointer;white-space:nowrap;
  transition:background .15s ease,color .15s ease,border-color .15s ease,
             box-shadow .15s ease,transform .15s ease;
  -webkit-tap-highlight-color:transparent;
}
.shortcuts button:hover{
  background:var(--bg-hover);color:var(--text-strong);
  border-color:var(--border-strong);
  box-shadow:0 0 0 3px rgba(168,85,247,.10);
}
.shortcuts button:focus-visible{
  outline:none;
  box-shadow:0 0 0 2px rgba(168,85,247,.55),0 0 0 4px rgba(168,85,247,.18);
}

.image-previews{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px 0;background:var(--bg);flex:0 0 auto}
.image-previews[hidden],.image-error[hidden],.btn-attach[hidden]{display:none}
.image-preview{position:relative;width:64px;height:64px}
.image-preview img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border-strong)}
.image-preview button{position:absolute;top:-5px;right:-5px;border:1px solid var(--border-strong);border-radius:50%;background:var(--bg);color:var(--text-strong);width:23px;height:23px;cursor:pointer}
.image-error{padding:8px 12px;color:var(--err-text);background:var(--err-bg);font-size:12px;flex:0 0 auto}
.btn-attach{display:grid;place-items:center;border:1px solid var(--border-input);border-radius:10px;background:var(--bg-input);color:var(--text-muted);padding:9px;min-width:36px;min-height:39px;cursor:pointer;flex:0 0 auto}
.btn-attach:hover{color:var(--text-strong);border-color:var(--border-strong)}
.btn-attach:focus-visible{outline:2px solid var(--gradient-via);outline-offset:2px}
.msg-user img{max-width:100%;max-height:220px;object-fit:contain;border-radius:8px;display:block;margin-top:8px}
/* ── input ──
 * Row: [ textarea  ][ Stop ][ Send ]
 * Stop and Send are wrapped in .input-actions so they always stay
 * grouped against the right edge — and so future affordances (e.g. an
 * inline model picker) have an obvious home. */
.input-area{
  display:flex;align-items:flex-end;padding:10px 12px;gap:8px;
  border-top:1px solid var(--border);
  background:rgba(8,8,13,.45);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
  flex:0 0 auto;position:relative;z-index:3;
}
.panel.light .input-area{background:rgba(255,255,255,.65)}
.input-actions{
  display:inline-flex;align-items:flex-end;gap:6px;flex:0 0 auto;
}
.input-area textarea{
  flex:1 1 0;min-width:0;width:0;resize:none;
  border:1px solid var(--border-input);border-radius:12px;
  padding:10px 13px;font-size:13px;font-family:inherit;line-height:1.45;
  max-height:120px;min-height:24px;
  background:var(--bg-input);color:var(--text-strong);
  transition:border-color .2s ease,box-shadow .2s ease,background .2s ease;
  -webkit-appearance:none;appearance:none;
}
.input-area textarea::placeholder{color:var(--text-faint)}
.input-area textarea:hover{border-color:var(--border-strong)}
.input-area textarea:focus,
.input-area textarea:focus-visible{
  outline:none;
  border-color:transparent;
  background:var(--bg);
  box-shadow:
    0 0 0 1px var(--gradient-via),
    0 0 0 4px rgba(168,85,247,.18),
    0 6px 18px -8px rgba(168,85,247,.35);
}
.input-area textarea:disabled{opacity:.4;cursor:not-allowed}
.btn-send,.btn-stop{
  -webkit-appearance:none;appearance:none;
  border:none;cursor:pointer;font-family:inherit;
  border-radius:12px;padding:10px 20px;
  font-size:12.5px;font-weight:600;letter-spacing:.005em;
  white-space:nowrap;
  transition:background-position .35s ease,box-shadow .25s ease,
             transform .15s ease,opacity .15s ease;
  -webkit-tap-highlight-color:transparent;
}
.btn-send{
  background-image:linear-gradient(120deg,var(--gradient-from),var(--gradient-via),var(--gradient-to));
  background-size:200% 100%;background-position:0% 50%;
  color:#fff;
  box-shadow:
    0 1px 0 rgba(255,255,255,.10) inset,
    0 6px 18px -4px rgba(168,85,247,.40);
}
.btn-send:hover{background-position:100% 50%;transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 10px 24px -6px rgba(168,85,247,.55)}
.btn-send:active{transform:translateY(0)}
.btn-send:focus-visible{
  outline:none;
  box-shadow:0 0 0 2px var(--gradient-via),0 0 0 5px rgba(168,85,247,.22),0 6px 18px -4px rgba(168,85,247,.40);
}
.btn-send:disabled{
  background:var(--send-disabled-bg);background-image:none;color:var(--text-faint);
  cursor:default;box-shadow:none;transform:none;
}
.btn-send.stop{
  background-image:linear-gradient(120deg,#f43f5e,#ef4444 55%,#dc2626);
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 18px -4px rgba(239,68,68,.45);
}

/* Dedicated Stop button — only visible while the agent is running. The
   Send button stays Send the whole time so Enter / click while running
   simply queues the next prompt (Claude-Code-style). */
.btn-stop{
  background-image:linear-gradient(120deg,#f43f5e,#ef4444 55%,#dc2626);
  background-size:200% 100%;background-position:0% 50%;
  color:#fff;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 18px -4px rgba(239,68,68,.45);
  display:none;padding:10px 16px;
}
.btn-stop.active{display:inline-flex;align-items:center}
.btn-stop:hover{background-position:100% 50%;transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 10px 24px -6px rgba(239,68,68,.60)}
.btn-stop:active{transform:translateY(0)}
.btn-stop:focus-visible{
  outline:none;
  box-shadow:0 0 0 2px #ef4444,0 0 0 5px rgba(239,68,68,.22),0 6px 18px -4px rgba(239,68,68,.45);
}
.btn-stop:disabled{opacity:.65;cursor:default;transform:none;box-shadow:none}

/* Queue tray — pinned just above the input area. Shows pending prompts
   that the user typed while the agent was busy; they'll be picked up as
   the next turn(s) once the current one finishes. Clicking × removes one. */
.queued-row{
  display:none;flex-wrap:wrap;gap:6px;align-items:center;
  padding:8px 14px 0 14px;
  position:relative;z-index:3;
}
.queued-row.active{display:flex}
.queued-row .qlabel{
  font-size:10px;color:var(--text-faint);font-weight:700;
  text-transform:uppercase;letter-spacing:.08em;margin-right:2px;
}
.queued-pill{
  background:linear-gradient(120deg,rgba(99,102,241,.10),rgba(168,85,247,.10),rgba(236,72,153,.10));
  border:1px solid rgba(168,85,247,.28);
  border-radius:999px;padding:4px 4px 4px 12px;
  display:inline-flex;gap:6px;align-items:center;
  font-size:11.5px;color:var(--text);max-width:240px;
  font-family:inherit;
}
.queued-pill .qtext{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  flex:1 1 auto;min-width:0;
}
.queued-pill .qrm{
  cursor:pointer;background:transparent;border:none;color:var(--text-muted);
  font-size:14px;line-height:1;padding:3px 7px;border-radius:999px;
  font-family:inherit;
  transition:background .15s ease,color .15s ease;
  -webkit-appearance:none;appearance:none;
  -webkit-tap-highlight-color:transparent;
}
.queued-pill .qrm:hover{background:var(--bg-active);color:var(--text-strong)}

/* ── accessibility: reduced motion / high contrast ── */
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{
    -webkit-animation-duration:.001s !important;animation-duration:.001s !important;
    -webkit-animation-iteration-count:1 !important;animation-iteration-count:1 !important;
    transition-duration:.001s !important;
  }
  .toggle::before,.panel::before{display:none}
  .msgs > *{-webkit-animation:none !important;animation:none !important}
}
@media (prefers-contrast:more){
  .panel{
    --border:rgba(255,255,255,.20);
    --border-input:rgba(255,255,255,.28);
    --border-strong:rgba(168,85,247,.55);
    --text:#ffffff;--text-muted:#cccccc;--text-faint:#9a9aa6;
  }
  .panel.light{
    --border:rgba(0,0,0,.25);--border-input:rgba(0,0,0,.35);
    --border-strong:rgba(99,102,241,.65);
    --text:#000000;--text-muted:#1c1c25;
  }
}
/* Tablet/desktop pointer-fine: tighter hairlines, slightly smaller toggle. */
@media (pointer:fine) and (min-width:521px){
  .toggle{width:46px;height:46px}
}

/* iOS visualViewport zoom guard: when the page is zoomed, our panel stays
   pinned to the visual viewport, not the layout viewport. */
@supports (top:env(safe-area-inset-top)){
  .panel{
    /* Already padded by JS-applied media query above on mobile; this just
       makes sure tablet split-screen also respects insets when overlayed. */
  }
}
`;

const HTML = `
<button class="toggle" title="Open xgoose">✦</button>
<div class="panel">
  <div class="resize-handle corner" data-axis="corner"></div>
  <div class="resize-handle edge" data-axis="h"></div>
  <div class="resize-handle edge" data-axis="v"></div>
  <div class="hdr">
    <div class="hdr-title"><span class="hdr-dot"></span><span>xgoose</span></div>
    <div class="hdr-actions">
      <div class="hdr-tools" role="group" aria-label="Conversation tools">
        <button class="btn-history hdr-icon-btn" title="Past conversations" aria-label="History"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8m0 0V4m0 4h4M12 8v4.5l3 1.8"/></svg></button>
        <button class="btn-todos hdr-icon-btn" title="Todo list" aria-label="Todos"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m4.5 7 1.5 1.5L9 5.5M4.5 13 6 14.5 9 11.5M4.5 19 6 20.5 9 17.5M12 7h8M12 13h8M12 19h8"/></svg><span class="todo-count"></span></button>
        <button class="btn-settings hdr-icon-btn" title="Open settings" aria-label="Settings"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.07.07a2 2 0 1 1-2.83 2.83l-.07-.07a1.7 1.7 0 0 0-1.83-.3 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.54 1.7 1.7 0 0 0-1.83.3l-.07.07a2 2 0 1 1-2.83-2.83l.07-.07A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.83l-.07-.07a2 2 0 1 1 2.83-2.83l.07.07A1.7 1.7 0 0 0 9 4.64h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.83-.3l.07-.07a2 2 0 1 1 2.83 2.83l-.07.07a1.7 1.7 0 0 0-.3 1.83V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1Z"/></svg></button>
        <button class="btn-expand hdr-icon-btn" title="Toggle wide overlay" aria-label="Toggle wide overlay"><svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 9V5h4M20 9V5h-4M4 15v4h4m12-4v4h-4"/></svg></button>
      </div>
      <span class="hdr-sep" aria-hidden="true"></span>
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
  branding?: {
    /** Replaces the literal "xgoose" text in the header title. */
    name?: string;
    /** URL or data-URI. When set, replaces the `✦` text on the floating
     *  toggle button AND the green dot in the header with an `<img>` of
     *  this asset. */
    logoUrl?: string;
  };
  /** Per-toolbar-button visibility flags. Anything set to `false` hides
   *  the corresponding `<button>` and turns the matching `set…` panel
   *  method into a no-op so callers don't have to branch. Defaults
   *  preserve the historical behaviour (settings/history/todos all on)
   *  for extension hosts that pass no options. */
  buttons?: {
    settings?: boolean;
    history?: boolean;
    todos?: boolean;
  };
};

export type Panel = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setTheme(theme: PanelTheme): void;
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
      action: "edit" | "disable" | "enable" | "publish" | "read",
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
  // Per-button visibility flags. Default `true` for every button so
  // extension hosts that pass no options keep the historical layout.
  const showSettingsBtn = opts.buttons?.settings !== false;
  const showHistoryBtn = opts.buttons?.history !== false;
  const showTodosBtn = opts.buttons?.todos !== false;
  const brandingName = opts.branding?.name ?? null;
  const brandingLogo = opts.branding?.logoUrl ?? null;

  const host = document.createElement("div");
  host.id = "xgoose-root";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.innerHTML = HTML;
  shadow.appendChild(wrap);
  document.body.appendChild(host);

  const $ = <T extends Element = Element>(sel: string): T =>
    shadow.querySelector(sel) as T;
  const toggleBtn = $(".toggle") as HTMLButtonElement;
  const panel = $(".panel") as HTMLDivElement;
  const msgs = $(".msgs") as HTMLDivElement;
  const historyEl = $(".history") as HTMLDivElement;
  const genBar = $(".gen-bar") as HTMLDivElement;
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
    if(pendingImages.length){const hint=document.createElement("span");hint.style.cssText="width:100%;font-size:11px;color:var(--text-muted)";hint.textContent="Images are resized locally and sent with this message to your AI provider.";previewEl.append(hint);}
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
    menu.setAttribute(
      "style",
      [
        "position:absolute",
        "background:var(--panel-bg, #1f2937)",
        "color:var(--panel-fg, #f9fafb)",
        "border:1px solid var(--panel-border, rgba(255,255,255,0.12))",
        "border-radius:8px",
        "padding:4px",
        "min-width:160px",
        "z-index:1000",
        "box-shadow:0 8px 22px rgba(0,0,0,0.35)",
        "font-size:13px",
      ].join(";"),
    );
    const addItem = (
      label: string,
      action: "edit" | "disable" | "enable" | "publish" | "read",
    ): void => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.setAttribute(
        "style",
        [
          "display:block",
          "width:100%",
          "text-align:left",
          "background:transparent",
          "border:0",
          "color:inherit",
          "padding:6px 10px",
          "border-radius:6px",
          "cursor:pointer",
          "font-size:13px",
        ].join(";"),
      );
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "rgba(255,255,255,0.08)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
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
    if(opts.editableSkills!==false)addItem("Publish to xgoose-web", "publish");

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(menu);
    skillMenu = menu;

    const onDocClick = (e: MouseEvent): void => {
      if (menu.contains(e.target as Node)) return;
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

  // ── apply host branding + button visibility ──
  // Done before any handlers attach so hidden buttons can never fire.
  if (!showSettingsBtn) btnSettings.style.display = "none";
  if (!showHistoryBtn) btnHistory.style.display = "none";
  if (!showTodosBtn) btnTodos.style.display = "none";

  if (brandingName) {
    const titleEl = shadow.querySelector(".hdr-title") as HTMLElement | null;
    const labelSpan = titleEl?.querySelector(
      "span:not(.hdr-dot)",
    ) as HTMLElement | null;
    if (labelSpan) labelSpan.textContent = brandingName;
  }
  if (brandingLogo) {
    // Replace the green status dot with the host's logo image.
    const dot = shadow.querySelector(".hdr-dot") as HTMLElement | null;
    if (dot) {
      const img = document.createElement("img");
      img.src = brandingLogo;
      img.alt = brandingName ?? "";
      img.setAttribute(
        "style",
        "width:16px;height:16px;border-radius:4px;object-fit:contain;display:block;animation:none;background:transparent;box-shadow:none;",
      );
      dot.replaceWith(img);
    }
    // Replace the floating toggle's `✦` glyph with the same asset, scaled
    // to fit the 46px button. We keep the gradient background so the
    // button still reads as the xgoose anchor on the page.
    const toggleImg = document.createElement("img");
    toggleImg.src = brandingLogo;
    toggleImg.alt = brandingName ?? "";
    toggleImg.setAttribute(
      "style",
      "width:26px;height:26px;border-radius:6px;object-fit:contain;pointer-events:none;",
    );
    toggleBtn.textContent = "";
    toggleBtn.appendChild(toggleImg);
  }

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
          action: "edit" | "disable" | "enable" | "publish" | "read",
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

  function clampToViewport(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { x: number; y: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.max(4, Math.min(vw - w - 4, x)),
      y: Math.max(4, Math.min(vh - h - 4, y)),
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
      `max(${offset.h}px, env(safe-area-inset-${horiz}, 0px))`;
    toggleBtn.style[vert] =
      `max(${offset.v}px, env(safe-area-inset-${vert}, 0px))`;
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const left = cx < vw / 2;
    const top = cy < vh / 2;
    return left ? (top ? "tl" : "bl") : top ? "tr" : "br";
  }

  // When the iOS soft-keyboard is up we pin the panel to the visual viewport
  // (see the visualViewport block below); applyLayout must respect that so a
  // stray window "resize" event doesn't yank the panel back under the keyboard.
  let keyboardPinned = false;
  const IOS_KEYBOARD_CHROME_RESERVE_PX = 92;

  function applySafariViewport(): boolean {
    const vp=window.visualViewport;
    if(!opts.visualViewport || !vp)return false;
    const scale=vp.scale || 1,margin=6;
    const availableWidth=vp.width*scale,availableHeight=vp.height*scale;
    const left=layout.buttonCorner.endsWith('l'),top=layout.buttonCorner.startsWith('t');
    const buttonX=left?layout.buttonOffset.h:availableWidth-layout.buttonOffset.h-48;
    const buttonY=top?layout.buttonOffset.v:availableHeight-layout.buttonOffset.v-48;
    for(const [key,value] of Object.entries({left:'0px',top:'0px',right:'auto',bottom:'auto',transform:`translate(${vp.offsetLeft+Math.max(margin,buttonX)/scale}px, ${vp.offsetTop+Math.max(margin,buttonY)/scale}px) scale(${1/scale})`,'transform-origin':'top left'}))toggleBtn.style.setProperty(key,value,'important');
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
    e.preventDefault();
    toggleBtn.classList.add("dragging");
    const rect = toggleBtn.getBoundingClientRect();
    const clamped = clampToViewport(
      drag.btnX + dx,
      drag.btnY + dy,
      rect.width,
      rect.height,
    );
    // Switch to absolute left/top while dragging so we can move freely.
    toggleBtn.style.left =
      toggleBtn.style.right =
      toggleBtn.style.top =
      toggleBtn.style.bottom =
        "";
    toggleBtn.style.left = `${clamped.x}px`;
    toggleBtn.style.top = `${clamped.y}px`;
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
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const horiz =
        corner === "br" || corner === "tr" ? vw - rect.right : rect.left;
      const vert =
        corner === "br" || corner === "bl" ? vh - rect.bottom : rect.top;
      layout = {
        ...layout,
        buttonCorner: corner,
        buttonOffset: { h: Math.max(8, horiz), v: Math.max(8, vert) },
        // Panel follows the button to the same corner on drag.
        panelCorner: corner,
      };
      applyLayout(layout);
      persistLayout();
      lastTapAt = 0;
      return;
    }
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
        <p style="opacity:.7;font-size:11px;margin-top:8px">Try: "summarize this page", or "find the form on the page and tell me which fields are required".</p>
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

  function createToolCard(name: string, input: unknown): ToolCardHandle {
    const meta = describeToolCall(name, input);
    const card = el(
      "tool running",
      `
      <div class="tool-hdr">
        <div class="tool-ico ${meta.iconClass}">${meta.icon}</div>
        <div class="tool-body">
          <div class="tool-title"></div>
          <div class="tool-sub"></div>
        </div>
        <div class="tool-st running"><div class="sp"></div></div>
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
    append(card);
    return wrapToolCard(card, name, input);
  }

  function wrapToolCard(
    card: HTMLElement,
    name: string,
    input: unknown,
  ): ToolCardHandle {
    return {
      el: card,
      setResult(output, error) {
        const st = card.querySelector(".tool-st") as HTMLElement;
        const sub = card.querySelector(".tool-sub") as HTMLElement;
        const detail = card.querySelector(".tool-detail") as HTMLElement;
        card.classList.remove("running");
        if (error) {
          card.classList.add("error");
          st.className = "tool-st error";
          st.textContent = "✗";
          sub.textContent = `Error: ${truncate(error, 80)}`;
        } else {
          card.classList.add("done");
          st.className = "tool-st done";
          st.textContent = "✓";
          const summary = summarizeToolResult(name, output);
          sub.textContent = summary;
        }
        renderToolDetail(detail, name, input, output, error);
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
      "reason open",
      `
      <div class="reason-hdr">
        <span class="reason-arrow">▶</span>
        <div class="sp"></div>
        <span class="reason-label">Thinking…</span>
      </div>
      <div class="reason-body"></div>
    `,
    );
    append(block);
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
        const spinner = block.querySelector(".sp");
        if (spinner) spinner.remove();
        const label = block.querySelector(".reason-label") as HTMLElement;
        const len = body.textContent?.length ?? 0;
        label.textContent = `Thinking · ${len} chars`;
        block.classList.remove("open");
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
      // History button hidden by host config → ignore data writes so the
      // tray never inflates and a stale `showHistory(true)` can't surface
      // ghost UI.
      if (!showHistoryBtn) return;
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
      if (!showHistoryBtn) return;
      historyEl.classList.toggle("open", visible);
      if (visible) {
        todosEl.classList.remove("open");
        handlers.history?.();
      }
    },
    isHistoryOpen: () => historyEl.classList.contains("open"),

    setTodos(items) {
      if (!showTodosBtn) return;
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
      if (!showTodosBtn) return;
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
