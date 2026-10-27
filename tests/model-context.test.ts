import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../packages/core/src/model.ts';
import {createAgent} from '../packages/core/src/createAgent.ts';
import {estimateTextTokens,requestContextTokens} from '../packages/core/src/contextTokens.ts';
import {modelContextWindow,inputTokenBudget} from '../packages/core/src/contextPolicy.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';
import {costsFor} from '../packages/core/src/pricing.ts';
import {z} from 'zod';
const settings={provider:'openai-compat' as const,model:'luna',baseUrl:'https://fixture.invalid',apiKey:'fixture',thinking:false};
function response(text:string){return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
async function run(model:string,text:string){
 let normal=0,summaries=0;const events:any[]=[];
 const bundle=createAgent({settings:{...settings,model},tools:[],fetchImpl:async(_input,init)=>{
   const request=JSON.parse(String(init?.body));
   if(JSON.stringify(request).includes('Summarize this browser-agent history')){summaries++;return response('Earlier evidence was summarized. Preserve FINAL_GOAL and do not replay actions.');}
   normal++;return response('Completed.');
 }});
 const messages=[{role:'user',content:text}];const original=messages[0].content;
 const result=await bundle.agent.stream({messages});for await(const event of result.fullStream)events.push(event);
 assert.equal(messages[0].content,original);assert.equal(normal,1);assert.ok(!events.some(e=>e.type==='error'));
 return {events,summaries,snapshot:await result.response};
}
test('Hosted and known BYOK windows follow the model, with output headroom',()=>{
 for(const id of ['luna','gpt-6.1-sol'])assert.equal(createModel({...settings,model:id}).contextWindow,1_050_000);
 for(const id of ['claude-haiku-5-5','claude-sonnet-5-5'])assert.equal(modelContextWindow(id),1_000_000);
 assert.equal(modelContextWindow('custom-unknown'),128_000);
 assert.equal(createModel({...settings,model:'future-hosted',contextWindowTokens:2_000_000}).contextWindow,2_000_000);
 assert.ok(inputTokenBudget(1_000_000)<1_000_000-4096);
 assert.equal(modelContextWindow('gpt-6.1-terra'),1_050_000);
 assert.equal(modelContextWindow('deepseek-flash'),1_000_000);
 assert.equal(modelContextWindow('claude-sonnet-4-5'),200_000);
 assert.equal(modelContextWindow('gpt-5-mini'),400_000);
});
test('the completion cap follows what each model accepts',()=>{
 const cap=(model:string)=>createModel({...settings,model}).maxTokens;
 for(const id of ['luna','gpt-6.1-terra','claude-haiku-5-5','claude-sonnet-4-5','gpt-4o-mini','gpt-4.1','o4-mini','gemini-2.5-pro','gemini-3.1-pro'])assert.equal(cap(id),16384,id);
 assert.equal(cap('deepseek-flash'),8192);
 assert.equal(cap('gemini-2.0-flash'),8192);
 for(const id of ['gpt-4','gpt-3.5-turbo','custom-unknown'])assert.equal(cap(id),4096,id);
});
test('Hosted models are priced from the gateway catalogue',()=>{
 for(const id of ['gpt-6.1-sol','gpt-6.1-terra','claude-sonnet-5-5','claude-haiku-5-5','deepseek-flash'])assert.ok(costsFor('xgoose-hosted' as any,id),id);
});
test('an 800K-token prompt uses the large model window without premature compaction',async()=>{
 const text='evidence '.repeat(800000)+'FINAL_GOAL';const tokens=estimateTextTokens(text);
 assert.ok(tokens>790000&&tokens<820000);
 const result=await run('luna',text);assert.equal(result.summaries,0);
 const meter=result.events.find(e=>e.type==='context-usage');assert.equal(meter.contextWindow,1_050_000);assert.ok(meter.tokens>800000);assert.equal(meter.estimated,true);
});
test('the same long input fits Haiku but compacts for a smaller BYOK model',async()=>{
 const text='evidence '.repeat(150000)+'FINAL_GOAL';
 assert.equal((await run('claude-haiku-5-5',text)).summaries,0);
 const small=await run('gpt-4o-mini',text);assert.ok(small.summaries>0);assert.ok(small.events.some(e=>e.type==='context-summary'));
});
test('context estimates include system/tool schemas and images, not base64 length',()=>{
 const model=createModel(settings),base:any[]=[{role:'user',content:'hello',timestamp:0}];
 const plain=requestContextTokens(base,model);
 const image=(data:string)=>requestContextTokens([{role:'user',content:[{type:'text',text:'hello'},{type:'image',mimeType:'image/jpeg',data}],timestamp:0}] as any,model);
 assert.equal(image('tiny'),image('A'.repeat(300000)));assert.ok(image('tiny')>=plain+8000);
 const tools=requestContextTokens([{role:'system',content:'System instructions',toolsAdded:[{name:'read',description:'Read a source',parameters:{type:'object',properties:{q:{type:'string'}}}}],timestamp:0},...base] as any,model);
 assert.ok(tools>plain);
});
test('large-window compaction uses bounded large batches instead of dozens of legacy 60KB calls',async()=>{
 const sizes:number[]=[];const events:any[]=[];
 const bundle=createAgent({settings,tools:[],contextBudgetChars:100,fetchImpl:async(_input,init)=>{
   const body=String(init?.body);
   if(body.includes('Summarize this browser-agent history')){sizes.push(Buffer.byteLength(body));return response('Preserved FINAL_GOAL, sources and completed actions.');}
   return response('Continued.');
 }});
 const result=await bundle.agent.stream({messages:[{role:'user',content:'Research earlier evidence'},{role:'assistant',content:[{type:'text',text:'evidence '.repeat(180000)}]},{role:'user',content:'Continue FINAL_GOAL'}]});
 for await(const event of result.fullStream)events.push(event);
 assert.equal(sizes.length,2);assert.ok(sizes.some(size=>size>1_000_000));assert.ok(sizes.every(size=>size<1_220_000));assert.ok(!events.some(e=>e.type==='error'));
});

for (const explicitCap of [undefined, 175000]) test(`successful gateway policy replaces a legacy cap; explicit host cap=${explicitCap}`, async () => {
 let normal=0,summaries=0,reads=0;
 const events:any[]=[];
 const bundle=createAgent({settings,requestBudgetBytes:explicitCap,tools:[defineTool({
   name:'read_list',description:'Read independent source data',inputSchema:z.object({}),
   execute:()=>({page:++reads,text:'evidence '.repeat(15000)}),
 })],fetchImpl:async(_input,init)=>{
   const body=JSON.parse(String(init?.body));
   if(JSON.stringify(body).includes('Summarize this browser-agent history')){summaries++;return response('Two list pages were read. Preserve both results and answer with partial coverage.');}
   normal++;
   const tool=normal<=2;
   const delta=tool?{role:'assistant',tool_calls:[{index:0,id:`list-${normal}`,type:'function',function:{name:'read_list',arguments:'{}'}}]}:{role:'assistant',content:'Useful available findings.'};
   return new Response(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{
     'content-type':'text/event-stream',
     'x-xgoose-context-window-tokens':'1050000',
     'x-xgoose-context-target-tokens':String(inputTokenBudget(1050000)),
     'x-xgoose-context-target-bytes':normal===1?'180000':'7980000',
   }});
 }});
 const run=await bundle.agent.stream({messages:[{role:'user',content:'Use both accessible list pages and answer from available information.'}]});
 for await(const event of run.fullStream)events.push(event);
 assert.equal(normal,3);assert.equal(reads,2);
 assert.equal(summaries>0,explicitCap!==undefined);
 const compact=events.find(event=>event.type==='context-compacting');
 if(explicitCap!==undefined){assert.equal(compact.reason,'byte_limit');assert.equal(compact.requestBudgetBytes,explicitCap);assert.equal(compact.contextWindowTokens,1050000);}
 else assert.equal(compact,undefined,'The old 180KB policy must not latch into subsequent successful requests');
 assert.equal((await run.response).messages.filter(message=>message.role==='tool').length,2);
});
