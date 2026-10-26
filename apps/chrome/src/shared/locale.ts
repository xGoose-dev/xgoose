import zh from './locales/zh-CN.json';
import es from './locales/es.json';
export const LANGUAGE_CHOICES=['auto','en','zh-CN','es'] as const;
export type LanguagePreference=typeof LANGUAGE_CHOICES[number];
export type Locale=Exclude<LanguagePreference,'auto'>;
const dictionaries:Record<Locale,Record<string,string>>={en:{'最近羊毛':'Recent deals'},'zh-CN':zh,es};
export function resolveLocale(preference:string='auto',languages:readonly string[]=[]):Locale {
  if(preference==='en'||preference==='zh-CN'||preference==='es')return preference;
  for(const language of languages){
    const base=language.toLowerCase().split(/[-_]/)[0];
    if(base==='zh')return 'zh-CN';
    if(base==='en'||base==='es')return base;
  }
  return 'en';
}
const browserLanguages=()=>typeof navigator==='undefined'?[]:navigator.languages?.length?navigator.languages:[navigator.language];
let preference:LanguagePreference='auto';
export const getLocale=()=>resolveLocale(preference,browserLanguages());
export function languageReminder(value:LanguagePreference, languages:readonly string[]=browserLanguages()) {
  // Automatic is intentionally silent. Browser/UI locale is not an answer preference.
  if(value==='auto')return '';
  const locale=resolveLocale(value,languages),name={en:'English','zh-CN':'Simplified Chinese',es:'Spanish'}[locale];
  return `\n# Preferred response language\nPreferred language: ${name} (${locale}). Use this language for your answers by default, even when the current website or the user's message is in another language. If the user explicitly requests a different response language, follow that request. Preserve original quotes, source titles, proper names, URLs and code accurately.\n`;
}
const normal=(text:string)=>text.replace(/\s+/g,' ').trim();
export function translate(text:string,locale:Locale=getLocale()):string {
  const key=normal(text),value=dictionaries[locale][key];
  if(value!==undefined)return text.match(/^\s*/)?.[0]+value+(text.match(/\s*$/)?.[0]??'');
  // Bounded product-owned status strings; captured names and data stay unchanged.
  const patterns:[RegExp,string,string][]=[
    [/^\((\d+), (\d+)\); panel (.+)px anchored (.+)\.$/,'（$1，$2）；面板 $3 像素，停靠于 $4。','($1, $2); panel de $3 px anclado en $4.'],
    [/^(.+@.+) · Connected$/,'$1 · 已连接','$1 · Conectado'],
    [/^(\d+) queued:$/,'$1 条待发送：','$1 en cola:'],
    [/^Thinking · (\d+) chars$/,'思考中 · $1 字符','Pensando · $1 caracteres'],
    [/^Context (\d+%)$/,'上下文 $1','Contexto $1'],
    [/^(\d+) steps?$/,'$1 步','$1 pasos'],
    [/^(\d+) skill updates? available(.*)$/,'有 $1 个 skill 更新$2','Hay $1 actualizaciones de skills$2'],
    [/^Update (.+)$/,'更新 $1','Actualizar $1'],
    [/^Updating (.+)…$/,'正在更新 $1…','Actualizando $1…'],
    [/^Last checked (.+)\.$/,'上次检查：$1。','Última comprobación: $1.'],
    [/^Hosted models: (\d+) available · routed through your xgoose account\.$/,'托管模型：$1 个可用，通过你的 xgoose 账号连接。','Modelos alojados: $1 disponibles con tu cuenta de xgoose.'],
    [/^Email sent to (.+)\. Click the confirmation link and this extension will sign in automatically\. The link expires in (\d+) minutes\. You can close this settings page\.$/,'邮件已发送至 $1。点击确认链接后，插件会自动登录。链接将在 $2 分钟后过期；你可以关闭此设置页。','Correo enviado a $1. Haz clic en el enlace de confirmación para iniciar sesión automáticamente. Caduca en $2 minutos. Puedes cerrar esta página.'],
    [/^Sign out of (.+)\?$/,'要退出 $1 吗？','¿Cerrar la sesión de $1?'],
    [/^Remove (.+)$/,'移除 $1','Quitar $1'],
    [/^Read (.+) source · (\d+) chars$/,'已读取 $1 源码 · $2 字符','Código de $1 leído · $2 caracteres'],
  ];
  if(locale==='en')return text;
  for(const [pattern,chinese,spanish] of patterns)if(pattern.test(key))return key.replace(pattern,locale==='zh-CN'?chinese:spanish);
  return text;
}

// Translate only extension-owned UI roots. Never observe the host website.
const roots=new Set<HTMLElement|ShadowRoot>();
const originals=new WeakMap<Text,{source:string;rendered:string}>();
const attrs=new WeakMap<Element,Map<string,{source:string;rendered:string}>>();
const protectedSelector='script,style,pre,code,textarea,[contenteditable], [data-no-i18n],.msg-user,.msg-ai,.msg-err,.reason-body,.tool-body,.history-item-title,.todo-text,.qtext,.skill-chip,.skill-name,.skill-description,.skill-desc,.skill-ns,.skill-matches,.account-state .name:has(.avatar),.avatar,#previewBody,#fileLabel';
function protectedNode(element:Element|null):boolean {
  if(!element)return false;
  if(element.closest(protectedSelector))return true;
  const message=element.closest('.msgs');
  return !!message&&!element.closest('.thinking,.reason-label,.user-scripts-guide,.empty-state');
}
let originalTitle="",renderedTitle="";
function render(root:HTMLElement|ShadowRoot) {
  const locale=getLocale();
  if(root instanceof ShadowRoot)(root.host as HTMLElement).lang=locale;
  else {
    document.documentElement.lang=locale;
    const source=document.title===renderedTitle?originalTitle:document.title;
    originalTitle=source;renderedTitle=translate(source,locale);document.title=renderedTitle;
  }
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>protectedNode(node.parentElement)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let node=walk.nextNode() as Text|null;node;node=walk.nextNode() as Text|null){
    const old=originals.get(node),source=old&&node.data===old.rendered?old.source:node.data;
    const rendered=translate(source,locale);originals.set(node,{source,rendered});
    if(node.data!==rendered)node.data=rendered;
  }
  for(const element of root.querySelectorAll('[title],[aria-label],[placeholder],[alt]')){
    // Text inputs are excluded above, but the chat composer placeholder is UI.
    if(protectedNode(element)&&!element.matches('.in-text'))continue;
    let map=attrs.get(element);if(!map){map=new Map();attrs.set(element,map);}
    for(const name of ['title','aria-label','placeholder','alt']){
      const value=element.getAttribute(name);if(value===null)continue;
      const old=map.get(name),source=old&&value===old.rendered?old.source:value;
      const rendered=translate(source,locale);map.set(name,{source,rendered});
      if(value!==rendered)element.setAttribute(name,rendered);
    }
  }
}
export function localizeRoot(root:HTMLElement|ShadowRoot) {
  if(roots.has(root))return;
  roots.add(root);render(root);
  let queued=false;
  new MutationObserver(mutations=>{
    if(queued||mutations.every(m=>protectedNode(m.target instanceof Element?m.target:m.target.parentElement)&&!Array.from(m.addedNodes).some(n=>n instanceof Element&&(n.matches('.thinking,.reason-label,.user-scripts-guide,.empty-state')||n.querySelector('.thinking,.reason-label,.user-scripts-guide,.empty-state')))))return;
    queued=true;queueMicrotask(()=>{queued=false;render(root);});
  }).observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','alt']});
}
let ready:Promise<void>|undefined;
export function initializeLocale(root?:HTMLElement|ShadowRoot):Promise<void> {
  ready??=(async()=>{
    const read=(value:any)=>{preference=LANGUAGE_CHOICES.includes(value?.language)?value.language:'auto';for(const root of roots)render(root);};
    read((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']);
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['xgoose.settings'])read(changes['xgoose.settings'].newValue);});
    window.addEventListener('languagechange',()=>{for(const root of roots)render(root);});
  })();
  return ready.then(()=>{if(root)localizeRoot(root);});
}
export async function saveLanguage(value:LanguagePreference) {
  const raw=(await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']??{};
  await chrome.storage.local.set({'xgoose.settings':{...raw,language:value}});
}

/** Onboarding can set both preferences together; Settings keeps them independent. */
export async function mountAnswerLanguage(select:HTMLSelectElement,status?:HTMLElement|null,options:{syncInterface?:boolean}={}) {
  const key='xgoose.settings';
  const read=(raw:any)=>{select.value=LANGUAGE_CHOICES.includes(raw?.answerLanguage)?raw.answerLanguage:'auto';};
  read((await chrome.storage.local.get(key))[key]);
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[key])read(changes[key].newValue);});
  select.addEventListener('change',async()=>{
    const value=select.value as LanguagePreference;select.disabled=true;
    try{
      const raw=(await chrome.storage.local.get(key))[key]??{};
      await chrome.storage.local.set({[key]:{...raw,answerLanguage:value,...(options.syncInterface?{language:value}:{})}});
      if(status)status.textContent='Saved automatically.';
    }catch{if(status)status.textContent='Language could not be saved. Please try again.';read((await chrome.storage.local.get(key))[key]);}
    finally{select.disabled=false;}
  });
}
