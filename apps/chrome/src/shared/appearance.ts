import {applyAppearance,normalizeState,createAppearanceUsage,mountAppearanceEditor,APPEARANCE_EDITOR_CSS,installAppearanceFont,type AppearanceState} from "@xgoose/ui";
import {track} from "./analytics";
import {translate} from "./locale";
const key="xgoose.settings";
export async function bindDocumentAppearance(entry:string,editorRoot?:HTMLElement) {
  const dark=()=>matchMedia("(prefers-color-scheme: dark)").matches;
  let current=normalizeState((await chrome.storage.local.get(key))[key]);
  const used=createAppearanceUsage(track,entry);
  const apply=(s:AppearanceState)=>{applyAppearance(document.documentElement,s,dark());};
  const sample=()=>used(current,dark(),document.visibilityState==="visible");
  const style=document.createElement("style");style.textContent=APPEARANCE_EDITOR_CSS;document.head.append(style);
  installAppearanceFont(chrome.runtime.getURL("fonts/notebook.ttf"));
  let editor:ReturnType<typeof mountAppearanceEditor>|undefined;
  if(editorRoot){
    editor=mountAppearanceEditor(editorRoot,{initial:current,entry,track,t:translate,apply,save:async state=>{
      const latest=(await chrome.storage.local.get(key))[key]??{};
      await chrome.storage.local.set({[key]:{...latest,...state}});current=state;sample();
    }});
  }
  apply(current);sample();
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=="local"||!changes[key])return;current=normalizeState(changes[key].newValue);if(editor)editor.controller.external(current);else apply(current);sample();});
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{apply(editor?.controller.draft??current);sample();});
  document.addEventListener("visibilitychange",sample);window.addEventListener("focus",sample);
  return editor;
}
