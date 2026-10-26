import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-email-'));
const dist=resolve('apps/chrome/dist');
const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:800},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
let context=await launch();
try{
 let sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const installMock=async(worker,confirmed=false)=>worker.evaluate(confirmed=>{
  const original=globalThis.fetch;globalThis.emailFixture={confirmed,requests:0,polls:0,failRequest:!confirmed,failPoll:confirmed};
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input.url;if(!url.startsWith('https://api.xgoose.org'))return original(input,init);
   const state=globalThis.emailFixture;let data={};
   if(url.endsWith('/auth/extension/request')){state.requests++;if(state.failRequest){state.failRequest=false;throw new TypeError('Synthetic offline');}data={poll_token:'synthetic-poll-secret',expires_in:600,interval:5};}
   else if(url.endsWith('/auth/extension/poll')){state.polls++;if(state.failPoll){state.failPoll=false;throw new TypeError('Synthetic offline');}data=state.confirmed?{status:'ok',access_token:'synthetic-access',refresh_token:'synthetic-refresh',access_token_expires_at:'2100-01-01T00:00:00Z'}:{status:'pending'};}
   else if(url.endsWith('/me'))data={user:{id:'fixture',email:'new@example.test',name:'New user',avatar_url:null,email_verified:true,is_admin:false}};
   else if(url.endsWith('/me/transcript-consent')){await new Promise(resolve=>{globalThis.releaseConsent=resolve;});data={hosted:false,byok:false};}
   else if(url.endsWith('/ai/v1/models'))data={data:[{id:'luna'}]};
   else if(url.includes('/skills/catalog'))data={version:1,items:[]};
   return Response.json(data);
  };
 },confirmed);
 await installMock(sw);
 const options=await context.newPage();await options.goto(`chrome-extension://${sw.url().split('/')[2]}/onboarding.html`);
 await options.locator('#loginEmail').waitFor();
 await mkdir(resolve('artifacts'),{recursive:true});await options.screenshot({path:resolve('artifacts/email-login-ui.png'),animations:'disabled'});
 const before=context.pages().length;
 await options.locator('#loginEmail').fill('new@example.test');await options.getByRole('button',{name:'Send sign-in email',exact:true}).click();
 await options.getByText('Could not send the email request.',{exact:false}).waitFor();
 await options.getByRole('button',{name:'Send sign-in email',exact:true}).click();
 await options.getByText('Email sent to new@example.test.',{exact:false}).waitFor();assert.equal(context.pages().length,before);
 await options.getByRole('button',{name:'Change email or request another link',exact:true}).click();
 await options.locator('#loginEmail').fill('replacement@example.test');
 await options.getByRole('button',{name:'Send sign-in email',exact:true}).click();
 await options.getByText('Email sent to replacement@example.test.',{exact:false}).waitFor();
 const pending=await options.evaluate(()=>chrome.storage.local.get('xgoose.pending-email-login'));assert.equal(pending['xgoose.pending-email-login'].email,'replacement@example.test');
 // A browser/service-worker restart must recover the pending request without another email.
 assert.equal(await sw.evaluate(()=>globalThis.emailFixture.requests),3);
 await context.close();context=await launch();sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');await installMock(sw,true);
 const reopened=await context.newPage();await reopened.goto(`chrome-extension://${sw.url().split('/')[2]}/options.html`);
 await reopened.locator('#accountState').filter({hasText:'Connected'}).waitFor({timeout:20000});assert.equal(context.pages().length,before);
 // Saving local preferences cannot wait on a slow consent network request.
 await reopened.waitForFunction(()=>document.querySelector('#saveBtn')?.disabled===false);
 await reopened.locator('#connectionMode').selectOption('hosted');
 await reopened.locator('#saveBtn').click();await reopened.locator('#saveStatus').filter({hasText:'Saved'}).waitFor();
 assert.equal(await reopened.evaluate(async()=>(await chrome.storage.local.get('xgoose.settings'))['xgoose.settings'].provider),'xgoose-hosted');
 await sw.evaluate(()=>globalThis.releaseConsent?.());
 assert.equal(await sw.evaluate(()=>globalThis.emailFixture.requests),0);
 assert.equal((await reopened.evaluate(()=>chrome.storage.local.get('xgoose.pending-email-login')))['xgoose.pending-email-login'],undefined);
 console.log(JSON.stringify({emailLoginUi:true,changeEmail:true,transientNetworkRecovery:true,registrationRedirects:0,approvalRedirects:0,restartPending:true,syntheticEmail:true,settingsIndependentOfNetwork:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
