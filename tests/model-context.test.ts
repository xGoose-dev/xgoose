import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../packages/core/src/model.ts';
import {createAgent} from '../packages/core/src/createAgent.ts';
import {estimateTextTokens,requestContextTokens} from '../packages/core/src/contextTokens.ts';
import {modelContextWindow,inputTokenBudget} from '../packages/core/src/contextPolicy.ts';
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
 assert.equal(modelContextWindow('gpt-4o-mini'),128_000);assert.equal(modelContextWindow('gemini-2.5-pro'),1_048_576);
 assert.equal(modelContextWindow('gpt-4.1'),1_047_576);assert.equal(modelContextWindow('custom-unknown'),128_000);
 assert.ok(inputTokenBudget(1_000_000)<1_000_000-4096);
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
