import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createAgent, fromPiMessages, toPiMessages} from '../packages/core/src/createAgent.ts';
import {createModel, normalizeProviderBaseUrl} from '../packages/core/src/model.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';

const settings={provider:'gemini' as const,model:'gemini-2.5-flash',apiKey:'fixture-key',baseUrl:'https://fixture.invalid',thinking:false};
const tool=defineTool({name:'lookup',description:'Read fixture evidence',inputSchema:z.object({query:z.string()}),execute:({query})=>({evidence:`verified ${query}`})});
const googleFrame=(parts:any[])=>new Response(`data: ${JSON.stringify({candidates:[{content:{role:'model',parts},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,totalTokenCount:13}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
const openaiFrame=(delta:any,finish:string)=>new Response(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:3}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
async function drain(bundle:ReturnType<typeof createAgent>,messages:any[],signal?:AbortSignal){
 const run=await bundle.agent.stream({messages,abortSignal:signal});const events:any[]=[];
 for await(const event of run.fullStream)events.push(event);
 return {events,response:await run.response};
}

test('provider base URLs agree for native, LiteLLM and OpenAI-compatible versions',()=>{
 for(const [provider,input,expected] of [
  ['gemini','','https://generativelanguage.googleapis.com/v1beta'],
  ['gemini-litellm',' https://proxy.test/ ','https://proxy.test/v1beta'],
  ['gemini-litellm','https://proxy.test/v1beta/','https://proxy.test/v1beta'],
  ['openai-compat','','https://api.openai.com/v1'],
  ['openai-compat','https://proxy.test/ai','https://proxy.test/ai/v1'],
  ['openai-compat','https://proxy.test/v1/','https://proxy.test/v1'],
  ['openai-compat','https://proxy.test/v1/chat/completions','https://proxy.test/v1'],
  ['openai-compat','https://generativelanguage.googleapis.com/v1beta/openai/','https://generativelanguage.googleapis.com/v1beta/openai'],
 ] as const)assert.equal(normalizeProviderBaseUrl(provider,input),expected);
});

for(const provider of ['gemini','gemini-litellm'] as const)test(`${provider}: custom background fetch streams tools and image input without global fetch`,async()=>{
 const requests:any[]=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const req=new Request(input,init),body=await req.json();requests.push(body);
  assert.equal(req.url,'https://fixture.invalid/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
  assert.equal(req.headers.get('x-goog-api-key'),'fixture-key');
  assert.ok(req.signal);assert.equal(body.config,undefined);assert.equal(body.httpOptions,undefined);
  if(requests.length===1){
   assert.ok(body.contents.some((m:any)=>m.parts.some((p:any)=>p.inlineData?.mimeType==='image/png')));
   assert.ok(body.tools[0].functionDeclarations.some((f:any)=>f.name==='lookup'));
   return googleFrame([{functionCall:{name:'lookup',args:{query:'current post'}},thoughtSignature:'c2lnbmF0dXJl'}]);
  }
  assert.match(JSON.stringify(body.contents),/verified current post/);
  assert.ok(body.contents.some((m:any)=>m.parts.some((p:any)=>p.thoughtSignature==='c2lnbmF0dXJl')));
  return googleFrame([{text:'Evidence verified.'}]);
 };
 const {events}=await drain(createAgent({settings:{...settings,provider},fetchImpl,tools:[tool]}),[{role:'user',content:[{type:'text',text:'Look up this post.'},{type:'image',data:'aW1hZ2U=',mimeType:'image/png'}]}]);
 assert.deepEqual(events.filter(e=>e.type==='error'),[]);assert.equal(requests.length,2);assert.ok(events.some(e=>e.type==='text-delta'&&e.text==='Evidence verified.'));
 assert.ok(events.some(e=>e.type==='tool-result'));assert.deepEqual(events.filter(e=>e.type==='error'),[]);
});

test('OpenAI format: fragmented tool arguments, tool response IDs, images and streamed completion',async()=>{
 const requests:any[]=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const req=new Request(input,init),body=await req.json();requests.push(body);
  assert.equal(req.url,'https://fixture.invalid/v1/chat/completions');assert.equal(req.headers.get('authorization'),'Bearer fixture-key');
  assert.equal(body.stream,true);assert.equal(body.store,undefined);
  if(requests.length===1){
   assert.equal(body.tools[0].type,'function');assert.equal(body.tools[0].function.name,'lookup');
   assert.ok(body.messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.image_url?.url==='data:image/png;base64,aW1hZ2U=')));
   const response=await openaiFrame({tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'lookup',arguments:'{"query":'}}]},'tool_calls').text();
   return new Response(response.replace('data: {"choices":[{"index":0,"delta":{},',`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'"current post"}'}}]},finish_reason:null}]})}\n\ndata: {"choices":[{"index":0,"delta":{},`),{headers:{'content-type':'text/event-stream'}});
  }
  const call=body.messages.find((m:any)=>m.tool_calls)?.tool_calls[0];
  assert.equal(call.id,'call-1');assert.equal(call.function.arguments,'{"query":"current post"}');
  const result=body.messages.find((m:any)=>m.role==='tool');assert.equal(result.tool_call_id,'call-1');assert.match(JSON.stringify(result.content),/verified current post/);
  return openaiFrame({content:'OpenAI format verified.'},'stop');
 };
 const {events}=await drain(createAgent({settings:{...settings,provider:'openai-compat'},fetchImpl,tools:[tool]}),[{role:'user',content:[{type:'text',text:'Read it.'},{type:'image',data:'aW1hZ2U=',mimeType:'image/png'}]}]);
 assert.equal(requests.length,2);assert.ok(events.some(e=>e.text==='OpenAI format verified.'));assert.deepEqual(events.filter(e=>e.type==='error'),[]);
});

for (const [model, thinking] of [['gpt-6-luna',false], ['gpt-6-luna',true], ['gpt-6-sol',true], ['gpt-6.1-terra',true], ['gpt-5-mini',true], ['o3',true], ['o4-mini',true]] as const) {
 test(`OpenAI BYOK ${model} (thinking=${thinking}): modern completion limit survives tools and follow-up`, async () => {
  const requests:any[]=[];
  let toolCalls=0;
  const lookup=defineTool({name:'lookup',description:'Read fixture evidence',inputSchema:z.object({}),execute:()=>{toolCalls++;return {evidence:'LUNA_BYOK_EVIDENCE'};}});
  const fetchImpl:typeof fetch=async (input,init)=>{
   const req=new Request(input,init),body=await req.json();requests.push(body);
   assert.equal(req.url,'https://api.openai.com/v1/chat/completions');
   assert.equal(req.headers.get('authorization'),'Bearer fixture-key');
   assert.equal(body.max_tokens,undefined);
   assert.equal(body.max_completion_tokens,16384);
   assert.equal(body.store,undefined);
   if(model==='gpt-6-luna')assert.equal(body.reasoning_effort,'none');
   if(requests.length===1)return openaiFrame({tool_calls:[{index:0,id:'luna-call',type:'function',function:{name:'lookup',arguments:'{}'}}]},'tool_calls');
   assert.match(JSON.stringify(body.messages),/LUNA_BYOK_EVIDENCE/);
   return openaiFrame({content:'Luna BYOK works.'},'stop');
  };
  const bundle=createAgent({settings:{...settings,provider:'openai-compat',model,baseUrl:'',thinking},fetchImpl,tools:[lookup]});
  const first=await drain(bundle,[{role:'user',content:'Read this thread.'}]);
  assert.deepEqual(first.events.filter(e=>e.type==='error'),[]);
  const followUp=await drain(bundle,[...bundle.agent.snapshot().messages,{role:'user',content:'Continue.'}]);
  assert.deepEqual(followUp.events.filter(e=>e.type==='error'),[]);
  assert.equal(toolCalls,1);
  assert.equal(requests.length,3);
 });
}

test('modern OpenAI BYOK compaction uses max_completion_tokens too',async()=>{
 let summaries=0;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const body=await new Request(input,init).json();
  const summary=JSON.stringify(body).includes('Summarize this browser-agent history');
  assert.equal(body.max_tokens,undefined);
  assert.equal(body.max_completion_tokens,summary?2048:16384);
  if(summary)summaries++;
  return openaiFrame({content:summary?'Earlier page read completed.':'Continued.'},'stop');
 };
 const {events}=await drain(createAgent({settings:{...settings,provider:'openai-compat',model:'gpt-6-luna',baseUrl:''},fetchImpl,tools:[],contextBudgetChars:1000}),[{role:'user',content:'Earlier question'},{role:'assistant',content:'History '.repeat(500)},{role:'user',content:'Continue'}]);
 assert.ok(summaries>0);
 assert.ok(events.some(e=>e.type==='context-summary'));
 assert.deepEqual(events.filter(e=>e.type==='error'),[]);
});

test('Hosted catalogue models and legacy compatible APIs keep their existing request format',async()=>{
 const hosted=['luna','claude-haiku-5-5','claude-sonnet-5-5','gpt-6.1-sol','deepseek-flash','deepseek-purge','gpt-6.1-terra'];
 for(const [model,baseUrl] of [...hosted.map(model=>[model,'https://api.xgoose.org/ai']),['gpt-4o-mini',''],['custom-model','https://proxy.test/v1'],['gemini-2.5-flash','https://generativelanguage.googleapis.com/v1beta/openai']] as [string,string][]){
  const requests:any[]=[];
  const {events}=await drain(createAgent({settings:{...settings,provider:'openai-compat',model,baseUrl},tools:[],fetchImpl:async(input,init)=>{
   const body=await new Request(input,init).json();requests.push(body);
   assert.ok(body.max_tokens>0,`${model}: missing legacy token limit`);
   assert.equal(body.max_completion_tokens,undefined);
   assert.equal(body.reasoning_effort,undefined);
   return openaiFrame({content:'Unchanged.'},'stop');
  }}),[{role:'user',content:'Hello'}]);
  assert.deepEqual(events.filter(e=>e.type==='error'),[]);
  assert.equal(requests.length,1);
 }
 const compatible=createModel({...settings,provider:'openai-compat',model:'gpt-6-luna',baseUrl:'https://proxy.test/v1'});
 assert.equal(compatible.compat?.maxTokensField,'max_completion_tokens');
});

test('Gemini compaction uses the same background transport',async()=>{
 let summaries=0;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const req=new Request(input,init),body=await req.json();
  const summary=JSON.stringify(body).includes('Summarize this browser-agent history');if(summary)summaries++;
  return googleFrame([{text:summary?'Earlier read finished. Never repeat it.':'Continued.'}]);
 };
 const {events}=await drain(createAgent({settings,fetchImpl,tools:[],contextBudgetChars:1000}),[{role:'user',content:'Earlier question'},{role:'assistant',content:'History '.repeat(500)},{role:'user',content:'Continue'}]);
 assert.ok(summaries>0);assert.ok(events.some(e=>e.type==='context-summary'));assert.deepEqual(events.filter(e=>e.type==='error'),[]);
});

test('saved Gemini tool and thinking signatures survive the next user turn',()=>{
 const model=createModel(settings);
 const original:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:0,usage:{},stopReason:'toolUse',content:[
  {type:'thinking',thinking:'Read the fixture',thinkingSignature:'dGhpbmtpbmc='},
  {type:'toolCall',id:'call-1',name:'lookup',arguments:{query:'fixture'},thoughtSignature:'c2lnbmF0dXJl'},
 ]};
 const saved=fromPiMessages([original],true),restored=toPiMessages(saved,model) as any[];
 assert.deepEqual(restored[0].content,original.content);
 assert.equal(toPiMessages(saved,createModel({...settings,model:'another-model'}))[0].model,model.id);
});

test('Gemini HTTP errors surface and abort reaches the active custom transport',async()=>{
 const failed=await drain(createAgent({settings,tools:[],fetchImpl:async()=>Response.json({error:{code:400,message:'Fixture invalid request',status:'INVALID_ARGUMENT'}},{status:400})}),[{role:'user',content:'Hello'}]);
 assert.ok(failed.events.some(e=>e.type==='error'&&String(e.error).includes('Fixture invalid request')));
 let started!:()=>void;const ready=new Promise<void>(r=>started=r);let aborted=false;
 const ac=new AbortController();
 const running=drain(createAgent({settings,tools:[],fetchImpl:async(_input,init)=>new Promise((_resolve,reject)=>{
  init!.signal!.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});started();
 })}),[{role:'user',content:'Hello'}],ac.signal);
 await ready;ac.abort();await running;assert.equal(aborted,true);
});
