/** Motion themes modelled on Awwwards template sites: Terminal (zui.ooo),
 * Studio (halston-architecture-template.webflow.io), Pop (nojiggery.co) and Noir (holmchrome.byholm.co). Loops stop under
 * prefers-reduced-motion through the host stylesheets. */
const P = (name: string) => `.panel[data-xg-preset=${name}][data-xg-mode]`;
const T = P("terminal"), S = P("studio"), K = P("pop"), N = P("noir");
const EASE = "cubic-bezier(.2,.8,.2,1)";
// Hover stays on after a tap, so pointer-following effects are limited to a mouse.
const MOUSE = "(hover:hover) and (pointer:fine)";

export const THEME_STYLE_CSS = `
/* ── Terminal: green monospace, prompt marks, block cursor, scanlines ── */
${T}{--beak:var(--xg-accent);--user-bg:transparent;--user-text:var(--xg-accent)}
${T} .msgs{background-image:repeating-linear-gradient(transparent 0 2px,color-mix(in srgb,var(--xg-accent) 5%,transparent) 2px 3px)}
${T} .msg-user{border:1px solid var(--xg-accent);border-radius:2px}
${T} .msg-user::before{content:"> ";opacity:.7}
${T} .msg-ai :is(h1,h2,h3)::before{content:"# ";color:var(--xg-accent)}
${T} .msgs>.msg-ai{animation:xg-type .5s steps(18) both}
${T} :is(.steps:has(.steps-st .sp) .steps-label,.thinking span,.loading-text)::after{content:"▍";margin-left:2px;color:var(--xg-accent);animation:xg-blink 1s steps(2) infinite}
${T} .hdr-title>span:last-child::after{content:"_";color:var(--xg-accent);animation:xg-blink 1s steps(2) infinite}
${T} :is(.btn-send,.btn-new){background:transparent;color:var(--xg-accent);border:1px solid var(--xg-accent);transition:background .12s,color .12s}
${T} :is(.btn-send,.btn-new):not(:disabled):hover{background:var(--xg-accent);color:var(--xg-on-accent)}
${T} .gen-bar-inner{background:repeating-linear-gradient(90deg,var(--xg-accent) 0 6px,transparent 6px 10px)}
/* ── Studio: warm stone, hairlines, uppercase headlines that slide out of a clip ── */
${S}{--user-bg:var(--xg-accent);--user-text:var(--xg-on-accent)}
${S} :is(.hdr-title,.empty-state h3,.msg-ai :is(h1,h2,h3),.btn-new,.btn-send,.steps-label){text-transform:uppercase;letter-spacing:.04em}
${S} :is(.empty-state h3,.msg-ai :is(h1,h2,h3)){font-weight:800;animation:xg-line .7s ${EASE} both}
${S} .msgs>*{animation:xg-up .5s ${EASE} both}
${S} .msg-ai :is(h1,h2,h3)::after{content:"";display:block;height:1px;margin-top:6px;background:var(--border-strong);transform-origin:left;animation:xg-rule .8s .15s ${EASE} both}
${S} .btn-send{position:relative;overflow:hidden}
${S} .btn-send::after{content:"";position:absolute;inset:0;background:var(--text-strong);transform:translateY(101%);transition:transform .35s ${EASE};mix-blend-mode:difference}
${S} .btn-send:not(:disabled):hover::after{transform:none}
/* ── Pop: aqua and hot pink, pills, springy motion ── */
${K}{--beak:var(--xg-accent)}
${K} .msgs>*{animation:xg-spring .5s cubic-bezier(.3,1.6,.5,1) both}
${K} .msg-user-wrap{transform-origin:right bottom}
${K} :is(.empty-state h3,.msg-ai :is(h1,h2,h3)){color:var(--xg-accent);font-weight:800;letter-spacing:-.02em}
${K} :is(.btn-send,.btn-new,.skill-chip,.shortcuts button){border-radius:999px;transition:transform .2s cubic-bezier(.3,1.8,.5,1)}
${K} :is(.btn-send,.btn-new,.skill-chip,.shortcuts button):not(:disabled):hover{transform:translateY(-2px) rotate(-2deg)}
${K} :is(.btn-send,.btn-new,.skill-chip,.shortcuts button):not(:disabled):active{transform:scale(.92)}
${K} .gen-bar-inner{border-radius:999px;animation:gen-slide .9s cubic-bezier(.5,0,.5,1) infinite}
:host([data-xg-preset=pop]) .toggle{border-radius:50%;animation:xg-bob 2.6s ease-in-out infinite}
/* ── Noir: black and white, grain, controls that invert ── */
${N}{--beak:var(--text-strong);--user-bg:var(--text-strong);--user-text:var(--bg)}
${N}::before{content:"";position:absolute;inset:0;z-index:5;pointer-events:none;opacity:.07;background-image:repeating-radial-gradient(circle at 17% 32%,currentColor 0 .6px,transparent .7px 3px),repeating-radial-gradient(circle at 71% 64%,currentColor 0 .5px,transparent .6px 4px);animation:xg-grain .6s steps(4) infinite}
${N} .msgs>*{animation:xg-wipe .55s ${EASE} both}
${N} :is(.btn-send,.btn-new,.hdr-icon-btn,.shortcuts button){border-radius:0;transition:background .18s,color .18s}
${N} :is(.btn-new,.hdr-icon-btn,.shortcuts button):hover{background:var(--text-strong);color:var(--bg)}
${N} .btn-send:not(:disabled):hover{background:var(--bg);color:var(--text-strong);box-shadow:inset 0 0 0 1px var(--text-strong)}
${N} .msg-ai a{text-decoration-thickness:1px;transition:background .18s,color .18s}
${N} .msg-ai a:hover{background:var(--text-strong);color:var(--bg)}
/* ── shapes and entrances ── */
/* Terminal: notched corners, a CRT power-on and a brief glitch on headings. */
${T}{clip-path:polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)}
${T}.open{animation:xg-boot .5s steps(8) both}
${T} .msg-ai :is(h1,h2,h3){animation:xg-glitch .45s steps(3) both}
/* Studio: the panel turns in like a page and leans toward the pointer. */
${S}.open{transform-origin:left center;animation:xg-turn .6s cubic-bezier(.2,.8,.2,1) both}
@media ${MOUSE}{:is(${S},.panel[data-xg-preset=aurora][data-xg-mode]):hover{transform:perspective(900px) rotateX(calc(var(--xg-py,0) * -5deg)) rotateY(calc(var(--xg-px,0) * 5deg));transition:transform .2s ease-out}}
/* Pop: a soft blob that keeps changing shape and drops in with a bounce. */
${K}{animation:xg-blob 9s ease-in-out infinite}
${K}.open{animation:xg-drop .7s cubic-bezier(.3,1.5,.5,1) both,xg-blob 9s ease-in-out infinite}
${K} .hdr{padding-inline:22px 18px}
${K} .input-area{margin-inline:18px;margin-bottom:18px}
.xg-confetti{position:absolute;z-index:7;width:8px;height:8px;border-radius:2px;pointer-events:none;animation:xg-confetti .8s cubic-bezier(.2,.7,.3,1) forwards}
/* Noir: opens through an iris; a spotlight follows the pointer. */
${N}.open{animation:xg-iris .7s cubic-bezier(.3,.7,.2,1) both}
${N}::after{content:"";position:absolute;inset:0;z-index:5;pointer-events:none;background:radial-gradient(240px circle at var(--xg-sx,50%) var(--xg-sy,40%),transparent 30%,#0000008c);opacity:0;transition:opacity .4s}
@media ${MOUSE}{${N}:hover::after{opacity:1}}
/* ── shared motion parts (motion.ts) ── */
.xg-cursor{position:absolute;left:0;top:0;z-index:6;width:14px;height:14px;margin:-7px;border-radius:50%;pointer-events:none;opacity:0;background:#fff;mix-blend-mode:difference;transition:opacity .2s,width .25s,height .25s,margin .25s}
.xg-cursor.active{opacity:1}
.xg-cursor.over{width:46px;height:46px;margin:-23px}
.panel[data-xg-preset=pop] .xg-cursor{background:var(--xg-accent);mix-blend-mode:multiply}
.panel[data-xg-preset=pop] .xg-cursor.active{opacity:.45}
.xg-ticker{display:none;flex:0 0 auto;overflow:hidden;white-space:nowrap;padding:4px 0;border-block:1px solid var(--border);font-size:var(--fs-2xs);letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted)}
.xg-ticker.active{display:block}
:is(.history,.todos).open~.xg-ticker{display:none}
.xg-ticker span{display:inline-block;animation:xg-marquee 18s linear infinite}
.xg-w{display:inline-block;animation:xg-word .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 45ms)}
.panel[data-xg-preset] .msg-ai :is(h1,h2,h3)[data-xg-split]{animation:none;clip-path:none}
.panel :is(.btn-send,.btn-new){transition:translate .25s cubic-bezier(.2,.8,.2,1),transform .15s ease,background .12s ease,box-shadow .2s ease}
/* ── thumbnails in Settings ── */
.xg-sample[data-xg-preset=terminal]{background:#050805;color:#3ddc84;border:1px solid #1f4d2b;border-radius:4px;font-family:ui-monospace,monospace}
.xg-sample[data-xg-preset=terminal] .xg-sample-bubble{background:#3ddc84}
.xg-sample[data-xg-preset=studio]{background:#e9e3da;color:#2b2420;border:1px solid #bdb2a3;border-radius:2px}
.xg-sample[data-xg-preset=studio] .xg-sample-bubble{background:#6b2d2a;border-radius:0}
.xg-sample[data-xg-preset=pop]{background:#d9eef0;color:#0e3b3b;border:1px solid #9ccbd0;border-radius:18px}
.xg-sample[data-xg-preset=pop] .xg-sample-bubble{background:#d6005a;border-radius:999px}
.xg-sample[data-xg-preset=noir]{background:#000;color:#f6f6f6;border:1px solid #f6f6f6;border-radius:0}
.xg-sample[data-xg-preset=noir] .xg-sample-bubble{background:#f6f6f6;border-radius:0}
@keyframes xg-boot{0%{transform:scaleY(.02) scaleX(.6);filter:brightness(4)}40%{transform:scaleY(.02) scaleX(1);filter:brightness(3)}100%{transform:none;filter:none}}
@keyframes xg-glitch{0%{text-shadow:-3px 0 #f0f,3px 0 #0ff;transform:translateX(-3px)}50%{text-shadow:3px 0 #f0f,-3px 0 #0ff;transform:translateX(3px)}100%{text-shadow:none;transform:none}}
@keyframes xg-turn{from{opacity:0;transform:perspective(900px) rotateY(-55deg)}}
@keyframes xg-blob{0%,100%{border-radius:30px 46px 32px 50px/48px 30px 46px 32px}33%{border-radius:48px 30px 50px 32px/32px 48px 30px 46px}66%{border-radius:34px 52px 30px 44px/44px 32px 52px 30px}}
@keyframes xg-drop{from{opacity:0;transform:translateY(-40px) scale(.7) rotate(-6deg)}}
@keyframes xg-confetti{to{transform:translate(var(--dx),calc(var(--dy) + 60px)) rotate(var(--r));opacity:0}}
@keyframes xg-iris{from{clip-path:circle(0 at 100% 100%)}to{clip-path:circle(150% at 100% 100%)}}
@keyframes xg-marquee{to{transform:translateX(-50%)}}
@keyframes xg-word{from{opacity:0;transform:translateY(.7em) rotate(5deg);filter:blur(4px)}}
@keyframes xg-blink{50%{opacity:0}}
@keyframes xg-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}
@keyframes xg-up{from{opacity:0;transform:translateY(14px)}}
@keyframes xg-rule{from{transform:scaleX(0)}}
@keyframes xg-spring{from{opacity:0;transform:scale(.8) translateY(12px)}}
@keyframes xg-bob{50%{transform:translateY(-5px)}}
@keyframes xg-grain{0%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(1px,-2px)}75%{transform:translate(2px,2px)}}
@keyframes xg-wipe{from{clip-path:inset(0 100% 0 0);transform:translateX(-8px)}to{clip-path:inset(0);transform:none}}
`;
