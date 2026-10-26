import test from 'node:test';
import assert from 'node:assert/strict';
import {pageToolOutput,readToolOutputPage,DEFAULT_OUTPUT_CHARS} from '../packages/core/src/tools/outputPages.ts';
import {createReadToolOutputTool} from '../packages/core/src/tools/readToolOutput.ts';
import {defineTool} from '../packages/core/src/tools/buildTool.ts';
import {z} from 'zod';

test('small output passes through unchanged',()=>{
 const parts=[{type:'text' as const,text:'whole result'}];assert.equal(pageToolOutput(parts),parts);
});
test('pagination uses the total output size and recovers the entire original JSON',()=>{
 const data={posts:Array.from({length:10},(_,i)=>({id:i,text:'中文🙂'.repeat(2000)+` final detail ${i}`}))};
 const text=JSON.stringify(data);const snapshot=JSON.stringify(data);
 const parts=pageToolOutput([{type:'text',text}],20000);
 const first=JSON.parse((parts[0] as any).text);
 assert.equal(first.continuation.tool,'read_tool_output');assert.equal(first.totalChars,text.length);
 let all=first.text,next=first.nextOffset,calls=0;
 while(next!==null){const page=readToolOutputPage(first.outputId,next,30000);all+=page.text;next=page.nextOffset;calls++;}
 assert.deepEqual(JSON.parse(all),data);assert.equal(JSON.stringify(data),snapshot);assert.ok(calls>1);
});
test('all text parts share one output budget while image parts survive',()=>{
 const image={type:'file-data' as const,data:'source-image',mediaType:'image/png'};
 const parts=pageToolOutput([{type:'text',text:'A'.repeat(60)},image,{type:'text',text:'B'.repeat(60)}],100);
 const first=JSON.parse((parts[0] as any).text);
 assert.equal(first.text,'A'.repeat(60)+'\n'+'B'.repeat(39));assert.equal(parts[1],image);
 assert.equal(readToolOutputPage(first.outputId,first.nextOffset,100).text,'B'.repeat(21));
});
test('Unicode boundaries advance without splitting a surrogate pair',()=>{
 const text='🙂中文🙂';const first=JSON.parse((pageToolOutput([{type:'text',text}],1)[0] as any).text);
 let all=first.text,next=first.nextOffset;
 while(next!==null){const page=readToolOutputPage(first.outputId,next,1);all+=page.text;next=page.nextOffset;}
 assert.equal(all,text);assert.equal(first.text,'🙂');
});
test('core tool serialization saves output without altering or rerunning the operation',async()=>{
 let executions=0;const body='full evidence '.repeat(40000)+'FINAL_DETAIL';const original={body};
 const tool=defineTool({name:'read_fixture',description:'Read fixture',inputSchema:z.object({}),execute:()=>{executions++;return original;}});
 const output=await tool.definition.execute({},{});
 const parts=tool.definition.toModelOutput!(output,{});const first=JSON.parse((parts![0] as any).text);
 assert.equal(output,original);assert.equal(first.text.length,DEFAULT_OUTPUT_CHARS);
 const reader=createReadToolOutputTool();const page:any=await reader.definition.execute({outputId:first.outputId,nextOffset:first.nextOffset,maxChars:1000000},{});
 assert.equal(executions,1);assert.equal(page.nextOffset,null);
 assert.deepEqual(JSON.parse(first.text+page.text),original);
 // A caller-selected large continuation page is not paged a second time.
 const returned=reader.definition.toModelOutput!(page,{});
 assert.equal(JSON.parse((returned![0] as any).text).nextOffset,null);
});
