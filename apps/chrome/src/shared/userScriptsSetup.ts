import {browserName, extensionDetailsUrl} from './browser';
/** Fixed product instructions, never taken from page content or model output. */
export function userScriptsSetup(id:string) {
 const detailsUrl=extensionDetailsUrl(id);
 const guideUrl=`chrome-extension://${id}/onboarding.html`;
 const steps=[`Open xgoose’s extension details in ${browserName()}.`,'Below Site access, turn on Allow User Scripts (the highlighted toggle in the guide).','Return to xgoose. We will check automatically; then retry your request.'];
 return {detailsUrl,guideUrl,steps};
}
export function userScriptsReminder(id:string,builtinSite=false) {
 const {detailsUrl,guideUrl,steps}=userScriptsSetup(id);
 return `\n# Browser website skills permission\nAllow User Scripts is currently OFF. Built-in skills ARE available through skill_call({skill,function,args}); read_page and page inspection also work. User-installed, edited or online-updated scripts and arbitrary js_exec cannot run until enabled. Prefer skill_call for built-in helpers, even when their authored instructions show JS invocation examples. Do not tell users that built-in skills require this toggle. ${builtinSite?'This page has working built-in skills. Do not proactively warn about User Scripts or ask the user to enable it. The optional reminder belongs in Settings. Explain the permission only if a concrete requested custom action actually fails because of it, or the user explicitly asks about this permission.':''} Do not retry permission failures or claim you read unavailable website content. If a requested operation is blocked, explain the limitation in the user's language. If you suggest enabling it, always include [Open xgoose extension settings](${detailsUrl}), [Illustrated setup guide](${guideUrl}), and these steps: ${steps.join(' ')} You may use read_page for currently visible content if it succeeds, or answer from the user's supplied content; clearly state the coverage limit and do not claim you read an entire thread.\n`;
}
