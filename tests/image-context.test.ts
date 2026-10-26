import test from 'node:test';
import assert from 'node:assert/strict';
import {toPiMessages} from '../packages/core/src/createAgent.ts';
import {createModel} from '../packages/core/src/model.ts';
import {redactTranscript} from '../apps/chrome/src/shared/redact.ts';
const model=createModel({provider:'openai-compat',apiKey:'fixture',model:'luna',baseUrl:'https://example.test',thinking:false});
test('image context keeps the eight newest attachments without deleting local history',()=>{
 const history=Array.from({length:10},(_,i)=>({role:'user',content:[{type:'text',text:`Question ${i}`},{type:'image',mimeType:'image/jpeg',data:`image-${i}`}]}));
 const context=toPiMessages(history,model);
 const images=context.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((p:any)=>p.type==='image');
 assert.equal(images.length,8);assert.equal(images[0].data,'image-2');assert.equal(images.at(-1).data,'image-9');
 assert.ok(JSON.stringify(context[0]).includes('Ask the user to reattach'));
 assert.equal(history[0].content[1].data,'image-0');
});
test('diagnostic transcripts omit image bytes while preserving image metadata',()=>{
 const value={type:'context-summary',modelContext:[{role:'user',content:[{type:'text',text:'Describe it'},{type:'image',mimeType:'image/jpeg',data:'private-image-bytes'}]}]};
 const result=redactTranscript(value);
 assert.ok(!JSON.stringify(result).includes('private-image-bytes'));assert.ok(JSON.stringify(result).includes('image/jpeg'));assert.ok(JSON.stringify(result).includes('Describe it'));
});
