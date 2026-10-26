// Opt-in, real provider smoke test. Reads credentials only from the environment;
// logs only sanitized outcomes, never requests, headers or credential values.
import {createAgent} from '../packages/core/src/createAgent.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';
import {z} from 'zod';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

if(process.env.XGOOSE_LIVE_BYOK!=='1')throw new Error('Set XGOOSE_LIVE_BYOK=1 to explicitly enable paid live requests.');
const geminiKey=process.env.GEMINI_API??process.env.GEMINI_API_KEY;
if(!geminiKey)throw new Error('GEMINI_API is not configured.');
const secrets=[geminiKey,process.env.OPENAI_API_KEY].filter(Boolean) as string[];
const sanitize=(value:string)=>secrets.reduce((s,key)=>s.replaceAll(key,'[redacted]'),value).slice(0,700);
const variants=[
 {name:'gemini-native',provider:'gemini' as const,model:'gemini-2.5-flash',apiKey:geminiKey,baseUrl:''},
 {name:'gemini-openai-format',provider:'openai-compat' as const,model:'gemini-2.5-flash',apiKey:geminiKey,baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai/'},
 ...(process.env.OPENAI_API_KEY?[{name:'openai-direct',provider:'openai-compat' as const,model:'gpt-4o-mini',apiKey:process.env.OPENAI_API_KEY,baseUrl:''}]:[]),
];
const outcomes=[];
for(const variant of variants.filter(v=>!process.env.XGOOSE_LIVE_PROVIDERS||process.env.XGOOSE_LIVE_PROVIDERS.split(',').includes(v.name))){
 let calls=0,requests=0;const statuses:number[]=[];
 try{
  const tool=defineTool({name:'read_release_fixture',description:'Read a synthetic local release test value. Call before answering the user.',inputSchema:z.object({}),execute:()=>{calls++;return {testValue:'BYOK_VERIFIED_728'};}});
  const bundle=createAgent({settings:{...variant,thinking:false},tools:[tool],maxSteps:3,fetchImpl:async(input,init)=>{
   requests++;const result=await fetch(input,init);statuses.push(result.status);return result;
  }});
  const run=await bundle.agent.stream({messages:[{role:'user',content:'This is a synthetic release test. You must call read_release_fixture exactly once. Then reply with only its testValue. Do not answer without using the tool.'}],abortSignal:AbortSignal.timeout(55000)});
  let text='';const errors:string[]=[];
  for await(const event of run.fullStream){if(event.type==='text-delta')text+=event.text;if(event.type==='error')errors.push(sanitize(String(event.error)));}
  await run.response;assert.equal(errors.length,0,errors.join('; '));assert.equal(calls,1);assert.match(text,/BYOK_VERIFIED_728/);
  const outcome={name:variant.name,model:variant.model,passed:true,toolCalls:calls,requests,statuses};outcomes.push(outcome);console.log(JSON.stringify(outcome));
 }catch(error){const outcome={name:variant.name,model:variant.model,passed:false,toolCalls:calls,requests,statuses,error:sanitize(error instanceof Error?error.message:String(error))};outcomes.push(outcome);console.log(JSON.stringify(outcome));}
}
await mkdir('artifacts/byok',{recursive:true});await writeFile(`artifacts/byok/live-${process.env.XGOOSE_LIVE_PROVIDERS?'selected-':''}report.json`,JSON.stringify({outcomes},null,2));
if(outcomes.some(o=>!o.passed))process.exitCode=1;
