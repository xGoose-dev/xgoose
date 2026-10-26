/** Build-time platform capabilities. Never infer execution permission from a user agent. */
declare const __XGOOSE_PLATFORM__: string | undefined;
export const isSafari = typeof __XGOOSE_PLATFORM__ !== "undefined" && __XGOOSE_PLATFORM__ === "safari";
export const hostCapabilities = Object.freeze({platform:isSafari ? "safari" : "chrome", packagedSkills:true, dynamicJavaScript:!isSafari, customSkills:!isSafari, remoteSkillUpdates:!isSafari});
export const safariExecutionReminder = "\n# Safari capabilities\nUse read_page for page content and skill_call({skill,function,args}) for packaged website skills. Translate JavaScript examples into structured skill_call arguments. JavaScript execution, script editing, community installation and remote skill updates are unavailable. Never suggest enabling Chrome User Scripts. Read-only page tools and installed packaged skills remain available. The preferred response language in settings takes precedence over language suggestions in website skills and shortcut prompts.\n";

/** SDK diagnostic headers trigger unnecessary CORS preflights in Safari. */
export function providerHeaders(headers:Record<string,string>):Record<string,string>{
 return isSafari ? Object.fromEntries(Object.entries(headers).filter(([key])=>!/^x-stainless-|^user-agent$|^x-client-request-id$|^x-session-id$|^session_id$/i.test(key))) : headers;
}
