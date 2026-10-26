import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemPrompt} from '../packages/core/src/systemPrompt.ts';
import {build} from 'esbuild';

test('Safari prompt only describes supported tools while Chrome retains dynamic execution',()=>{
 const safari=buildSystemPrompt(null,{dynamicJavaScript:false,customSkills:false});
 assert.doesNotMatch(safari,/js_exec|edit_skill/);assert.match(safari,/skill_call/);
 assert.match(buildSystemPrompt(),/js_exec/);
});
test('Safari capability bundle removes dynamic tools and defaults analytics off',async()=>{
 const result=await build({stdin:{contents:'import {hostCapabilities} from "./apps/chrome/src/shared/host"; export {hostCapabilities};',resolveDir:process.cwd(),sourcefile:'capabilities.ts'},bundle:true,write:false,format:'iife',globalName:'SafariHost',define:{__XGOOSE_PLATFORM__:'"safari"'}});
 const vm=await import('node:vm');const context=vm.createContext({});vm.runInContext(result.outputFiles![0].text,context);
 assert.equal(context.SafariHost.hostCapabilities.dynamicJavaScript,false);assert.equal(context.SafariHost.hostCapabilities.customSkills,false);assert.equal(context.SafariHost.hostCapabilities.remoteSkillUpdates,false);
});
test('Safari document handshake is available before bootstrap and remains stable on reinjection',async()=>{
 const result=await build({entryPoints:['apps/chrome/src/shared/messages.ts'],bundle:true,write:false,format:'iife',globalName:'Messages',tsconfig:'apps/chrome/tsconfig.json',define:{__XGOOSE_PLATFORM__:'"safari"'}});
 const vm=await import('node:vm');const listeners:any[]=[];
 const context=vm.createContext({document:{documentElement:{dataset:{}}},location:{protocol:'https:'},crypto:{randomUUID:()=>String(Math.random())},chrome:{runtime:{onMessage:{addListener:(fn:any)=>listeners.push(fn)}}}});
 vm.runInContext(result.outputFiles![0].text,context);
 const first=context.Messages.documentNonce;assert.equal(listeners.length,1);
 let reply:any;listeners[0]({kind:'cs:document_nonce'},{},(value:any)=>reply=value);assert.equal(reply,first);
 vm.runInContext(result.outputFiles![0].text,context);assert.equal(context.Messages.documentNonce,first);assert.equal(listeners.length,1);
});
test('public reader transport is bounded to the active website’s public APIs',async()=>{
 const {publicReadAllowed}=await import('../apps/safari/src/publicReader.ts');
 assert.equal(publicReadAllowed('https://news.ycombinator.com/','https://hacker-news.firebaseio.com/v0/topstories.json'),true);
 assert.equal(publicReadAllowed('https://news.ycombinator.com/','https://hn.algolia.com/api/v1/search?query=web'),true);
 for(const target of ['http://hacker-news.firebaseio.com/v0/topstories.json','https://evil.test/','https://hn.algolia.com/admin','https://hn.algolia.com:8443/api/v1/search','https://user@hn.algolia.com/api/v1/search','https://127.0.0.1/api/v1/search'])assert.equal(publicReadAllowed('https://news.ycombinator.com/',target),false,target);
 assert.equal(publicReadAllowed('https://evil.test/','https://hn.algolia.com/api/v1/search'),false);
});
test('Safari provider transport removes SDK diagnostics without dropping authentication',async()=>{
 const result=await build({stdin:{contents:'import {providerHeaders} from "./apps/chrome/src/shared/host"; export {providerHeaders};',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Host',define:{__XGOOSE_PLATFORM__:'"safari"'}});
 const vm=await import('node:vm');const context=vm.createContext({});vm.runInContext(result.outputFiles![0].text,context);
 const headers=context.Host.providerHeaders({'authorization':'Bearer synthetic','content-type':'application/json','X-Stainless-Lang':'js','user-agent':'diagnostic','x-goog-api-key':'synthetic'});
 assert.equal(headers.authorization,'Bearer synthetic');assert.equal(headers['x-goog-api-key'],'synthetic');assert.equal(headers['X-Stainless-Lang'],undefined);assert.equal(headers['user-agent'],undefined);
});
test('Safari background account lookup uses the native vault without messaging itself',async()=>{
 const result=await build({entryPoints:['apps/chrome/src/shared/account.ts'],bundle:true,write:false,format:'iife',globalName:'Account',tsconfig:'apps/chrome/tsconfig.json',define:{__XGOOSE_PLATFORM__:'"safari"'}});
 const vm=await import('node:vm');let sent=0;
 const context=vm.createContext({location:{protocol:'safari-web-extension:'},chrome:{runtime:{sendMessage:async()=>{sent++;return {user:{id:'synthetic'}};}}}});
 // The Chrome native adapter intentionally throws. Reaching it proves the
 // background avoided a recursive RPC; the Safari build supplies the vault adapter.
 vm.runInContext(result.outputFiles![0].text,context);
 await assert.rejects(context.Account.getAccount(),/Native services are unavailable/);assert.equal(sent,0);
 context.location.protocol='https:';assert.equal((await context.Account.getAccount()).user.id,'synthetic');assert.equal(sent,1);
});
