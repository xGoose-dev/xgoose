import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {receivePeerResult} from "../packages/core/src/peerAgents.ts";
import {setResultBudget,storedResult} from "../packages/core/src/resultStore.ts";
import { createAgent } from "../packages/core/src/createAgent.ts";
import { defineTool } from "../packages/core/src/tools/buildTool.ts";
import { createResultTransformTool } from "../packages/core/src/tools/resultTransform.ts";
import {createRememberTool,createForgetTool} from '../packages/core/src/tools/memory.ts';
const settings={provider:"openai-compat" as const,model:"luna",baseUrl:"https://example.test/ai",apiKey:"synthetic",thinking:false};
function answer(content:any[],reason:"stop"|"toolUse"|"length"="stop"):AssistantMessage {return {role:"assistant",content,api:"openai-completions",provider:"xgoose",model:"luna",timestamp:Date.now(),stopReason:reason,usage:{input:10,output:5,cacheRead:2,cacheWrite:0,totalTokens:17,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};}
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

test('Stop prevents queued tools from clearing memory after an earlier tool finishes',async()=>{
  let entered!:()=>void, release!:()=>void, writes=0, requests=0;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const ac=new AbortController();
  const deps={origin:{getCurrentOrigin:()=> 'https://fixture.test'},memory:{
    getMemoryForOrigin:async()=> 'Saved preference',
    appendMemoryForOrigin:async()=>{entered();await gate;return 'Saved preference';},
    clearMemoryForOrigin:async()=>{writes++;},
  }};
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[createRememberTool(deps),createForgetTool(deps)],streamFn:(_m,_ctx,options)=>{
    if(++requests===1)return stream(answer([
      {type:'toolCall',id:'remember-first',name:'remember',arguments:{note:'New note'}},
      {type:'toolCall',id:'forget-second',name:'forget',arguments:{}},
    ],'toolUse'));
    assert.ok(options?.signal?.aborted);
    const events=new AssistantMessageEventStream();
    events.push({type:'error',reason:'aborted',error:{...answer([]),stopReason:'aborted',errorMessage:'Stopped'}});
    return events;
  }});
  const run=await bundle.agent.stream({messages:[{role:'user',content:'Update memory'}],abortSignal:ac.signal});
  const completed=(async()=>{for await(const _ of run.fullStream){}})();
  await started;await new Promise(resolve=>setImmediate(resolve));ac.abort();release();await completed;
  assert.equal(writes,0,'a queued forget must never execute after Stop');
});
test("tool failures retain their text in live events and persisted history",async()=>{
  let requests=0;
  const message='weibo.searchStatuses: native API access denied';
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[defineTool({name:'broken',description:'Failure fixture',inputSchema:z.object({}),execute:()=>{throw new Error(message);}})],streamFn:(_m,ctx)=>{
    if(++requests===1)return stream(answer([{type:'toolCall',id:'failed-1',name:'broken',arguments:{}}],'toolUse'));
    assert.equal(ctx.messages.at(-1)?.content[0].text,message);return stream(answer([{type:'text',text:'Reported the actual failure'}]));
  }});
  const run=await bundle.agent.stream({messages:[{role:'user',content:'Run once'}]});const events=[];
  for await(const event of run.fullStream)events.push(event);
  assert.equal(events.find(e=>e.type==='tool-error')?.error,message);
  const saved=(await run.response).messages.find(m=>m.role==='tool');
  assert.equal(saved?.content[0].output.type,'error-text');assert.equal(saved?.content[0].output.value,message);
});
test('multiple image-reading tools in one turn cannot exceed the provider image cap',async()=>{
 let requests=0;
 const bundle=createAgent({settings,fetchImpl:fetch,tools:[defineTool({name:'images',description:'Image fixture',inputSchema:z.object({}),execute:()=>({attached:3}),resultAttachments:()=>Array.from({length:3},()=>({type:'file-data' as const,data:'fixture',mediaType:'image/jpeg'}))})],streamFn:(_m,ctx)=>{
  requests++;const images=ctx.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image');assert.ok(images.length<=8);
  if(requests<=3)return stream(answer([{type:'toolCall',id:`image-${requests}`,name:'images',arguments:{}}],'toolUse'));
  assert.equal(images.length,8);return stream(answer([{type:'text',text:'Read the available images'}]));
 }});
 const run=await bundle.agent.stream({messages:[{role:'user',content:'Read several image pages'}]});for await(const _ of run.fullStream){}
 const saved=(await run.response).messages.filter(m=>m.role==='tool').flatMap(m=>m.content[0].images);
 assert.equal(saved.length,9);assert.equal(requests,4);
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
test("the agent transforms complete results from parallel calls and reuses them after compaction", async () => {
  const large = {text: "x".repeat(320_000) + "full-tail", next_cursor: "page-2", truncated: true};
  const small = {posts: [{post_number: 1, text: "📌", amount: 2}, {post_number: 2, text: "Follow-up", amount: 10}]};
  let sourceCalls = 0;
  const read = defineTool({
    name: "read_fixture", description: "Read one fixture", inputSchema: z.object({large: z.boolean()}),
    isConcurrencySafe: () => true,
    execute: input => { sourceCalls++; return input.large ? large : small; },
  });
  const opts = {settings: {...settings, contextWindowTokens: 128_000}, fetchImpl: fetch, tools: [read, createResultTransformTool()]};
  const user = {role: "user", content: "Read and combine the two results"};
  let requests = 0;
  const first = createAgent({...opts, streamFn: (_model, context) => {
    if (++requests === 1) return stream(answer([
      {type: "toolCall", id: "large-read", name: read.name, arguments: {large: true}},
      {type: "toolCall", id: "small-read", name: read.name, arguments: {large: false}},
    ], "toolUse"));
    const refs = Object.fromEntries(context.messages.flatMap(message => {
      if (message.role !== "toolResult") return [];
      const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      if (message.toolCallId === "large-read") {
        assert.match(text, /"oversized":true/);
        assert.doesNotMatch(text, /full-tail/);
        assert.equal(message.details, undefined);
      }
      if (message.toolCallId === "small-read") assert.deepEqual(JSON.parse(text.split("\n")[0]), small);
      const id = text.match(/Result ID: "([^"]+)"/)?.[1];
      assert.ok(id);
      return [[message.toolCallId, id]];
    }));
    if (requests === 2) return stream(answer([{type: "toolCall", id: "combined", name: "result_transform", arguments: {
      sources: {big: refs["large-read"], small: refs["small-read"]},
      expression: "{tail: ends_with(big.text, 'full-tail'), cursor: big.next_cursor, truncated: big.truncated, total: sum(small.posts[].amount), sorted: sort(small.posts[].amount), length: length(small.posts[0].text)}",
    }}], "toolUse"));
    return stream(answer([{type: "text", text: "Combined"}]));
  }});
  const run = await first.agent.stream({messages: [user]});
  for await (const event of run.fullStream) assert.notEqual(event.type, "error", event.error);
  const {messages, modelContext} = await run.response;
  const results = messages.filter(message => message.role === "tool").map(message => message.content[0]);
  assert.deepEqual(results[0].output.value, large);
  assert.doesNotMatch(modelContext.find(message => message.role === "tool")?.content[0].output.value, /full-tail/);
  assert.deepEqual(results[2].output.value, {tail: true, cursor: "page-2", truncated: true, total: 12, sorted: [2, 10], length: 1});
  assert.equal(sourceCalls, 2);

  requests = 0;
  const second = createAgent({...opts, streamFn: (_model, context) => {
    if (++requests === 1) return stream(answer([{type: "toolCall", id: "list", name: "result_transform", arguments: {expression: "[?toolName=='read_fixture']"}}], "toolUse"));
    if (requests === 2) {
      assert.match(JSON.stringify(context.messages.at(-1)), new RegExp(results[0].resultId));
      return stream(answer([{type: "toolCall", id: "large-read", name: "result_transform", arguments: {
        sources: {big: results[0].resultId, combined: results[2].resultId},
        expression: "{fullLength: length(big.text), total: combined.total}",
      }}], "toolUse"));
    }
    return stream(answer([{type: "text", text: "Reused"}]));
  }});
  const followUp = await second.agent.stream({
    messages: [{role: "user", content: "Earlier context summary: two results were combined."}, {role: "user", content: "How long was the first result?"}],
    resultHistory: JSON.parse(JSON.stringify([user, ...messages])),
  });
  for await (const event of followUp.fullStream) assert.notEqual(event.type, "error", event.error);
  const saved = (await followUp.response).messages.filter(message => message.role === "tool");
  assert.deepEqual(saved[1].content[0].output.value, {fullLength: large.text.length, total: 12});
  assert.notEqual(saved[1].content[0].resultId, results[0].resultId);
  assert.equal(sourceCalls, 2);
});

test("restored raw results keep their full shape and previews omit unavailable IDs", async () => {
  const value = {count: 9, value: [1, 2]};
  const typed = {type: 42, count: 7};
  const preview = (resultId: string) => JSON.stringify({oversized: true, resultId, sizeBytes: 500, preview: "Saved evidence", next: `Use ${resultId}`});
  const toolResult = (toolCallId: string, output: unknown) => ({type: "tool-result", toolCallId, toolName: "lookup", output});
  const tools = [createResultTransformTool()];
  let requests = 0;
  const bundle = createAgent({settings, fetchImpl: fetch, tools, streamFn: (_model, context) => {
    if (++requests > 1) return stream(answer([{type: "text", text: "Done"}]));
    const toolTexts = context.messages.flatMap(message => message.role === "toolResult" ? message.content.map(part => part.type === "text" ? part.text : "") : []);
    assert.ok(toolTexts.includes(JSON.stringify(value)));
    assert.ok(toolTexts.includes(JSON.stringify(typed)));
    assert.match(toolTexts.join("\n"), /Saved evidence/);
    assert.doesNotMatch(toolTexts.join("\n"), /obsolete|missing-id/);
    return stream(answer([{type: "toolCall", id: "reuse", name: "result_transform", arguments: {
      sources: {ordinary: "available", typed: "typed"}, expression: "{ordinary: ordinary, typed: typed}",
    }}], "toolUse"));
  }});
  const run = await bundle.agent.stream({
    messages: [
      {role: "user", content: "Lookup"},
      {role: "assistant", content: ["available", "typed", "missing-id"].map(toolCallId => ({type: "tool-call", toolCallId, toolName: "lookup", input: {}}))},
      {role: "tool", content: [
        toolResult("available", {type: "json", value: preview("obsolete")}),
        toolResult("typed", {type: "json", value: typed}),
        toolResult("missing-id", {type: "json", value: `${preview("missing-id")}\nResult ID: "missing-id"`}),
      ]},
      {role: "user", content: "Reuse the available results"},
    ],
    resultHistory: [{role: "tool", content: [toolResult("available", value), toolResult("typed", typed)]}],
  });
  for await (const event of run.fullStream) assert.notEqual(event.type, "error", event.error);
  assert.deepEqual((await run.response).messages.find(message => message.role === "tool")?.content[0].output.value, {ordinary: value, typed});
});

test("model-facing successful results distinguish JSON strings from numbers", async () => {
  const echo = defineTool({name: "echo", description: "Return the input", inputSchema: z.object({value: z.union([z.string(), z.number()])}), execute: ({value}) => value});
  let requests = 0;
  const bundle = createAgent({settings, fetchImpl: fetch, tools: [echo], streamFn: (_model, context) => {
    if (++requests === 1) return stream(answer([
      {type: "toolCall", id: "string", name: echo.name, arguments: {value: "42"}},
      {type: "toolCall", id: "number", name: echo.name, arguments: {value: 42}},
    ], "toolUse"));
    const values = context.messages.flatMap(message => message.role === "toolResult" ? [message.content[0]] : []);
    assert.deepEqual(values, [{type: "text", text: '"42"'}, {type: "text", text: "42"}]);
    return stream(answer([{type: "text", text: "Done"}]));
  }});
  const run = await bundle.agent.stream({messages: [{role: "user", content: "Echo both values"}]});
  for await (const event of run.fullStream) assert.notEqual(event.type, "error", event.error);
  assert.deepEqual((await run.response).messages.filter(message => message.role === "tool").map(message => message.content[0].output.value), ["42", 42]);
});
test("an answer cut off by the output cap continues instead of ending mid-sentence",async()=>{
  let requests=0;
  const bundle=createAgent({settings,fetchImpl:fetch,tools:[],streamFn:(_m,ctx)=>{
    if(++requests===1)return stream(answer([{type:"text",text:"First half of the"}],"length"));
    assert.deepEqual(ctx.messages.slice(-2).map(m=>m.role),["assistant","user"]);
    assert.match(JSON.stringify(ctx.messages.at(-1)?.content),/cut off by the output limit/);
    return stream(answer([{type:"text",text:" answer."}]));
  }});
  const run=await bundle.agent.stream({messages:[{role:"user",content:"Long answer"}]});const steps=[];
  for await(const event of run.fullStream)if(event.type==="start-step")steps.push(!!event.continuation);
  const saved=await run.response;
  assert.deepEqual(steps,[false,true]);
  assert.equal(requests,2);
  assert.deepEqual(saved.messages.map(m=>m.role),["assistant","assistant"]);
  assert.match(JSON.stringify(saved.modelContext.at(-2)),/cut off by the output limit/);
});
test("concurrency-safe calls in one turn run together while other calls run alone in order",async()=>{
  let active=0,peak=0;const order:string[]=[];
  const work=(name:string)=>async({q}:{q:string})=>{order.push(`${name}:${q}:start`);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;order.push(`${name}:${q}:end`);return q;};
  const tools=[defineTool({name:"read",description:"read",inputSchema:z.object({q:z.string()}),isConcurrencySafe:()=>true,execute:work("read")}),
    defineTool({name:"write",description:"write",inputSchema:z.object({q:z.string()}),execute:work("write")})];
  let requests=0;
  const bundle=createAgent({settings,fetchImpl:fetch,tools,streamFn:()=>{
    if(++requests===1)return stream(answer([{type:"toolCall",id:"r1",name:"read",arguments:{q:"a"}},{type:"toolCall",id:"r2",name:"read",arguments:{q:"b"}},{type:"toolCall",id:"w1",name:"write",arguments:{q:"c"}},{type:"toolCall",id:"r3",name:"read",arguments:{q:"d"}}],"toolUse"));
    return stream(answer([{type:"text",text:"done"}]));
  }});
  const run=await bundle.agent.stream({messages:[{role:"user",content:"go"}]});for await(const _ of run.fullStream){}
  assert.equal(peak,2);
  assert.deepEqual(order.slice(4),["write:c:start","write:c:end","read:d:start","read:d:end"]);
});

test("a yielded peer wait resumes from its tool response without creating a user turn", async () => {
  let waiting = false, requests = 0;
  const wait = defineTool({name:"wait_agents",description:"Wait for peers",inputSchema:z.object({agentIds:z.array(z.string())}),execute:()=>{waiting=true;return {waiting:true};}});
  const initial = createAgent({settings,fetchImpl:fetch,tools:[wait],shouldYield:()=>waiting,streamFn:()=>{
    requests++;return stream(answer([{type:"toolCall",id:"wait-1",name:"wait_agents",arguments:{agentIds:["flyertalk"]}}],"toolUse"));
  }});
  const history=[{role:"user",content:"Research this forum"}];
  const run=await initial.agent.stream({messages:history});for await(const _ of run.fullStream){}
  const saved=await run.response;assert.equal(requests,1);
  const result={id:"result:task-1",from:"flyertalk",to:"uscf",kind:"result" as const,state:"claimed" as const,outcome:"completed" as const,text:"Peer evidence"};
  const delivery=receivePeerResult([...history,...saved.messages],saved.modelContext,result);
  assert.equal(delivery.toolCallId,"wait-1");
  assert.equal(delivery.history.filter(m=>m.role==="user").length,1);
  assert.equal(delivery.history.at(-1)?.content[0].output.value.messages[0].text,"Peer evidence");
  const resumed=createAgent({settings,fetchImpl:fetch,tools:[wait],streamFn:(_model,ctx)=>{
    requests++;assert.equal(ctx.messages.at(-1)?.role,"toolResult");
    assert.ok(JSON.stringify(ctx.messages.at(-1)).includes("Peer evidence"));
    return stream(answer([{type:"text",text:"Combined forum answer"}]));
  }});
  const next=await resumed.agent.stream({messages:delivery.context});for await(const _ of next.fullStream){}
  assert.equal((await next.response).messages.at(-1)?.content[0].text,"Combined forum answer");assert.equal(requests,2);
  // Another completion after a user has continued chatting has its own tool
  // delivery; it cannot replace the earlier evidence or become a user message.
  const later=receivePeerResult([...delivery.history,{role:"user",content:"More detail"},{role:"assistant",content:"Answer"}], [{role:"user",content:"Compacted context"}], {...result,id:"result:task-2",text:"Second peer evidence"});
  assert.match(later.toolCallId,/^[a-zA-Z0-9_-]{1,40}$/);
  assert.equal(later.history.at(-1)?.role,"tool");assert.equal(later.context.at(-2)?.role,"assistant");
  assert.equal(later.history.filter(m=>m.role==="user").length,2);
  setResultBudget(1000);
  const large=receivePeerResult(history,history,{...result,text:"Full evidence ".repeat(10000)});
  const bounded=JSON.parse(large.context.at(-1)?.content[0].output.value);
  assert.equal(bounded.oversized,true);assert.equal((storedResult(bounded.resultId) as any).messages[0].text,large.history.at(-1)?.content[0].output.value.messages[0].text);
});
