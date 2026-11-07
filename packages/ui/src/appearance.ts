/** Shared appearance contract. Kept identical in the website and Firefox hosts. */
import importedTokens from "./theme-presets/tokens.json";
/** Modified for xgoose from the bundled tweakcn themes and daisyUI Glass utility; see theme-presets/NOTICE. */
export const PRESETS = {
  default: {label:"Classic",description:"The familiar xgoose interface",radius:16,controlRadius:9,border:1,blur:0,font:"inherit"},
  glass: {label:"Glass",description:"Frosted glass, light edges and depth",radius:20,controlRadius:12,border:1,blur:24,font:'system-ui,-apple-system,"PingFang SC",sans-serif'},
  notebook: {label:"Notebook",description:"Paper, fine rules and handwritten type",radius:10,controlRadius:5,border:1,blur:0,font:'"Xgoose Notebook","Comic Sans MS","Kaiti SC",KaiTi,cursive'},
  soft: {label:"Soft",description:"Pillowy surfaces and soft rounded buttons",radius:24,controlRadius:16,border:1,blur:0,font:'ui-rounded,"SF Pro Rounded",system-ui,"PingFang SC",sans-serif'},
  bold: {label:"Bold",description:"Square corners, strong borders and hard shadows",radius:0,controlRadius:0,border:3,blur:0,font:'"Arial Black",system-ui,"PingFang SC",sans-serif'},
} as const;
export type Preset = keyof typeof PRESETS;
export const FONTS = {default: "Follow preset", sans: "Clean sans", serif: "Reading serif", mono: "Monospace"} as const;
export type Appearance = {preset: Preset; font: keyof typeof FONTS; fontScale: number};
export type AppearanceState = {theme: "system" | "light" | "dark"; appearance: Appearance};
export const DEFAULT_APPEARANCE: Appearance = {preset: "default", font: "default", fontScale: 1};
export const DEFAULT_APPEARANCE_STATE: AppearanceState = {theme: "system", appearance: DEFAULT_APPEARANCE};
export const FONT_STACKS = {
  default: "inherit",
  sans: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
  serif: 'Charter,"Iowan Old Style","Noto Serif CJK SC","Songti SC",SimSun,serif',
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace',
};
export function normalizeAppearance(value: unknown): Appearance {
  const a = (value || {}) as Partial<Appearance>;
  return {preset: Object.hasOwn(PRESETS, a.preset ?? "") ? a.preset! : "default",
    font: Object.hasOwn(FONTS, a.font ?? "") ? a.font! : "default",
    fontScale: typeof a.fontScale === "number" && Number.isFinite(a.fontScale) ? Math.round(Math.max(.9, Math.min(1.3, a.fontScale))*100)/100 : 1};
}
export function normalizeState(value: unknown): AppearanceState {
  const s = (value || {}) as Partial<AppearanceState>;
  return {theme:s.theme === "light" || s.theme === "dark" ? s.theme : "system", appearance:normalizeAppearance(s.appearance)};
}
export function equalAppearance(a: AppearanceState, b: AppearanceState) {return JSON.stringify(normalizeState(a)) === JSON.stringify(normalizeState(b));}
export function resolvedMode(s: AppearanceState, dark = false): "light" | "dark" {return s.theme === "system" ? dark ? "dark" : "light" : s.theme;}
function rgb(hex:string) {return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function hex(values:number[]) {return "#"+values.map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");}
function mix(color:string, target:string, amount:number) {const a=rgb(color),b=rgb(target);return hex(a.map((v,i)=>v+(b[i]-v)*amount));}
export function luminance(color:string) {return rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
export function contrast(a:string,b:string) {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function accentText(color:string) {return contrast(color,"#FFFFFF")>=contrast(color,"#000000")?"#FFFFFF":"#000000";}
export function appearanceParams(state:AppearanceState, dark:boolean) {
  const {appearance:a,theme}=normalizeState(state);
  return {preset:a.preset,font:a.font,font_scale:a.fontScale,theme,resolved_theme:resolvedMode(state,dark),
    is_customized:theme!=="system"||a.preset!=="default"||a.font!=="default"||a.fontScale!==1};
}
export const APPEARANCE_PARAM_KEYS = ["preset","font","font_scale","theme","resolved_theme","is_customized","entry_point"];
export function appearanceColors(a:Appearance,dark:boolean) {
  const tokens=(importedTokens as Record<string,Record<string,Record<string,string>>>)[a.preset]?.[dark?"dark":"light"];
  const accent=tokens?.primary ?? (dark?"#A8C5E5":"#386585");
  return {accent,onAccent:accentText(accent),bg:tokens?.background ?? (dark?"#101A27":"#EDF3F9"),
    card:tokens?.card ?? (dark?"#192738":"#F6FAFD"),text:tokens?.foreground ?? (dark?"#E8F1FA":"#172C3C"),
    muted:tokens?.["muted-foreground"] ?? (dark?"#ACBECD":"#4C6477"),border:tokens?.border ?? (dark?"#6D8BA5":"#B4C9D9"),
    soft:tokens?.muted ?? (dark?"#253C50":"#E2EDF5"),code:dark?"#15171D":"#F0F2F5"};
}
export function appearanceMaterial(a:Appearance,dark:boolean) {
  const p=PRESETS[a.preset],c=appearanceColors(a,dark);
  const glass=a.preset==="glass";
  const shadow=a.preset==="bold" ? `4px 4px 0 ${dark?"#EDF0F4":"#111111"}`
    :a.preset==="notebook" ? `1px 4px 5px rgb(0 0 0 / ${dark?.24:.06})`
    :a.preset==="soft" ? (dark?"8px 8px 18px #080b1488,inset 2px 2px 5px #ffffff15":"8px 8px 18px #a0a0b83b,inset 2px 2px 5px #ffffffcc")
    :"0 18px 48px -16px rgb(10 28 48 / .28),inset 0 1px 0 #ffffff66";
  return {radius:p.radius,controlRadius:p.controlRadius,border:p.border,blur:p.blur,shadow,
    surface:glass?`rgba(${rgb(c.card).join(",")},${dark?.78:.72})`:c.card,
    borderColor:glass?(dark?"#ffffff40":"#ffffffb3"):c.border,opacity:glass?(dark?.78:.72):1};
}
export function toHsl(color:string) {
  const [r,g,b]=rgb(color).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;}
  return `${h.toFixed(2)} ${(s*100).toFixed(2)}% ${(l*100).toFixed(2)}%`;
}
const extensionKeys = ["bg","bg-elevated","bg-section","bg-input","bg-hover","bg-active","border","border-strong","border-input","text","text-strong","text-muted","text-faint","text-ai","text-ai-head","code-bg","code-text","code-inline","code-inline-bg","tool-bg","tool-border","reason-bg","table-border","table-th-bg","chip-bg","chip-key","chip-val","select-opt-bg","gradient-from","gradient-via","gradient-to","grad-from-rgb","grad-via-rgb","grad-to-rgb","halo-1","halo-2","halo-3","send-disabled-bg","shadow","shadow-card","shadow-card-hover"];
const webKeys=["background","foreground","card","card-foreground","popover","popover-foreground","primary","primary-foreground","primary-soft","secondary","secondary-foreground","muted","muted-foreground","accent","accent-foreground","border","input","ring","gradient-from","gradient-via","gradient-to"];
export function applyAppearance(el:HTMLElement, state:AppearanceState, dark:boolean, kind:"extension"|"web"="extension") {
  const a=normalizeAppearance(state.appearance),mode=resolvedMode(state,dark),isDark=mode==="dark";
  el.dataset.xgMode=mode;
  el.dataset.xgPreset=a.preset;
  el.style.colorScheme=mode;
  el.style.setProperty("--xg-font-scale",String(a.fontScale));
  const font=a.font==="default"?PRESETS[a.preset].font:FONT_STACKS[a.font];
  if(font==="inherit")el.style.removeProperty("--xg-font");else el.style.setProperty("--xg-font",font);
  el.style.removeProperty("--xg-accent");el.style.removeProperty("--xg-on-accent");
  const keys=kind==="web"?webKeys:extensionKeys;
  for(const key of keys)el.style.removeProperty("--"+key);
  // A default install retains the host's existing palette and typography.
  for(const key of ["radius","control-radius","border-width","surface","surface-solid","shadow","blur","border-color","surface-opacity"])el.style.removeProperty("--xg-"+key);
  if(a.preset==="default")return;
  const c=appearanceColors(a,isDark),m=appearanceMaterial(a,isDark);
  const material:Record<string,string>={radius:`${m.radius}px`,"control-radius":`${m.controlRadius}px`,"border-width":`${m.border}px`,surface:m.surface,"surface-solid":c.card,shadow:m.shadow,blur:`${m.blur}px`,"border-color":m.borderColor,"surface-opacity":String(m.opacity)};
  for(const [key,value] of Object.entries(material))el.style.setProperty("--xg-"+key,value);
  el.style.setProperty("--xg-accent",c.accent);el.style.setProperty("--xg-on-accent",c.onAccent);
  if(kind==="web") {
    const mapping:Record<string,string>={background:c.bg,foreground:c.text,card:c.card,"card-foreground":c.text,popover:c.card,"popover-foreground":c.text,primary:c.accent,"primary-foreground":c.onAccent,"primary-soft":c.soft,secondary:c.soft,"secondary-foreground":c.text,muted:c.soft,"muted-foreground":c.muted,accent:c.soft,"accent-foreground":c.text,border:c.border,input:c.border,ring:c.accent,"gradient-from":c.accent,"gradient-via":c.accent,"gradient-to":c.accent};
    for(const [key,value] of Object.entries(mapping))el.style.setProperty("--"+key,toHsl(value));
  } else {
    const mapping:Record<string,string>={bg:m.surface,"bg-elevated":m.surface,"bg-section":m.surface,"bg-input":c.soft,"bg-hover":c.soft,"bg-active":c.soft,border:c.border,"border-strong":c.accent,"border-input":c.border,text:c.text,"text-strong":c.text,"text-muted":c.muted,"text-faint":c.muted,"text-ai":c.text,"text-ai-head":c.text,"code-bg":c.code,"code-text":c.text,"code-inline":c.soft,"code-inline-bg":c.soft,"tool-bg":c.card,"tool-border":c.border,"reason-bg":c.card,"table-border":c.border,"table-th-bg":c.soft,"chip-bg":c.soft,"chip-key":c.accent,"chip-val":c.text,"select-opt-bg":c.card,"send-disabled-bg":c.soft,"gradient-from":c.accent,"gradient-via":c.accent,"gradient-to":c.accent,"grad-from-rgb":rgb(c.accent).join(","),"grad-via-rgb":rgb(c.accent).join(","),"grad-to-rgb":rgb(c.accent).join(","),"halo-1":"transparent","halo-2":"transparent","halo-3":"transparent",shadow:m.shadow,"shadow-card":m.shadow,"shadow-card-hover":m.shadow};
    for(const [key,value] of Object.entries(mapping))el.style.setProperty("--"+key,value);
  }
}
