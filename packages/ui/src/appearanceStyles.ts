import {AURORA_STYLE_CSS} from "./auroraStyles";
import {THEME_STYLE_CSS} from "./themeStyles";
/** xgoose material/shape adaptations of bundled tweakcn and daisyUI themes. */
export const APPEARANCE_STYLE_CSS = `
/* Material is applied to xgoose surfaces, never to the host website. */
.panel[data-xg-preset]:not([data-xg-preset=default]),.xg-sample[data-xg-preset] {
  border-radius:var(--xg-radius);border:var(--xg-border-width) solid var(--xg-border-color);
  background:var(--xg-surface);box-shadow:var(--xg-shadow);color:var(--text,var(--xg-sample-text));
  -webkit-backdrop-filter:blur(var(--xg-blur));backdrop-filter:blur(var(--xg-blur));
}
.panel[data-xg-preset]:not([data-xg-preset=default]) {--user-bg:var(--xg-accent);--user-text:var(--xg-on-accent);--beak:var(--xg-accent)}
.panel[data-xg-preset]:not([data-xg-preset=default]) :is(.btn-new,.btn-send,.btn-stop,.api-cta,.reply-post-btn,.msg-user,.input-area,.hdr-icon-btn) {border-radius:var(--xg-control-radius)}
.panel[data-xg-preset=bold] :is(.btn-new,.btn-send,.api-cta,.reply-post-btn,.msg-user,.input-area) {border:2px solid var(--xg-border-color);box-shadow:3px 3px 0 var(--xg-border-color)}
.panel[data-xg-preset=bold] :is(.btn-new,.btn-send):active {transform:translate(2px,2px);box-shadow:1px 1px 0 var(--xg-border-color)}
.panel[data-xg-preset=soft] :is(.btn-new,.btn-send) {box-shadow:var(--xg-shadow)}
.panel[data-xg-preset=notebook] .msgs {background-image:repeating-linear-gradient(transparent 0 31px,color-mix(in srgb,var(--text) 7%,transparent) 31px 32px)}
.panel[data-xg-preset=bold] .hdr-icon-btn {border:2px solid var(--xg-border-color)}
:root[data-xg-preset]:not([data-xg-preset=default]) section[id^=section-] {border-radius:var(--xg-radius);border-width:var(--xg-border-width);border-color:var(--xg-border-color);box-shadow:var(--xg-shadow)}
.panel[data-xg-preset]:not([data-xg-preset=default]) .msg-ai pre {border-radius:var(--xg-control-radius);border-color:var(--xg-border-color)}
/* Reflection layers adapted from daisyUI glass.css (MIT). */
.panel[data-xg-preset=glass],.xg-sample[data-xg-preset=glass],:root[data-xg-preset=glass] :is(.card,.card-glow,.appearance-dialog,.site-header) {
  background-color:var(--xg-surface);
  background-image:linear-gradient(135deg,#ffffff30,transparent),linear-gradient(100deg,#ffffff12 25%,transparent 25%);
  -webkit-backdrop-filter:blur(var(--xg-blur)) saturate(140%);backdrop-filter:blur(var(--xg-blur)) saturate(140%);
}
:root[data-xg-preset]:not([data-xg-preset=default]) :is(.card,.card-glow,.appearance-dialog,.section-card) {
  border-radius:var(--xg-radius);border-width:var(--xg-border-width);border-color:var(--xg-border-color);box-shadow:var(--xg-shadow);background-color:var(--xg-surface);
}
:root[data-xg-preset]:not([data-xg-preset=default]) :is(.btn,button.primary,.input,input:not([type=range]):not([type=checkbox]),select,textarea) {border-radius:var(--xg-control-radius)}
:root[data-xg-preset=bold] :is(.btn,button.primary,.input,select,textarea) {border:2px solid var(--xg-border-color);box-shadow:3px 3px 0 var(--xg-border-color)}
:root[data-xg-preset=bold] :is(h1,h2,h3,.btn) {font-weight:800}
:root[data-xg-preset=soft] :is(.btn-primary,button.primary) {box-shadow:var(--xg-shadow)}
:root[data-xg-preset=notebook] body {background-image:repeating-linear-gradient(transparent 0 31px,hsl(var(--foreground) / .045) 31px 32px)}
:root[data-xg-preset=glass] body {background-image:radial-gradient(ellipse at 0% 0%,#65b9cf22,transparent 55%),radial-gradient(ellipse at 100% 50%,#a2a7c62b,transparent 55%);background-attachment:fixed}
:root[data-xg-preset=glass] :is(.option-section,.setting-section,section[id^=section-]) {background:var(--xg-surface);-webkit-backdrop-filter:blur(var(--xg-blur));backdrop-filter:blur(var(--xg-blur))}
@supports not (backdrop-filter:blur(1px)) {
  .panel[data-xg-preset=glass],:root[data-xg-preset=glass] :is(.card,.card-glow,.appearance-dialog,.site-header) {background:var(--xg-surface-solid)}
}
@media(prefers-reduced-transparency:reduce) {
  .panel[data-xg-preset=glass],:root[data-xg-preset=glass] :is(.card,.card-glow,.appearance-dialog,.site-header) {background:var(--xg-surface-solid);-webkit-backdrop-filter:none;backdrop-filter:none}
}
`+AURORA_STYLE_CSS+THEME_STYLE_CSS;

export function installAppearanceFont(url:string) {
  if(document.querySelector("style[data-xg-notebook-font]"))return;
  const style=document.createElement("style");style.dataset.xgNotebookFont="true";
  style.textContent=`@font-face{font-family:"Xgoose Notebook";src:url(${JSON.stringify(url)}) format("truetype");font-display:swap;font-weight:400;}`;
  document.head.append(style);
}
