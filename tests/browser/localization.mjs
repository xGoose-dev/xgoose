import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const requests=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/chat/completions'){
  let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
  await new Promise(resolve=>setTimeout(resolve,800));
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'Send'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
 }
 res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><title>Source Settings</title><h1>Settings</h1><main>Send</main></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const dist=resolve('apps/chrome/dist'),profile=await mkdtemp(resolve(tmpdir(),'xgoose-locale-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale:'es-MX',viewport:{width:1280,height:900},colorScheme:'light',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(20000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture-kept'},baseUrls:{'openai-compat':base},model:'luna',analyticsEnabled:false,launcherVisibility:'always'}}),base);
 await settings.reload();
 await settings.locator('#language').waitFor();await settings.waitForFunction(()=>document.documentElement.lang==='es');
 assert.equal(await settings.locator('#language').inputValue(),'auto');assert.equal(await settings.locator('#connection-heading').innerText(),'Conexión');assert.equal(await settings.locator('#saveBtn').innerText(),'Guardar');
 await settings.locator('#answerLanguage').selectOption('zh-CN');await settings.locator('#language').selectOption('zh-CN');await settings.waitForFunction(()=>document.documentElement.lang==='zh-CN');assert.equal(await settings.locator('#connection-heading').innerText(),'连接');assert.equal(await settings.locator('#language option[value="auto"]').innerText(),'跟随浏览器语言');
 const page=await context.newPage();await page.goto(base);await page.locator('.toggle').click();await page.locator('.btn-send').filter({hasText:'发送'}).waitFor();assert.equal(await page.locator('.empty-state h3').innerText(),'有什么想问的？');
 assert.equal(await page.locator('h1').innerText(),'Settings');assert.equal(await page.locator('main').innerText(),'Send');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('title').innerText(),'Source Settings');
 assert.equal(await page.locator('.btn-close').getAttribute('aria-label'),'最小化');assert.equal(await page.locator('.btn-close path').getAttribute('d'),'M5 12h14');
 await page.locator('.in-text').fill('Settings');await page.locator('.btn-close').click();assert.equal(await page.locator('.panel').evaluate(e=>e.classList.contains('open')),false);
 await page.locator('.toggle').click();assert.equal(await page.locator('.in-text').inputValue(),'Settings');await page.locator('.btn-send').click();await page.locator('.btn-stop').waitFor({state:'visible'});await page.locator('.btn-close').click();
 await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.querySelector('.msg-ai')?.textContent?.trim()==='Send');assert.equal(await page.locator('.panel').evaluate(e=>e.classList.contains('open')),false);await page.locator('.toggle').click();
 assert.equal(await page.locator('.msg-user').innerText(),'Settings');assert.equal(await page.locator('.msg-ai').innerText(),'Send');assert.equal(requests.length,1);assert.match(JSON.stringify(requests[0].messages),/Preferred language: Simplified Chinese \(zh-CN\)/);
 await mkdir('artifacts/localization',{recursive:true});await page.locator('.panel').screenshot({path:'artifacts/localization/chat-zh.png'});
 await settings.locator('#language').selectOption('en');await page.locator('.btn-send').filter({hasText:'Send'}).waitFor();assert.equal(await page.locator('.msg-user').innerText(),'Settings');assert.equal(await page.locator('.msg-ai').innerText(),'Send');
 await settings.locator('#saveBtn').click();await settings.reload();await settings.locator('#language').waitFor();assert.equal(await settings.locator('#language').inputValue(),'en');assert.equal(await settings.locator('#apiKey').inputValue(),'fixture-kept');
 assert.equal(await settings.locator('#answerLanguage').inputValue(),'zh-CN');await settings.locator('#answerLanguage').selectOption('auto');await settings.locator('#language').selectOption('auto');await page.locator('.btn-send').filter({hasText:'Enviar'}).waitFor();await page.locator('.in-text').fill('请概括这个页面。');await page.locator('.btn-send').click();await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.querySelectorAll('.msg-ai').length===2);await page.locator('.btn-stop').waitFor({state:'hidden'});
 assert.equal(requests.length,2);assert.doesNotMatch(JSON.stringify(requests[1].messages),/Preferred response language|Preferred language:/);assert.match(JSON.stringify(requests[1].messages),/请概括这个页面/);
 await page.locator('.panel').screenshot({path:'artifacts/localization/chat-es.png'});await settings.locator('#section-personalization').screenshot({path:'artifacts/localization/settings-es.png'});
 const onboarding=await context.newPage();await onboarding.goto(`chrome-extension://${id}/onboarding.html`);await onboarding.waitForFunction(()=>document.documentElement.lang==='es');assert.equal(await onboarding.locator('#answerLanguage').inputValue(),'auto');
 // One onboarding selection updates both stored preferences and translates this page without reload.
 await onboarding.locator('#answerLanguage').selectOption('zh-CN');await onboarding.waitForFunction(()=>document.documentElement.lang==='zh-CN');
 assert.equal(await onboarding.locator('label[for="answerLanguage"]').innerText(),'语言');assert.equal(await onboarding.locator('h1').innerText(),'欢迎使用 xgoose');assert.equal(await onboarding.locator('#checkPermission').innerText(),'重新检查');
 await settings.waitForFunction(()=>document.querySelector('#language').value==='zh-CN'&&document.querySelector('#answerLanguage').value==='zh-CN');
 assert.match(await onboarding.locator('.answer-language-row .hint').first().innerText(),/之后可在设置中分别调整/);
 await onboarding.screenshot({path:'artifacts/localization/onboarding-zh.png',fullPage:true});
 const prefs=await onboarding.evaluate(async()=>(await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']);assert.equal(prefs.language,'zh-CN');assert.equal(prefs.answerLanguage,'zh-CN');assert.equal(prefs.apiKeys['openai-compat'],'fixture-kept');
 // Settings can still change either preference independently; merely opening onboarding does not overwrite them.
 await settings.locator('#language').selectOption('en');await onboarding.waitForFunction(()=>document.documentElement.lang==='en');assert.equal(await settings.locator('#answerLanguage').inputValue(),'zh-CN');
 await settings.locator('#answerLanguage').selectOption('es');await onboarding.waitForFunction(()=>document.querySelector('#answerLanguage').value==='es');assert.equal(await settings.locator('#language').inputValue(),'en');
 await onboarding.reload();await onboarding.waitForFunction(()=>document.documentElement.lang==='en'&&document.querySelector('#answerLanguage').value==='es');assert.equal(await settings.locator('#language').inputValue(),'en');
 await onboarding.locator('#answerLanguage').selectOption('auto');await settings.waitForFunction(()=>document.querySelector('#language').value==='auto'&&document.querySelector('#answerLanguage').value==='auto');await onboarding.waitForFunction(()=>document.documentElement.lang==='es');
 assert.match(await onboarding.locator('h1').innerText(),/bienvenida/);assert.equal(await onboarding.locator('#checkPermission').innerText(),'Volver a comprobar');
 await page.locator('.btn-send').filter({hasText:'Enviar'}).waitFor();await page.locator('.in-text').fill('Continue in the conversation language.');await page.locator('.btn-send').click();await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.querySelectorAll('.msg-ai').length===3);await page.locator('.btn-stop').waitFor({state:'hidden'});assert.equal(requests.length,3);assert.doesNotMatch(JSON.stringify(requests[2].messages),/Preferred response language|Preferred language:/);
 const install=await context.newPage();await install.goto(`chrome-extension://${id}/install.html`);await install.waitForFunction(()=>document.documentElement.lang==='es');assert.equal(await install.locator('#installBtn').innerText(),'Instalar');await install.locator('#sourceInput').fill('// Settings Send: user-owned source');
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.waitForFunction(()=>document.documentElement.lang==='es');assert.equal(await popup.locator('[data-action="options"]').innerText(),'Configuración');
 await settings.locator('#language').selectOption('zh-CN');await popup.waitForFunction(()=>document.documentElement.lang==='zh-CN');await install.waitForFunction(()=>document.documentElement.lang==='zh-CN');await onboarding.waitForFunction(()=>document.documentElement.lang==='zh-CN');assert.equal(await install.locator('#sourceInput').inputValue(),'// Settings Send: user-owned source');
 await settings.locator('#section-personalization').screenshot({path:'artifacts/localization/settings-zh-desktop.png'});await settings.emulateMedia({colorScheme:'dark'});await settings.locator('#launcherVisibility').focus();assert.match(await settings.locator('#launcherVisibility').evaluate(el=>getComputedStyle(el).backgroundRepeat),/^no-repeat(?:, no-repeat)?$/);assert.equal(await settings.locator('#launcherVisibility').evaluate(el=>getComputedStyle(el).backgroundSize),'6px 6px, 6px 6px');await settings.locator('#section-personalization').screenshot({path:'artifacts/localization/settings-zh-dark.png'});await settings.emulateMedia({colorScheme:'light'});
 await settings.setViewportSize({width:390,height:844});await settings.locator('#section-personalization').scrollIntoViewIfNeeded();assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await settings.screenshot({path:'artifacts/localization/settings-zh-mobile.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.btn-close').getAttribute('aria-label'),'最小化');await page.locator('.panel').screenshot({path:'artifacts/localization/chat-zh-mobile.png'});
 console.log(JSON.stringify({passed:true,autoSpanishRegion:true,manualChinese:true,explicitEnglish:true,autoRestored:true,preferencePersists:true,providerKeyPreserved:true,liveCrossTabChange:true,onboarding:true,onboardingSharedLanguage:true,onboardingImmediateTranslation:true,settingsLanguagesIndependent:true,installer:true,popup:true,preferredAiLanguage:true,explicitUserRequestPriority:true,websiteUntouched:true,userAndAiTextUntouched:true,sourceUntouched:true,minimizeGlyph:true,draftPreserved:true,minimizeDuringGeneration:true,conversationPreserved:true,mobile:true,syntheticOnly:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
for(const [locale,expected,label] of [['en-US','en','Save'],['zh-TW','zh-CN','保存'],['fr-FR','en','Save']]){
 const profile=await mkdtemp(resolve(tmpdir(),'xgoose-locale-fallback-'));
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
 try{const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2],page=await context.newPage();await page.goto(`chrome-extension://${id}/options.html`);await page.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',model:'luna',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},analyticsEnabled:false,launcherVisibility:'always'}}),base);await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(expected=>document.documentElement.lang===expected,expected);assert.equal(await page.locator('#saveBtn').innerText(),label);const before=requests.length;const chat=await context.newPage();await chat.goto(base);await chat.locator('.toggle').click();await chat.locator('.in-text').fill('请用当前对话语言回答。');await chat.locator('.btn-send').click();await chat.locator('.msg-ai').waitFor();await chat.locator('.btn-stop').waitFor({state:'hidden'});assert.equal(requests.length,before+1);assert.doesNotMatch(JSON.stringify(requests.at(-1).messages),/Preferred response language|Preferred language:/);console.log(JSON.stringify({browser:locale,resolved:expected,noAutomaticAnswerContext:true,passed:true}));}finally{await context.close();await rm(profile,{recursive:true,force:true});}
}

server.close();
