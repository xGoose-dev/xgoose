import {APPEARANCE_STYLE_CSS} from "./appearanceStyles";
import {PRESETS,FONTS,applyAppearance,normalizeState,type AppearanceState} from "./appearance";
import {AppearanceController,type AppearanceTrack} from "./appearanceController";
export const APPEARANCE_EDITOR_CSS=APPEARANCE_STYLE_CSS+`
.xg-appearance{display:grid;gap:24px;min-width:0;container:appearance-editor / inline-size;font-family:var(--xg-font,inherit);color:inherit;line-height:1.5}
.xg-appearance,.xg-appearance *{box-sizing:border-box}
.xg-appearance fieldset{padding:0;margin:0;border:0;min-width:0}
.xg-appearance legend{width:100%;font-weight:600;margin-bottom:10px;padding:0;font-size:1em}
.xg-preset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.xg-preset-choice{display:grid;align-content:start;gap:8px;min-width:0;background:transparent;color:inherit;border:2px solid transparent!important;border-radius:12px!important;padding:5px!important;min-height:44px;cursor:pointer;font:inherit;text-align:left}
.xg-preset-choice[aria-pressed=true]{border-color:var(--xg-accent,#7352e4)!important}
.xg-preset-label{font-weight:600;padding:0 2px;overflow-wrap:anywhere}
.xg-sample{display:flex;flex-direction:column;gap:8px;width:100%;height:88px;padding:9px!important;font-family:var(--xg-font,system-ui);overflow:hidden;pointer-events:none}
.xg-sample-title{font-size:12px;font-weight:700;line-height:1.1}.xg-sample-line{height:3px;width:70%;background:currentColor;opacity:.2;flex:none}.xg-sample-bubble{height:14px;width:64%;align-self:end;background:var(--xg-accent,#7352e4);border-radius:var(--xg-control-radius,5px);border:1px solid var(--xg-border-color,transparent);flex:none}.xg-sample-input{height:13px;width:100%;border:1px solid currentColor;opacity:.3;border-radius:var(--xg-control-radius,5px);flex:none}
.xg-sample[data-xg-preset=default]{background:#f6f4fc;color:#252233;border:1px solid #d9d5e8;border-radius:12px;box-shadow:0 4px 12px #20104012}
.xg-appearance label{display:grid;gap:8px;font-weight:600;min-width:0}
.xg-appearance select,.xg-appearance input[type=text]{width:100%;min-width:0;min-height:44px;margin:0;padding:10px 12px;border-radius:var(--xg-control-radius,8px);border:1px solid var(--border-input,#9296a0);font:inherit;font-weight:400;background-color:var(--bg-input,transparent);color:inherit}
.xg-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.xg-appearance button:not(.xg-preset-choice){min-height:44px;border:var(--xg-border-width,1px) solid var(--border-input,#9296a0);border-radius:var(--xg-control-radius,8px);padding:8px 12px;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere}
.xg-appearance :is(button,input,select):focus-visible{outline:2px solid var(--xg-accent,#7352e4);outline-offset:3px}
.xg-size-heading output{float:right;font-weight:400;color:var(--text-muted,inherit);font-variant-numeric:tabular-nums}
.xg-size-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.xg-size-presets button[aria-pressed=true]{border-color:var(--xg-accent,#7352e4);box-shadow:inset 0 0 0 1px var(--xg-accent,#7352e4);background:var(--bg-input,transparent)}
.xg-preview{display:grid;gap:16px;padding:18px;border:1px solid var(--border-input,#9296a0);border-radius:var(--xg-radius,12px);overflow-wrap:anywhere;background:var(--bg-input,transparent)}
.xg-preview-copy{display:grid;align-content:center;gap:10px;min-width:0}.xg-preview p{margin:0;line-height:1.6}.xg-preview code{font-family:ui-monospace,monospace;font-size:.85em}.xg-preview-controls{display:grid;align-content:center;gap:10px;min-width:0}
.xg-preview button{justify-self:start;background:var(--xg-accent,#7352e4)!important;color:var(--xg-on-accent,#fff)!important;border:0!important;cursor:default!important}
.xg-editor-footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border-input,#9296a0);padding-top:16px}
.xg-appearance .xg-editor-footer [data-action=reset]{border-color:transparent;padding-inline:0;font-size:.875em;text-align:left}
.xg-save-status{margin-inline-start:auto;font-size:.875em;color:var(--text-muted,inherit)}.xg-save-status:empty{display:none}.xg-retry[hidden]{display:none}
@container appearance-editor (min-width:400px){.xg-controls{grid-template-columns:repeat(2,minmax(0,1fr))}.xg-size-presets{grid-template-columns:repeat(4,minmax(0,1fr))}}
@container appearance-editor (min-width:520px){.xg-preset-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.xg-preview{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}}
`;
export function mountAppearanceEditor(root:HTMLElement,options:{initial:AppearanceState;save:(state:AppearanceState)=>Promise<void>;apply:(state:AppearanceState)=>void;track:AppearanceTrack;entry:string;t?:(value:string)=>string}) {
  const t=options.t??((s:string)=>s),dark=()=>matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.add("xg-appearance");
  // The template is static; user supplied values are assigned through DOM properties.
  root.innerHTML=`<fieldset><legend></legend><div class="xg-preset-grid"></div></fieldset><div class="xg-controls"><label data-label="Color mode"><select data-field="theme"></select></label><label data-label="Font"><select data-field="font"></select></label></div><fieldset><legend class="xg-size-heading"><span data-size-legend></span><output></output></legend><div class="xg-size-presets"></div></fieldset><div class="xg-preview" role="group" aria-label="Preview"><div class="xg-preview-copy"><p>阅读，思考，再出发。<br>Read, think, and keep exploring.</p><p><code>const idea = "xgoose";</code></p></div><div class="xg-preview-controls"><input type="text" placeholder="Your next question · 你的下一个问题" readonly aria-label="Preview input"><button type="button" disabled></button></div></div><div class="xg-editor-footer"><button type="button" data-action="reset"></button><span class="xg-save-status" role="status" aria-live="polite"></span><button type="button" class="xg-retry" hidden></button></div>`;
  root.querySelector("legend")!.textContent=t("Interface style");
  root.querySelector(".xg-preview")!.setAttribute("aria-label",t("Preview"));
  root.querySelector("[data-size-legend]")!.textContent=t("Font size");
  for(const label of root.querySelectorAll<HTMLElement>("[data-label]"))label.prepend(t(label.dataset.label!));
  const select=(key:string)=>root.querySelector<HTMLSelectElement>(`[data-field=${key}]`)!;

  for(const [value,label] of [["system","Follow system"],["light","Light"],["dark","Dark"]])select("theme").add(new Option(t(label),value));
  for(const [value,label] of Object.entries(FONTS))select("font").add(new Option(t(label),value));
  const retry=root.querySelector<HTMLButtonElement>(".xg-retry")!;
  const render=(state:AppearanceState,status:string)=>{
    const a=state.appearance;select("theme").value=state.theme;select("font").value=a.font;
    for(const sample of root.querySelectorAll<HTMLElement>(".xg-sample")) {
      applyAppearance(sample,{theme:state.theme,appearance:{preset:sample.dataset.xgPreset as AppearanceState["appearance"]["preset"],font:"default",fontScale:1}},dark());
      if(sample.dataset.xgPreset==="default"){sample.style.setProperty("--xg-accent","#7352E4");sample.style.setProperty("--xg-control-radius","5px");sample.style.setProperty("--xg-font","system-ui,sans-serif");}
    }
    root.querySelector("output")!.textContent=`${Math.round(a.fontScale*100)}%`;
    root.querySelector(".xg-save-status")!.textContent=t(status);retry.hidden=status!=="Could not save. Try again.";
    for(const b of root.querySelectorAll<HTMLElement>("[data-preset]"))b.setAttribute("aria-pressed",String(b.dataset.preset===a.preset));
    for(const b of root.querySelectorAll<HTMLElement>("[data-scale]"))b.setAttribute("aria-pressed",String(Number(b.dataset.scale)===a.fontScale));
  };
  const controller=new AppearanceController({...options,dark,changed:render});
  for(const [id,preset] of Object.entries(PRESETS)){
    const b=document.createElement("button");b.type="button";b.dataset.preset=id;b.className="xg-preset-choice";b.title=t(preset.description);
    const sample=document.createElement("span");sample.className="xg-sample";sample.dataset.xgPreset=id;sample.setAttribute("aria-hidden","true");
    sample.innerHTML='<span class="xg-sample-title">xgoose</span><span class="xg-sample-line"></span><span class="xg-sample-bubble"></span><span class="xg-sample-input"></span>';
    const label=document.createElement("span");label.className="xg-preset-label";label.textContent=t(preset.label);b.append(sample,label);
    b.onclick=()=>controller.change({...controller.draft,appearance:{...controller.draft.appearance,preset:id as keyof typeof PRESETS}});root.querySelector(".xg-preset-grid")!.append(b);
  }
  for(const [scale,label] of [[.9,"Small"],[1,"Standard"],[1.15,"Large"],[1.3,"Extra large"]] as const){const b=document.createElement("button");b.type="button";b.dataset.scale=String(scale);b.textContent=t(label);b.onclick=()=>controller.change({...controller.draft,appearance:{...controller.draft.appearance,fontScale:scale}});root.querySelector(".xg-size-presets")!.append(b);}
  select("theme").onchange=()=>controller.change({...controller.draft,theme:select("theme").value as AppearanceState["theme"]});
  select("font").onchange=()=>controller.change({...controller.draft,appearance:{...controller.draft.appearance,font:select("font").value as AppearanceState["appearance"]["font"]}});
  const reset=root.querySelector<HTMLButtonElement>('[data-action=reset]')!;reset.textContent=t("Restore appearance defaults");reset.onclick=()=>{void controller.reset();};
  retry.textContent=t("Try again");retry.onclick=()=>{void controller.retry();};root.querySelector(".xg-preview button")!.textContent=t("Preview");
  render(normalizeState(options.initial),"");
  const close=()=>{void controller.flush();};window.addEventListener("pagehide",close);const visibility=()=>{if(document.visibilityState==="hidden")close();};document.addEventListener("visibilitychange",visibility);
  return {controller,dispose(){close();window.removeEventListener("pagehide",close);document.removeEventListener("visibilitychange",visibility);}};
}
