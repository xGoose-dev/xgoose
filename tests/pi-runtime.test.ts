import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAgent } from "../packages/core/src/createAgent.ts";
import { defineTool } from "../packages/core/src/tools/buildTool.ts";
const settings={provider:"openai-compat" as const,model:"luna",baseUrl:"https://example.test/ai",apiKey:"synthetic",thinking:false};
function answer(content:any[],reason:"stop"|"toolUse"="stop"):AssistantMessage {return {role:"assistant",content,api:"openai-completions",provider:"xgoose",model:"luna",timestamp:Date.now(),stopReason:reason,usage:{input:10,output:5,cacheRead:2,cacheWrite:0,totalTokens:17,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};}
function stream(message:AssistantMessage){const s=new AssistantMessageEventStream();s.push({type:"start",partial:message});s.push({type:"done",reason:message.stopReason as "stop",message});return s;}
test("PI executes a real tool loop and exposes stable host events/history",async()=>{
  let calls=0, requests=0;
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[defineTool({name:"lookup",description:"Read fixture",inputSchema:z.object({q:z.string()}),execute:async({q})=>{calls++;return {q,result:"fixture"};}})],streamFn:(_m,ctx)=>{
    requests++;
    if(requests===1){assert.equal(ctx.messages.at(-1)?.role,"user");return stream(answer([{type:"toolCall",id:"t1",name:"lookup",arguments:{q:"delay"}}],"toolUse"));}
    assert.equal(ctx.messages.at(-1)?.role,"toolResult");return stream(answer([{type:"text",text:"Grounded answer"}]));
  }});
  const result=await bundle.agent.stream({messages:[{role:"user",content:"Question"}]});
  const events=[];for await(const e of result.fullStream)events.push(e);
  assert.equal(requests,2);assert.equal(calls,1);
  assert.deepEqual(events.filter(e=>e.type.startsWith("tool-")).map(e=>e.type),["tool-call","tool-result"]);
  const messages=(await result.response).messages;
  assert.deepEqual(messages.map(m=>m.role),["assistant","tool","assistant"]);
  assert.equal(messages.at(-1)?.content[0].text,"Grounded answer");
  assert.equal((await result.usage).inputTokens,24);
});
test("maxSteps caps an otherwise unbounded tool loop",async()=>{
  let calls=0;
  const bundle=createAgent({settings,fetchImpl:fetch,maxSteps:2,tools:[defineTool({name:"loop",description:"loop",inputSchema:z.object({}),execute:()=>++calls})],streamFn:()=>stream(answer([{type:"toolCall",id:`t${calls}`,name:"loop",arguments:{}}],"toolUse"))});
  const result=await bundle.agent.stream({messages:[{role:"user",content:"loop"}]});
  for await(const _ of result.fullStream){}
  assert.equal(calls,2);
});
test("pre-aborted turns cannot call the provider",async()=>{
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[],streamFn:()=>{throw new Error("must not run");}});
  await assert.rejects(bundle.agent.stream({messages:[{role:"user",content:"hi"}],abortSignal:AbortSignal.abort()}));
});
test("compaction preserves full output while persisting a separate model context",async()=>{
  let summaries=0,normal=0;
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[],contextBudgetChars:100,streamFn:(_model,ctx)=>{
    const first=ctx.messages[0];
    if(first?.role==='user'&&typeof first.content==='string'&&first.content.startsWith('Summarize this browser-agent history')){summaries++;return stream(answer([{type:'text',text:'Earlier researched evidence, URL https://fixture.test/t/1; no actions to replay.'}]));}
    normal++;assert.ok(JSON.stringify(ctx.messages).includes('Earlier context summary'));
    return stream(answer([{type:'text',text:'Final grounded continuation'}]));
  }});
  const history=[{role:'user',content:'Original question '+ 'x'.repeat(1000)},{role:'assistant',content:[{type:'text',text:'Original answer'}]},{role:'user',content:'Follow up'},{role:'assistant',content:[{type:'text',text:'Second answer'}]},{role:'user',content:'More evidence'},{role:'assistant',content:[{type:'text',text:'Third answer'}]},{role:'user',content:'Continue'}];
  const result=await bundle.agent.stream({messages:history});const events=[];for await(const event of result.fullStream)events.push(event);
  const saved=await result.response;
  assert.equal(summaries,1);assert.equal(normal,1);assert.ok(events.some(e=>e.type==='context-summary'));
  assert.equal(saved.messages.at(-1)?.content[0].text,'Final grounded continuation');
  assert.ok(JSON.stringify(saved.modelContext).includes('Earlier context summary'));
  assert.ok(!JSON.stringify(saved.modelContext).includes('x'.repeat(1000)));
  assert.equal(history[0].content,'Original question '+ 'x'.repeat(1000));
});
