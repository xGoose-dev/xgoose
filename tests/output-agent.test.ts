import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createAgent} from '../packages/core/src/createAgent.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';
import {createReadToolOutputTool} from '../packages/core/src/tools/readToolOutput.ts';
function response(content:string,call?:any){return new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',...(call?{tool_calls:[{index:0,...call}]}:{content})},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
const toolText=(request:any)=>{const value=request.messages.filter((m:any)=>m.role==='tool').at(-1)?.content;return typeof value==='string'?value:value?.map((p:any)=>p.text??'').join('');};
for(const continueReading of [false,true])test(`agent chooses whether to continue oversized output; continue=${continueReading}`,async()=>{
 let originalCalls=0,pageCalls=0,requests=0;const original={body:'Original evidence '.repeat(40000)+'FINAL_DETAIL'};
 const reader=createReadToolOutputTool(),read=reader.definition.execute;
 reader.definition.execute=(input,opts)=>{pageCalls++;return read(input,opts);};
 const bundle=createAgent({settings:{provider:'openai-compat',model:'luna',baseUrl:'https://fixture.invalid',apiKey:'fixture',thinking:false},tools:[
  defineTool({name:'read_fixture',description:'Read fixture',inputSchema:z.object({}),execute:()=>{originalCalls++;return original;}}),reader,
 ],fetchImpl:async(_input,init)=>{
  const request=JSON.parse(String(init?.body));requests++;
  if(requests===1)return response('',{id:'source',type:'function',function:{name:'read_fixture',arguments:'{}'}});
  const page=JSON.parse(toolText(request));
  if(requests===2){
   assert.ok(page.outputId);assert.ok(page.nextOffset>0);assert.ok(!page.text.includes('FINAL_DETAIL'));
   if(continueReading)return response('',{id:'continuation',type:'function',function:{name:'read_tool_output',arguments:JSON.stringify({outputId:page.outputId,nextOffset:page.nextOffset,maxChars:1000000})}});
  }else{assert.equal(page.nextOffset,null);assert.ok(page.text.includes('FINAL_DETAIL'));}
  return response('The agent selected its own aggregation.');
 }});
 const run=await bundle.agent.stream({messages:[{role:'user',content:'Read and aggregate the useful evidence.'}]});
 const events:any[]=[];for await(const event of run.fullStream)events.push(event);
 assert.ok(!events.some(e=>e.type==='error'),JSON.stringify(events.filter(e=>e.type==='error')));
 assert.equal(originalCalls,1);assert.equal(pageCalls,continueReading?1:0);assert.equal(requests,continueReading?3:2);
 const saved=(await run.response).messages.find((m:any)=>m.role==='tool');
 assert.deepEqual(saved?.content[0].output.value,original);
});
