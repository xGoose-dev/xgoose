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
