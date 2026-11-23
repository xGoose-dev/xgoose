/** Aurora preset. Its effects are the ones observed running on the Awwwards
 * template sites (cosmoq.framer.website, armory.framer.ai): glass over a blurred
 * light orb, blur-in reveals, staggered lists, gradient-rimmed controls and
 * edge-fade masks. Every loop stops under prefers-reduced-motion through the
 * host stylesheets. */
const LIGHTS = "radial-gradient(38% 34% at 22% 24%,#7357e8cc,transparent 70%),radial-gradient(34% 30% at 78% 30%,#4fa8ffaa,transparent 70%),radial-gradient(40% 34% at 55% 82%,#ffae5799,transparent 70%)";
const FILL = "linear-gradient(135deg,#7357e8,#5b8def)";
const FLOW = "linear-gradient(90deg,#7357e8,#4fa8ff,#ffae57,#7357e8)";
const A = ".panel[data-xg-preset=aurora]";
const STAGGER = [1,2,3,4,5,6,7,8].map(i=>`${A} :is(.shortcuts button,.steps.open .steps-list>*,.history.open .history-item,.empty-state p):nth-child(${i}){animation-delay:${i*45}ms}`).join("\n");

export const AURORA_STYLE_CSS = `
/* The mode attribute lifts these above the shared preset rule. */
${A}[data-xg-mode]{--beak:#ffae57}
${A}[data-xg-mode=dark]{--accent-text:#b7a9fb}
/* Drifting light behind the conversation, above the glass surface. */
${A}::before{content:"";position:absolute;inset:-25%;z-index:-1;pointer-events:none;background:${LIGHTS};filter:blur(36px);opacity:.5;animation:xg-drift 22s ease-in-out infinite alternate;translate:calc(var(--xg-px,0) * 46px) calc(var(--xg-py,0) * 46px);transition:translate .7s ease-out}
${A}.light::before{opacity:.32}
${A}.open{animation:xg-pop .32s cubic-bezier(.2,.9,.3,1.2)}
${A} .msgs>*{animation:xg-rise .45s cubic-bezier(.2,.8,.2,1) both}
/* Content fades out at the top and bottom edges of the conversation. */
${A} .msgs{-webkit-mask-image:linear-gradient(#0000,#000 16px,#000 calc(100% - 16px),#0000);mask-image:linear-gradient(#0000,#000 16px,#000 calc(100% - 16px),#0000)}
/* Lists arrive one item after another. */
${A} :is(.shortcuts button,.steps.open .steps-list>*,.history.open .history-item,.empty-state p){animation:xg-rise .4s cubic-bezier(.2,.8,.2,1) both}
${STAGGER}
/* Headings slide up out of a clip, as on halston-architecture-template.webflow.io. */
${A} :is(.empty-state h3,.msg-ai :is(h1,h2,h3)){animation:xg-line .6s cubic-bezier(.2,.8,.2,1) both}
/* The greeting lights up left to right once, like cosmoq's scroll paragraph. */
${A} .empty-state h3{background:linear-gradient(100deg,var(--text-strong) 45%,var(--text-faint) 55%) 100% 0/220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:xg-line .6s cubic-bezier(.2,.8,.2,1) both,xg-light 1.4s .2s ease-out both}
/* Faint dot grid behind the conversation, as on armory.framer.ai. */
${A} .msgs{background-image:radial-gradient(color-mix(in srgb,var(--text) 13%,transparent) 1px,transparent 1.5px);background-size:18px 18px}
/* Outlined controls carry a gradient rim. */
${A} .btn-new{border-color:transparent;background:linear-gradient(var(--xg-surface-solid),var(--xg-surface-solid)) padding-box,linear-gradient(120deg,#4fa8ff,#7357e8,#ffae57) border-box}
${A} .btn-new:hover{background:linear-gradient(var(--bg-active),var(--bg-active)) padding-box,linear-gradient(var(--xg-surface-solid),var(--xg-surface-solid)) padding-box,linear-gradient(120deg,#4fa8ff,#7357e8,#ffae57) border-box}
/* Text of the step in progress shimmers until it settles. */
${A} :is(.steps:has(.steps-st .sp) .steps-label,.thinking span,.loading-text){background:linear-gradient(100deg,var(--text-muted) 30%,var(--text-strong) 50%,var(--text-muted) 70%) 0 0/250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:xg-shimmer 1.8s linear infinite}
${A} .msg-user{background:${FILL};color:#fff}
${A} .input-area{background:color-mix(in srgb,var(--bg) 55%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
/* While a turn runs, light flows around the composer. */
${A}:has(.gen-bar.active) .input-area::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;pointer-events:none;background:${FLOW} 0 0/300% 100%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:xg-flow 2.4s linear infinite}
${A} .gen-bar-inner{background:linear-gradient(90deg,transparent,#7357e8,#4fa8ff,#ffae57,transparent)}
${A} .btn-send{position:relative;overflow:hidden;background:${FILL};transition:transform .15s ease,box-shadow .2s ease}
${A} .btn-send:disabled{background:var(--send-disabled-bg)}
${A} .btn-send:not(:disabled):hover{transform:translateY(-1px);box-shadow:0 8px 22px -8px #7357e8}
${A} .btn-send:not(:disabled):active{transform:scale(.96)}
${A} .btn-send::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:45%;background:linear-gradient(100deg,transparent,#ffffff66,transparent);transform:skewX(-20deg);transition:left .55s ease}
${A} .btn-send:not(:disabled):hover::after{left:120%}
:host([data-xg-preset=aurora]) .toggle{background:${FILL};animation:xg-breathe 3.6s ease-in-out infinite}
:host([data-xg-preset=aurora]) .toggle .goose{transition:transform .25s cubic-bezier(.2,.9,.3,1.4)}
:host([data-xg-preset=aurora]) .toggle:hover .goose{transform:rotate(-10deg) scale(1.08)}
/* Extension pages: the same light behind glass sections. */
:root[data-xg-preset=aurora] body{background:transparent}
:root[data-xg-preset=aurora] body::before{content:"";position:fixed;inset:-20%;z-index:-1;pointer-events:none;background:${LIGHTS};filter:blur(60px);opacity:.28;animation:xg-drift 26s ease-in-out infinite alternate}
:root[data-xg-preset=aurora] section[id^=section-]{-webkit-backdrop-filter:blur(var(--xg-blur));backdrop-filter:blur(var(--xg-blur))}
:root[data-xg-preset=aurora] .btn.primary{background:${FILL}}
.xg-sample[data-xg-preset=aurora]{background-image:radial-gradient(60% 60% at 20% 20%,#7357e866,transparent 70%),radial-gradient(60% 60% at 85% 80%,#ffae5755,transparent 70%)}
.xg-sample[data-xg-preset=aurora] .xg-sample-bubble{background:${FILL}}
@keyframes xg-drift{0%{transform:translate3d(-4%,-3%,0) rotate(0deg) scale(1)}50%{transform:translate3d(5%,4%,0) rotate(18deg) scale(1.12)}100%{transform:translate3d(-3%,6%,0) rotate(-12deg) scale(1.04)}}
@keyframes xg-pop{from{opacity:0;transform:translateY(10px) scale(.96)}}
@keyframes xg-rise{from{opacity:0;transform:translateY(10px);filter:blur(6px)}}
@keyframes xg-shimmer{from{background-position:120% 0}to{background-position:-130% 0}}
@keyframes xg-line{from{clip-path:inset(0 0 100% 0);transform:translateY(55%)}to{clip-path:inset(0);transform:none}}
@keyframes xg-light{from{background-position:100% 0}to{background-position:0 0}}
@keyframes xg-flow{to{background-position:300% 0}}
@keyframes xg-breathe{0%,100%{box-shadow:0 8px 20px -4px #24203b61,0 0 0 0 #7357e873}50%{box-shadow:0 8px 20px -4px #24203b61,0 0 0 12px #7357e800}}
`;
