import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createAgent} from '../packages/core/src/createAgent.ts';
import {buildSystemReminder} from '../packages/core/src/systemPrompt.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';
import {requestTextBytes,textBytes,textChunks} from '../packages/core/src/contextWindow.ts';
import {createModel} from '../packages/core/src/model.ts';
const settings={provider:'openai-compat' as const,model:'luna',baseUrl:'https://fixture.invalid/ai',apiKey:'fixture',thinking:false};
const model=createModel(settings);
function sse(content:string,toolCall?:any){return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',...(toolCall?{tool_calls:[{index:0,...toolCall}]}:{content})},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:toolCall?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
function transport(onNormal?:(request:any)=>Response){
 const requests:any[]=[];let summaries=0;
 const fetchImpl:typeof fetch=async(_input,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request);
  const text=JSON.stringify(request,(_key,value)=>value?.type==='image_url'?{type:'text',text:'[attached image]'}:value);
  assert.ok(textBytes(text)<190000,`Request crossed gateway limit: ${textBytes(text)}`);
  const summary=request.messages.some((m:any)=>JSON.stringify(m.content).includes('Summarize this browser-agent history'));
  if(summary){summaries++;return sse('The user is researching a current forum question. Completed lookup already ran; never replay mutations. Source https://fixture.test/t/19 remains relevant. Incomplete evidence must be checked. Preserve FINAL_CONSTRAINT.');}
  return onNormal?.(request)??sse('Continued after automatic compaction.');
 };
 return {fetchImpl,requests,get summaries(){return summaries;}};
}
async function drain(bundle:ReturnType<typeof createAgent>,messages:any[],signal?:AbortSignal){
 const result=await bundle.agent.stream({messages,abortSignal:signal});const events:any[]=[];for await(const event of result.fullStream)events.push(event);return {events,response:await result.response,usage:await result.usage};
}
test('UTF-8 and the full wire request count, even below the old character threshold',()=>{
 const messages:any[]=[{role:'system',content:'system '.repeat(1000),timestamp:0},{role:'user',content:[{type:'text',text:'中'.repeat(60000)}],timestamp:0}];
 assert.ok(JSON.stringify(messages).length<160000);assert.ok(requestTextBytes(messages,model)>190000);
 const chunks=textChunks('你🙂\\"'.repeat(25000),60000);assert.ok(chunks.every(x=>textBytes(x)<=60000));assert.equal(chunks.join(''),'你🙂\\"'.repeat(25000));
});
test('a single oversized Chinese tool result compacts with bounded summary requests and no tool replay',async()=>{
 const t=transport();let executed=0;const body='中文回复'.repeat(25000)+' FINAL_CONSTRAINT https://fixture.test/t/19';
 const messages=[{role:'user',content:'Research this topic.'},{role:'assistant',content:[{type:'tool-call',toolCallId:'done-1',toolName:'lookup',input:{}}]},{role:'tool',content:[{type:'tool-result',toolCallId:'done-1',toolName:'lookup',output:{type:'json',value:{body}}}]},{role:'user',content:'Continue; keep FINAL_CONSTRAINT.'}];
 const saved=JSON.stringify(messages);
 const bundle=createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl:t.fetchImpl,tools:[defineTool({name:'lookup',description:'lookup',inputSchema:z.object({}),execute:()=>{executed++;return null;}})]});
 const result=await drain(bundle,messages);
 assert.ok(t.summaries>=3);assert.equal(executed,0);assert.ok(result.events.some(e=>e.type==='context-compacting'));assert.ok(result.events.some(e=>e.type==='context-summary'&&e.afterBytes<175000));
 assert.equal(JSON.stringify(messages),saved);assert.ok(JSON.stringify(result.response.modelContext).includes('FINAL_CONSTRAINT'));
 assert.ok(!JSON.stringify(result.response.modelContext).includes('中文回复'.repeat(50)));
 assert.ok(JSON.stringify(t.requests.at(-1).messages.at(-1).content).includes('Continue; keep FINAL_CONSTRAINT.'));
});
test('compaction during a real tool loop keeps complete transcript output and executes the action once',async()=>{
 let normal=0,executed=0;const large={body:'论坛证据'.repeat(25000),source:'https://fixture.test/t/19'};
 const t=transport(()=>++normal===1?sse('',{id:'real-action',type:'function',function:{name:'lookup',arguments:'{}'}}):sse('Finished using the saved evidence.'));
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl:t.fetchImpl,tools:[defineTool({name:'lookup',description:'Read fixture',inputSchema:z.object({}),execute:()=>{executed++;return large;}})]}),[{role:'user',content:'Research the current topic.'}]);
 assert.equal(executed,1);assert.equal(normal,2);assert.ok(t.summaries>0);
 assert.deepEqual(result.response.messages.find((m:any)=>m.role==='tool')?.content[0].output.value,large);
 assert.ok(result.events.filter(e=>e.type==='tool-call').length===1);assert.ok(result.usage.inputTokens>200);
});
test('an oversized first user message compacts without requiring assistant history',async()=>{
 const t=transport();const message='Read this supplied material carefully: '+'研究资料'.repeat(24000)+' FINAL_CONSTRAINT';
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl:t.fetchImpl,tools:[]}),[{role:'user',content:message}]);
 assert.ok(t.summaries>0);assert.ok(result.events.some(e=>e.type==='context-summary'));
 assert.ok(JSON.stringify(result.response.modelContext).includes('Current request condensed automatically'));
 assert.ok(JSON.stringify(result.response.modelContext).includes('FINAL_CONSTRAINT'));
});
test('recent image attachments survive compaction and base64 is never summarized as text',async()=>{
 const marker='UNIQUE_PRIVATE_IMAGE_BYTES';const t=transport();
 const history:any[]=[{role:'user',content:[{type:'text',text:'Prior image question'},...Array.from({length:3},()=>({type:'image',mimeType:'image/jpeg',data:marker}))]},{role:'assistant',content:[{type:'text',text:'中文'.repeat(100000)}]},{role:'user',content:'Keep using the attached image.'}];
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl:t.fetchImpl,tools:[]}),history);
 const final=t.requests.at(-1);assert.equal(final.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image_url').length,3);
 for(const req of t.requests.slice(0,-1))assert.ok(!JSON.stringify(req).includes(marker));
 assert.ok(JSON.stringify(result.response.modelContext).includes(marker));
});
test('summary failure produces explicit incomplete excerpts and still continues below the limit',async()=>{
 let count=0;const fetchImpl:typeof fetch=async(_input,init)=>{
  const body=JSON.parse(String(init?.body));assert.ok(textBytes(JSON.stringify(body))<190000);
  if(JSON.stringify(body).includes('Summarize this browser-agent history')){count++;return Response.json({error:{message:'Temporary summary failure'}},{status:503});}
  assert.ok(JSON.stringify(body).includes('incomplete history excerpts'));return sse('Continuing with explicit gaps.');
 };
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl,tools:[]}),[{role:'user',content:'Previous request'},{role:'assistant',content:[{type:'text',text:'历史'.repeat(100000)}]},{role:'user',content:'Continue safely.'}]);
 assert.equal(count,1);assert.ok(result.events.some(e=>e.type==='context-summary'));assert.ok(!result.events.some(e=>e.type==='error'));
});
test('large active skill schemas switch to a bounded help index with authored guidance',()=>{
 const reminder=buildSystemReminder({pageUrl:'https://fixture.test',activeSkills:[{name:'fixture',namespace:'fixture',instructions:'Check returned floors. Never replay completed actions.',functions:Array.from({length:30},(_,i)=>({name:'read'+i,signature:`read${i}(args)`,summary:'Read bounded data',input:{description:'模式'.repeat(5000)},output:{description:'结果'.repeat(5000)}}))}],todos:[]});
 assert.ok(textBytes(reminder!)<=48000);assert.ok(reminder?.includes('help({skill, function})'));assert.ok(reminder?.includes('Check returned floors'));assert.ok(!reminder?.includes('模式'.repeat(100)));
});
test('the gateway is authoritative: a pre-response context rejection compacts and retries once',async()=>{
 let normal=0,summaries=0;
 const fetchImpl:typeof fetch=async(_input,init)=>{
  const body=JSON.parse(String(init?.body)),text=JSON.stringify(body);
  if(text.includes('Summarize this browser-agent history')){summaries++;return sse('Earlier completed research, source https://fixture.test/t/19. Do not replay actions.');}
  normal++;
  if(normal===1)return Response.json({error:{code:'context_length_exceeded',type:'context_length_exceeded',message:'Text context exceeds the gateway limit; compact and retry.',context:{unit:'utf8_bytes',actual_text_bytes:181000,max_text_bytes:180000}}},{status:400,headers:{'x-xgoose-context-target-bytes':'100000'}});
  assert.ok(textBytes(text)<100000);return sse('Resumed automatically after gateway compaction.');
 };
 const input=[{role:'user',content:'Earlier question'},{role:'assistant',content:[{type:'text',text:'Evidence: https://fixture.test/t/19'}]},{role:'user',content:'Continue.'}];
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl,tools:[]}),input);
 assert.equal(normal,2);assert.equal(summaries,1);assert.ok(!result.events.some(e=>e.type==='error'));
 assert.ok(result.events.some(e=>e.type==='context-summary'));assert.ok(JSON.stringify(result.response.modelContext).includes('Resumed automatically'));
});
test('a repeated context rejection stops after one retry and unrelated errors never trigger compaction',async()=>{
 for(const contextFailure of [true,false]){
  let normal=0;
  const fetchImpl:typeof fetch=async(_input,init)=>{
   const body=JSON.stringify(JSON.parse(String(init?.body)));
   if(body.includes('Summarize this browser-agent history'))return sse('Preserved earlier goal and completed actions.');
   normal++;return Response.json({error:{code:contextFailure?'context_length_exceeded':'too_many_requests',message:contextFailure?'Model context limit exceeded':'Rate limit reached'}},{status:contextFailure?400:429});
  };
  const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl,tools:[]}),[{role:'user',content:'Question'}]);
  assert.equal(normal,contextFailure?2:1);assert.equal(result.events.filter(e=>e.type==='error').length,1);
 }
});
test('many tiny messages compact before the gateway message-count limit',async()=>{
 const t=transport();const messages=Array.from({length:420},(_,i)=>i%2?{role:'assistant',content:[{type:'text',text:'ok'}]}:{role:'user',content:'small question'});
 messages.push({role:'user',content:'Continue after the long exchange.'} as any);
 const result=await drain(createAgent({settings,requestBudgetBytes:175000,maxContextMessages:400,fetchImpl:t.fetchImpl,tools:[]}),messages);
 assert.ok(t.summaries>0);assert.ok(result.events.some(e=>e.type==='context-summary'));
 assert.ok(t.requests.at(-1).messages.length<10);
});
