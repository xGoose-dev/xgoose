// Chat panel stylesheet (Shadow DOM). The palette is the xgoose brand set used
// by the store artwork: ink #24203B, violet #7357E8, lavender #F5F3FC and beak
// orange #FFAE57. Appearance presets override the same custom properties.

const MOBILE = "(max-width:520px), (pointer:coarse) and (max-device-width:520px), (pointer:coarse) and (max-device-height:520px)";
const MONO = "ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace";

export const GOOSE_MARK = `<svg class="goose" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><path d="M29 106c1-15 9-25 21-33V49c0-16 11-27 26-27 15 0 25 11 25 26 0 15-10 26-25 27v17c-10 3-19 11-23 20H29v-6Z" fill="#FFF"/><path d="m99 44 20 8-20 10V44Z" fill="#FFAE57"/><rect x="65" y="38" width="37" height="17" rx="8.5" fill="#24203B"/><path d="M72 43h11" stroke="#C9BFFF" stroke-width="3" stroke-linecap="round"/></svg>`;

export const PANEL_CSS = `
*,*::before,*::after{box-sizing:border-box}
/* Keep controls above ordinary site navigation; fullscreen is handled below. */
:host{
  all:initial;
  position:relative;z-index:2147483647;isolation:isolate;
  font-family:var(--xg-font,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif);
  font-size:calc(13.5px * var(--xg-font-scale,1));line-height:1.55;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  color-scheme:dark light;
}
:host([data-fullscreen]){visibility:hidden}

/* ── tokens ── */
.panel{
  --bg:#18162a;
  --bg-elevated:#211e38;
  --bg-input:#1d1a32;
  --bg-hover:rgba(154,134,245,.10);
  --bg-active:rgba(154,134,245,.18);
  --border:rgba(201,191,255,.10);
  --border-strong:rgba(201,191,255,.24);
  --border-input:rgba(201,191,255,.16);
  --text:#d9d6ea;
  --text-strong:#f5f3fc;
  --text-muted:#a09cbc;
  --text-faint:#75718f;
  --text-ai:#d9d6ea;
  --text-ai-head:#f5f3fc;
  --code-bg:#131122;
  --code-text:#c9bfff;
  --code-inline:rgba(154,134,245,.16);
  --table-border:rgba(201,191,255,.14);
  --chip-bg:rgba(154,134,245,.14);
  --chip-key:#b7a9fb;
  --chip-val:#e6e2f8;
  --select-opt-bg:#211e38;
  --send-disabled-bg:rgba(201,191,255,.08);
  --err-bg:rgba(255,138,155,.10);
  --err-border:rgba(255,138,155,.28);
  --err-text:#ff9aa9;
  --ok:#5ad3a0;
  --beak:#ffae57;
  --user-bg:#2e2852;
  --user-text:#edeafb;
  --accent:var(--xg-accent,#7357e8);
  --accent-hover:var(--xg-accent,#8168ee);
  --accent-text:var(--xg-accent,#b7a9fb);
  --on-accent:var(--xg-on-accent,#fff);
  --shadow:0 0 0 1px rgba(201,191,255,.16),0 24px 48px -12px rgba(0,0,0,.6),0 4px 12px rgba(0,0,0,.3);
  --display:var(--xg-font,'Avenir Next','Avenir',system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif);
  --fs-2xs:calc(10.5px * var(--xg-font-scale,1));
  --fs-xs:calc(11.5px * var(--xg-font-scale,1));
  --fs-sm:calc(12.5px * var(--xg-font-scale,1));
  --fs-md:calc(13.5px * var(--xg-font-scale,1));
  --fs-lg:calc(15px * var(--xg-font-scale,1));
  --fs-xl:calc(18px * var(--xg-font-scale,1));
}
.panel.light{
  --bg:#ffffff;
  --bg-elevated:#f5f3fc;
  --bg-input:#ffffff;
  --bg-hover:rgba(115,87,232,.07);
  --bg-active:rgba(115,87,232,.13);
  --border:#e9e6f3;
  --border-strong:#cfc8ee;
  --border-input:#d9d5ea;
  --text:#3a3654;
  --text-strong:#24203b;
  --text-muted:#6e6a86;
  --text-faint:#9591ab;
  --text-ai:#2f2b47;
  --text-ai-head:#24203b;
  --code-bg:#f5f3fc;
  --code-text:#4b3bb5;
  --code-inline:#efecfb;
  --table-border:#e3dff0;
  --chip-bg:#f1eefc;
  --chip-key:#5b41d0;
  --chip-val:#3a3654;
  --select-opt-bg:#ffffff;
  --send-disabled-bg:#efedf6;
  --err-bg:#fdf0f2;
  --err-border:#f3c4cc;
  --err-text:#c2334c;
  --ok:#1e9e6a;
  --beak:#e08a1e;
  --user-bg:#efecfb;
  --user-text:#24203b;
  --accent-hover:var(--xg-accent,#6146dc);
  --accent-text:var(--xg-accent,#5b41d0);
  --shadow:0 0 0 1px rgba(36,32,59,.10),0 24px 48px -12px rgba(36,32,59,.28),0 4px 12px rgba(36,32,59,.08);
}

/* ── launcher ── drag anywhere; double-tap resets its position. */
.toggle{
  position:fixed;
  width:48px;height:48px;border-radius:14px;padding:0;
  background:var(--xg-accent,#7357e8);
  color:var(--xg-on-accent,#fff);border:none;cursor:grab;
  z-index:2147483647;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 2px rgba(36,32,59,.24),0 8px 20px -4px rgba(36,32,59,.38);
  transition:transform .18s ease,box-shadow .18s ease,
             left .2s ease,top .2s ease,right .2s ease,bottom .2s ease;
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;touch-action:none;
}
.toggle .goose{width:32px;height:32px;display:block;pointer-events:none}
/* Touch devices keep the 48px that panel.ts positions against. */
@media (pointer:fine) and (min-width:521px){.toggle{width:46px;height:46px}}
.toggle:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(36,32,59,.24),0 12px 26px -4px rgba(36,32,59,.46)}
.toggle:focus-visible{outline:2px solid #fff;outline-offset:-4px}
.toggle.dragging{cursor:grabbing;transform:scale(1.08);transition:box-shadow .12s ease}
.toggle.panel-open,.toggle.launcher-hidden{display:none}

/* ── panel shell ── position and size are set inline by JS. */
.panel{
  position:fixed;
  background:var(--bg);
  color:var(--text);
  border-radius:20px;
  box-shadow:var(--shadow);
  display:none;flex-direction:column;
  z-index:2147483646;overflow:clip;
  min-width:0;min-height:0;
  isolation:isolate;
}
.panel > :not(.resize-handle){min-width:0;max-width:100%}
.panel.open{display:flex}
.panel.overlay{
  left:12px !important;right:12px !important;
  top:12px !important;bottom:12px !important;
  width:auto !important;height:auto !important;
  max-width:none !important;max-height:none !important;
}
.panel.resizing{-webkit-user-select:none;user-select:none}
.panel button{font-family:inherit}
.panel :is(button,a,summary,textarea):focus-visible{outline:2px solid var(--accent-text);outline-offset:1px}

/* ── resize handles ── one corner grip plus two edges, flipped by JS to face
   away from the docked corner. */
.resize-handle{position:absolute;z-index:2147483647;touch-action:none;-webkit-user-select:none;user-select:none}
/* Always-visible grips: three diagonal strokes in the free corner and a short
   bar on each resizable edge. */
.resize-handle.corner{width:26px;height:26px;opacity:.6;transition:opacity .15s ease;
  background:linear-gradient(135deg,transparent 40%,var(--text-muted) 40% 45%,transparent 45% 53%,var(--text-muted) 53% 58%,transparent 58% 66%,var(--text-muted) 66% 71%,transparent 71%) right bottom/26px 26px no-repeat}
.resize-handle.corner:hover,.resize-handle.corner.dragging{opacity:1}
.resize-handle.corner.br{right:0;bottom:0;cursor:nwse-resize}
.resize-handle.corner.bl{left:0;bottom:0;cursor:nesw-resize;transform:scaleX(-1)}
.resize-handle.corner.tr{right:0;top:0;cursor:nesw-resize;transform:scaleY(-1)}
.resize-handle.corner.tl{left:0;top:0;cursor:nwse-resize;transform:scale(-1,-1)}
.resize-handle.edge{background:transparent;transition:background .15s}
.resize-handle.edge:hover,.resize-handle.edge.dragging{background:var(--bg-active)}
.resize-handle.edge::after{content:"";position:absolute;border-radius:2px;background:var(--text-muted);opacity:.5;transition:opacity .15s ease,background .15s ease}
.resize-handle.edge:hover::after,.resize-handle.edge.dragging::after{opacity:1;background:var(--accent-text)}
.resize-handle.edge.n{top:0;left:30px;right:30px;height:8px;cursor:ns-resize}
.resize-handle.edge.s{bottom:0;left:30px;right:30px;height:8px;cursor:ns-resize}
.resize-handle.edge.w{left:0;top:30px;bottom:30px;width:8px;cursor:ew-resize}
.resize-handle.edge.e{right:0;top:30px;bottom:30px;width:8px;cursor:ew-resize}
.resize-handle.edge:is(.n,.s)::after{left:50%;width:36px;height:3px;margin-left:-18px}
.resize-handle.edge:is(.w,.e)::after{top:50%;width:3px;height:36px;margin-top:-18px}
.resize-handle.edge.n::after{top:2px}
.resize-handle.edge.s::after{bottom:2px}
.resize-handle.edge.w::after{left:2px}
.resize-handle.edge.e::after{right:2px}

/* ── header ── */
.hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 10px 10px 14px;gap:8px;
  border-bottom:1px solid var(--border);
  flex:0 0 auto;position:relative;z-index:3;
}
.hdr-title{
  display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0;
  font-family:var(--display);font-weight:650;font-size:var(--fs-lg);letter-spacing:-.01em;
  color:var(--text-strong);
}
.hdr-title > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdr-mark{width:22px;height:22px;border-radius:6px;background:var(--xg-accent,#7357e8);flex:0 0 auto;display:grid;place-items:center}
.hdr-mark .goose{width:22px;height:22px;display:block}
.hdr-actions,.hdr-tools{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.hdr-icon-btn{
  width:30px;height:30px;padding:0;position:relative;
  display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:none;color:var(--text-muted);
  border-radius:8px;cursor:pointer;
  transition:background .12s ease,color .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.hdr-icon-btn:hover{background:var(--bg-hover);color:var(--text-strong)}
.hdr-icon-btn .hdr-glyph{width:16px;height:16px;display:block}
.btn-new{
  display:inline-flex;align-items:center;gap:5px;
  height:30px;padding:0 10px;margin:0 2px 0 4px;
  background:transparent;color:var(--text-strong);
  border:1px solid var(--border-input);border-radius:8px;
  font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap;
  transition:background .12s ease,border-color .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.btn-new:hover{background:var(--bg-hover);border-color:var(--border-strong)}
.btn-new .btn-new-glyph{font-size:var(--fs-lg);line-height:1;font-weight:500}
.btn-todos .todo-count{
  position:absolute;top:1px;right:0;display:none;
  background:var(--accent);color:var(--on-accent);
  border-radius:999px;padding:0 4px;min-width:14px;height:14px;
  font-size:calc(9.5px * var(--xg-font-scale,1));font-weight:700;line-height:14px;text-align:center;
  font-variant-numeric:tabular-nums;box-shadow:0 0 0 2px var(--bg);
}
.btn-todos .todo-count.active{display:block}
.btn-todos.has-active{color:var(--accent-text);background:var(--bg-hover)}

/* ── skills bar ── */
.skills-bar{
  display:flex;gap:6px;flex-wrap:wrap;align-items:center;
  padding:7px 14px;border-bottom:1px solid var(--border);
  flex:0 0 auto;font-size:var(--fs-xs);position:relative;z-index:3;
}
.skills-bar .label{color:var(--text-faint);flex-shrink:0}
.skills-bar .skills-list{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1 1 auto;min-width:0}
.skills-bar .skill-chip{
  display:inline-flex;align-items:center;
  background:var(--chip-bg);color:var(--chip-key);
  border:none;border-radius:6px;padding:2px 8px;
  font-size:var(--fs-xs);font-weight:550;
  cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .12s ease,color .12s ease;
}
.skills-bar .skill-chip:hover{background:var(--bg-active);color:var(--text-strong)}
.skills-bar .skill-chip.disabled{opacity:.55;text-decoration:line-through}
.skills-bar .skill-chip.user-authored{box-shadow:inset 0 0 0 1px var(--border-strong)}
.skills-bar .empty{color:var(--text-faint)}
.skills-login-hint{margin:0;padding:6px 14px 0;color:var(--text-faint);font-size:var(--fs-xs);line-height:1.4}
.panel > .skill-menu{
  position:absolute;z-index:8;min-width:170px;padding:4px;
  background:var(--bg);color:var(--text);
  border-radius:10px;box-shadow:var(--shadow);font-size:var(--fs-sm);
}
.skill-menu button{
  display:block;width:100%;text-align:left;background:transparent;border:0;color:inherit;
  padding:7px 10px;border-radius:6px;cursor:pointer;font-size:inherit;
}
.skill-menu button:hover{background:var(--bg-hover);color:var(--text-strong)}

/* ── messages ── */
.msgs,.history,.todos-list,.reason-body,.tool-detail{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
:is(.msgs,.history,.todos-list,.reason-body,.tool-detail)::-webkit-scrollbar{width:8px;height:8px}
:is(.msgs,.history,.todos-list,.reason-body,.tool-detail)::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:4px;border:2px solid transparent;background-clip:content-box}
.msgs{
  flex:1 1 0;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;
  padding:14px;position:relative;z-index:1;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
}
.msgs > *{display:block;margin-bottom:10px}
.msgs > *:last-child{margin-bottom:0}

.empty-state{padding:44px 12px 32px;color:var(--text-muted)}
.empty-state h3{
  margin:0 0 8px;font-family:var(--display);font-size:var(--fs-xl);font-weight:650;letter-spacing:-.015em;
  color:var(--text-strong);
}
.empty-state p{margin:0 0 6px;font-size:var(--fs-sm);line-height:1.55;max-width:34em}
.empty-state .empty-hint{color:var(--text-faint)}
.empty-state .api-warn{
  margin-top:14px;padding:9px 12px;background:var(--err-bg);
  color:var(--err-text);border:1px solid var(--err-border);border-radius:10px;font-size:var(--fs-sm);
}
.empty-state .api-cta,.reply-post-btn{
  background:var(--accent);color:var(--on-accent);border:none;border-radius:9px;
  font-size:var(--fs-sm);font-weight:600;cursor:pointer;
  transition:background .12s ease,opacity .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.empty-state .api-cta{margin-top:14px;padding:9px 16px}
.empty-state .api-cta:hover,.reply-post-btn:hover{background:var(--accent-hover)}

.msg-user-wrap{text-align:right}
.msg-user{
  display:inline-block;text-align:left;max-width:88%;
  background:var(--user-bg);color:var(--user-text);
  padding:8px 13px;border-radius:14px 14px 4px 14px;
  font-size:var(--fs-md);line-height:1.5;
  word-wrap:break-word;white-space:pre-wrap;
}
.msg-user img{max-width:100%;max-height:220px;object-fit:contain;border-radius:8px;display:block;margin-top:8px}

.msg-ai{color:var(--text-ai);font-size:var(--fs-md);line-height:1.6;word-wrap:break-word;overflow-wrap:anywhere}
.msg-ai > :first-child{margin-top:0}
.msg-ai > :last-child{margin-bottom:0}
.msg-ai h1,.msg-ai h2,.msg-ai h3{
  font-family:var(--display);color:var(--text-ai-head);
  margin:14px 0 4px;font-size:var(--fs-md);font-weight:650;letter-spacing:-.005em;
}
.msg-ai h1,.msg-ai h2{font-size:var(--fs-lg)}
.msg-ai p{margin:6px 0}
.msg-ai strong{color:var(--text-ai-head);font-weight:650}
.msg-ai ul,.msg-ai ol{margin:6px 0;padding-left:20px}
.msg-ai li{margin:3px 0}
.msg-ai a{color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent)}
.msg-ai a:hover{text-decoration-color:currentColor}
.msg-ai blockquote{border-left:2px solid var(--border-strong);margin:8px 0;padding:1px 12px;color:var(--text-muted)}
.msg-ai hr{border:none;height:1px;margin:12px 0;background:var(--border)}
.msg-ai pre,.msg-ai code,.tool-detail pre{font-family:${MONO}}
.msg-ai pre{
  background:var(--code-bg);color:var(--code-text);
  padding:10px 12px;border-radius:10px;overflow-x:auto;
  font-size:var(--fs-xs);margin:8px 0;line-height:1.5;-webkit-overflow-scrolling:touch;
}
.msg-ai code{background:var(--code-inline);padding:1px 5px;border-radius:5px;font-size:.9em;color:var(--code-text)}
.msg-ai pre code{background:none;padding:0;font-size:inherit}
/* Columns size to their content: short ones (#, dates, links) stay narrow and
   the long text column takes the rest. A table too wide for the panel scrolls
   sideways instead of squeezing every column. */
.msg-ai table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:10px 0;font-size:var(--fs-sm);-webkit-overflow-scrolling:touch}
.msg-ai th,.msg-ai td{border-bottom:1px solid var(--table-border);padding:6px 12px 6px 0;text-align:left;vertical-align:top;min-width:5.5em}
.msg-ai :is(th,td):first-child{min-width:2em}
.msg-ai :is(th,td):last-child{padding-right:0}
.msg-ai th{white-space:nowrap}
.msg-ai td :is(a,code){overflow-wrap:anywhere}
.msg-ai th{color:var(--text-muted);font-weight:600;font-size:var(--fs-xs);border-bottom-color:var(--border-strong)}
.msg-ai tr:last-child td{border-bottom:none}

.msg-err{
  background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);
  font-size:var(--fs-sm);padding:8px 12px;border-radius:10px;overflow-wrap:anywhere;
}

/* ── activity ── consecutive tool calls and reasoning collapse into one line. */
.steps{font-size:var(--fs-sm);color:var(--text-muted)}
.steps-hdr{
  display:inline-flex;align-items:center;gap:7px;max-width:100%;
  margin-left:-6px;padding:3px 8px 3px 6px;border:none;border-radius:7px;background:transparent;
  color:inherit;font-size:inherit;cursor:pointer;text-align:left;
  -webkit-tap-highlight-color:transparent;
}
.steps-hdr:hover{background:var(--bg-hover);color:var(--text-strong)}
.steps-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.steps-caret{width:10px;height:10px;flex:0 0 auto;color:var(--text-faint);transition:transform .15s ease}
.steps.open .steps-caret{transform:rotate(90deg)}
.steps-list{display:none;margin:2px 0 2px 1px;padding-left:10px;border-left:1px solid var(--border)}
.steps.open .steps-list{display:block}
.steps-st,.tool-st{flex:0 0 14px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:var(--fs-2xs);line-height:1}
:is(.steps-st,.tool-st).done{color:var(--text-faint)}
/* Only visible once the activity line is expanded. */
.tool-st.error{color:var(--err-text)}
.sp{
  width:11px;height:11px;border:1.5px solid color-mix(in srgb,var(--beak) 28%,transparent);
  border-top-color:var(--beak);border-radius:50%;flex:0 0 auto;
  animation:spin .8s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.tool-hdr,.reason-hdr{
  display:flex;align-items:center;gap:7px;min-height:24px;
  padding:2px 6px;border-radius:6px;cursor:pointer;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
}
.tool-hdr:hover,.reason-hdr:hover{background:var(--bg-hover)}
.tool-body{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px}
.tool-title{color:var(--text);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.tool-sub{color:var(--text-faint);font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 0;min-width:0}
.tool-detail{display:none;margin:2px 0 6px 27px;max-height:260px;overflow:auto;-webkit-overflow-scrolling:touch}
.tool-detail.open{display:block}
.tool-detail .section{margin-top:6px;font-size:var(--fs-2xs);color:var(--text-faint);font-weight:600}
.tool-detail pre{margin:3px 0 0;white-space:pre-wrap;word-break:break-word;font-size:var(--fs-2xs);line-height:1.45;color:var(--text-muted)}
.tool-detail pre.code{
  background:var(--code-bg);color:var(--code-text);padding:8px 10px;border-radius:8px;
  white-space:pre;overflow-x:auto;word-break:normal;
}
.chip-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{
  display:inline-flex;align-items:baseline;gap:3px;max-width:100%;overflow:hidden;
  background:var(--chip-bg);border-radius:5px;padding:1px 6px;
  font-size:var(--fs-2xs);font-family:${MONO};
}
.chip-key{color:var(--chip-key);font-weight:600}
.chip-eq{color:var(--text-faint)}
.chip-val{color:var(--chip-val);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.reason-hdr{color:var(--text-muted);font-size:var(--fs-sm)}
.reason-arrow{width:14px;flex:0 0 14px;text-align:center;font-size:calc(8px * var(--xg-font-scale,1));color:var(--text-faint);transition:transform .15s ease}
.reason.open .reason-arrow{transform:rotate(90deg)}
.reason-body{
  display:none;margin:2px 0 6px 27px;color:var(--text-muted);
  font-size:var(--fs-xs);line-height:1.5;max-height:220px;overflow-y:auto;
  white-space:pre-wrap;word-break:break-word;-webkit-overflow-scrolling:touch;
}
.reason.open .reason-body{display:block}

.thinking{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:var(--fs-sm)}

/* ── reply block (fenced "reply" code block) ── */
.reply-block{background:var(--bg-elevated);border-radius:10px;border-left:3px solid var(--accent);margin:8px 0;overflow:hidden}
.reply-body{padding:10px 12px;font-size:var(--fs-sm);line-height:1.6;color:var(--text);word-break:break-word;white-space:pre-wrap}
.reply-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 12px 10px}
.reply-to{font-size:var(--fs-xs);color:var(--text-muted);margin-right:auto;font-family:${MONO}}
.reply-post-btn{padding:6px 14px}
.reply-post-btn:disabled{opacity:.55;cursor:default}
.reply-post-btn.posted{background:var(--ok)}
.reply-post-btn.errored{background:var(--err-text)}

/* ── progress + status ── */
.gen-bar{flex:0 0 2px;overflow:hidden;opacity:0;transition:opacity .2s ease}
.gen-bar.active{opacity:1}
.gen-bar-inner{width:35%;height:100%;background:var(--beak);border-radius:2px;animation:gen-slide 1.3s ease-in-out infinite}
@keyframes gen-slide{0%{transform:translateX(-100%)}100%{transform:translateX(390%)}}
.status-row{
  display:flex;align-items:center;gap:8px;min-height:22px;
  padding:3px 14px;font-size:var(--fs-2xs);color:var(--text-faint);
  flex:0 0 auto;position:relative;z-index:3;font-variant-numeric:tabular-nums;
}
.loading-status{display:none;align-items:center;gap:6px;color:var(--text-muted);white-space:nowrap;min-width:0;overflow:hidden;flex:0 1 auto}
.loading-status.active{display:flex}
.loading-status .sp{width:9px;height:9px}
.loading-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.context-meter{flex:0 0 auto;white-space:nowrap}
.context-meter[hidden]{display:none}
.metrics{flex:0 0 auto;display:none;align-items:center;gap:5px;white-space:nowrap}
.metrics.active{display:inline-flex}
.metrics .sep{opacity:.5}
.metrics .cost{color:var(--text-muted);font-weight:600}
.metrics .cache-hit{color:var(--ok)}

/* ── history + todos (replace the conversation while open) ── */
.history{display:none;flex:1 1 0;overflow-y:auto;padding:8px 10px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.history.open{display:block}
:is(.history,.todos).open ~ :is(.msgs,.status-row,.gen-bar,.shortcuts,.input-area,.queued-row){display:none}
.history-empty,.todos-empty{color:var(--text-faint);font-size:var(--fs-sm);text-align:center;padding:32px 12px;line-height:1.55}
.history-section{font-size:var(--fs-xs);color:var(--text-faint);font-weight:600;padding:10px 6px 4px}
.history-item{
  display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;cursor:pointer;
  transition:background .12s ease;-webkit-tap-highlight-color:transparent;
}
.history-item:hover{background:var(--bg-hover)}
.history-item.current{background:var(--bg-active)}
.history-item-body{flex:1;min-width:0}
.history-item-title{color:var(--text-strong);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550}
.history-item-meta{color:var(--text-faint);font-size:var(--fs-2xs);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.history-item-actions{flex:0 0 auto;display:flex;gap:2px;opacity:0;transition:opacity .12s ease}
.history-item:hover .history-item-actions,.history-item.current .history-item-actions{opacity:1}
.history-act{
  color:var(--text-muted);font-size:var(--fs-md);cursor:pointer;padding:4px 7px;border-radius:6px;
  display:inline-flex;align-items:center;justify-content:center;line-height:1;
  -webkit-tap-highlight-color:transparent;
}
.history-act:hover{color:var(--text-strong);background:var(--bg-active)}
.history-act.del:hover{color:var(--err-text);background:var(--err-bg)}

.todos{display:none;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.todos.open{display:flex}
.todos-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px 8px;flex:0 0 auto}
.todos-title{color:var(--text-strong);font-size:var(--fs-sm);font-weight:650;display:flex;align-items:baseline;gap:8px}
.todos-summary{font-size:var(--fs-2xs);color:var(--text-faint);font-weight:500;font-variant-numeric:tabular-nums}
.todos-clear{
  background:transparent;border:1px solid var(--border-input);color:var(--text-muted);
  font-size:var(--fs-xs);padding:4px 10px;border-radius:7px;cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.todos-clear:hover{background:var(--err-bg);color:var(--err-text);border-color:var(--err-border)}
.todos-clear:disabled{opacity:.4;cursor:default}
.todos-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 10px 14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.todos-empty code{background:var(--code-inline);color:var(--code-text);padding:1px 5px;border-radius:5px;font-family:${MONO};font-size:.9em}
.todo-item{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:8px}
.todo-item:hover{background:var(--bg-hover)}
.todo-status{
  flex:0 0 auto;width:18px;height:18px;margin-top:2px;padding:0;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:var(--fs-2xs);font-weight:700;line-height:1;cursor:pointer;
  border:1.5px solid var(--border-strong);background:transparent;color:var(--on-accent);
  -webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;
}
.todo-text{flex:1 1 auto;color:var(--text);font-size:var(--fs-sm);line-height:1.55;word-break:break-word}
.todo-item.in_progress .todo-status{border-color:var(--beak);background:var(--beak)}
.todo-item.in_progress .todo-status::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--bg)}
.todo-item.in_progress .todo-text{color:var(--text-strong);font-weight:600}
.todo-item.completed .todo-status{border-color:var(--accent);background:var(--accent)}
.todo-item.completed .todo-status::before{content:'\\2713'}
.todo-item.completed .todo-text{text-decoration:line-through;color:var(--text-faint)}

/* ── composer ── */
.shortcuts{display:flex;gap:6px;padding:4px 12px 0;flex-wrap:wrap}
.shortcuts:empty{display:none}
.shortcuts button{
  background:transparent;color:var(--text-muted);
  border:1px solid var(--border-input);border-radius:999px;
  padding:4px 11px;font-size:var(--fs-xs);cursor:pointer;white-space:nowrap;
  transition:background .12s ease,color .12s ease,border-color .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.shortcuts button:hover{background:var(--bg-hover);color:var(--text-strong);border-color:var(--border-strong)}

.queued-row{display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 14px 0;position:relative;z-index:3}
.queued-row.active{display:flex}
.queued-row .qlabel{font-size:var(--fs-xs);color:var(--text-faint);margin-right:2px}
.queued-pill{
  background:var(--bg-elevated);border-radius:999px;padding:2px 2px 2px 10px;
  display:inline-flex;gap:4px;align-items:center;font-size:var(--fs-xs);color:var(--text);max-width:240px;
}
.queued-pill .qtext{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.queued-pill .qrm{
  cursor:pointer;background:transparent;border:none;color:var(--text-muted);
  font-size:var(--fs-md);line-height:1;padding:3px 7px;border-radius:999px;
  -webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;
}
.queued-pill .qrm:hover{background:var(--bg-active);color:var(--text-strong)}

.image-previews{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px 0;flex:0 0 auto;font-size:var(--fs-xs);color:var(--text-muted)}
.image-previews[hidden],.image-error[hidden],.btn-attach[hidden]{display:none}
.image-previews .image-hint{width:100%}
.image-preview{position:relative;width:60px;height:60px}
.image-preview img{width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border-strong)}
.image-preview button{
  position:absolute;top:-6px;right:-6px;width:20px;height:20px;padding:0;line-height:1;
  border:1px solid var(--border-strong);border-radius:50%;background:var(--bg);color:var(--text-strong);cursor:pointer;
}
.image-error{padding:8px 14px 0;color:var(--err-text);font-size:var(--fs-sm);flex:0 0 auto}

/* One bordered field holding attach, text and actions. */
.input-area{
  display:flex;align-items:flex-end;gap:4px;
  margin:8px 12px 12px;padding:5px;
  border:1px solid var(--border-input);border-radius:14px;background:var(--bg-input);
  flex:0 0 auto;position:relative;z-index:3;
  transition:border-color .12s ease,box-shadow .12s ease;
}
.input-area:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.input-area textarea{
  flex:1 1 0;min-width:0;width:0;resize:none;
  border:none;outline:none;background:transparent;color:var(--text-strong);
  padding:6px 6px;font-size:var(--fs-md);font-family:inherit;line-height:1.45;
  max-height:120px;min-height:22px;
  -webkit-appearance:none;appearance:none;
}
.input-area textarea:focus-visible{outline:none}
.input-area textarea::placeholder{color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.input-area textarea:disabled{opacity:.4;cursor:not-allowed}
.input-actions{display:inline-flex;align-items:flex-end;gap:4px;flex:0 0 auto}
.btn-attach{
  display:grid;place-items:center;width:32px;height:32px;padding:0;flex:0 0 auto;
  border:none;border-radius:9px;background:transparent;color:var(--text-muted);cursor:pointer;
}
.btn-attach:hover{color:var(--text-strong);background:var(--bg-hover)}
.btn-send,.btn-stop{
  -webkit-appearance:none;appearance:none;cursor:pointer;
  height:32px;padding:0 14px;border-radius:9px;
  font-size:var(--fs-sm);font-weight:600;white-space:nowrap;
  transition:background .12s ease,opacity .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.btn-send{background:var(--accent);color:var(--on-accent);border:none}
.btn-send:hover{background:var(--accent-hover)}
.btn-send:disabled{background:var(--send-disabled-bg);color:var(--text-faint);cursor:default}
/* Stop only shows during a turn; Send stays available to queue the next prompt. */
.btn-stop{display:none;align-items:center;background:transparent;color:var(--err-text);border:1px solid var(--err-border)}
.btn-stop.active{display:inline-flex}
.btn-stop:hover{background:var(--err-bg)}
.btn-stop:disabled{opacity:.6;cursor:default}

/* ── phones ── the panel is a floating card sized by JS; touch targets grow and
   inputs use 16px so iOS does not zoom on focus. */
@media ${MOBILE}{
  .btn-expand{display:none !important}
  .resize-handle.corner{width:34px !important;height:34px !important}
  .resize-handle.edge.n,.resize-handle.edge.s{height:16px}
  .resize-handle.edge.e,.resize-handle.edge.w{width:16px}
  .hdr{padding:8px 8px 8px 14px}
  .hdr-icon-btn{width:40px;height:40px;border-radius:10px}
  .hdr-icon-btn .hdr-glyph{width:19px;height:19px}
  .btn-new{height:36px;padding:0 12px}
  .skills-bar{padding:8px 14px}
  .skills-bar .skill-chip{padding:5px 10px;min-height:28px}
  .msg-user,.msg-ai{font-size:calc(15px * var(--xg-font-scale,1))}
  .tool-hdr,.reason-hdr{min-height:32px}
  .steps-hdr{padding:6px 10px 6px 6px}
  .input-area textarea,.in-text{font-size:calc(16px * var(--xg-font-scale,1))}
  .btn-attach{width:40px;height:40px}
  .btn-send,.btn-stop{height:40px;padding:0 16px;font-size:var(--fs-md)}
  .history-item-actions{opacity:1}
  .history-act{padding:8px 11px}
  .todo-item{padding:10px 8px}
  .todo-status{width:24px;height:24px}
}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001s !important;animation-iteration-count:1 !important;transition-duration:.001s !important}
}
@media (prefers-contrast:more){
  .panel{--border:rgba(255,255,255,.3);--border-input:rgba(255,255,255,.4);--text:#fff;--text-muted:#d6d3e6;--text-faint:#b3afc8}
  .panel.light{--border:rgba(0,0,0,.3);--border-input:rgba(0,0,0,.45);--text:#000;--text-muted:#24203b;--text-faint:#4a4664}
}
`;
