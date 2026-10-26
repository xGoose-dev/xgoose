import test from 'node:test';
import assert from 'node:assert/strict';
const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){}}});
const {jsExecModelOutput}=await import('../packages/page-controller/src/tools/jsExec.ts');
if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else delete (globalThis as any).window;
import {createReadPageTool} from '../packages/page-controller/src/tools/readPage.ts';

const body='中文🙂 evidence '.repeat(20000)+'FINAL_DETAIL';
test('JS output preserves a large structured result and its final detail',()=>{
  const result={ok:true,result:{body}};
  const parts=jsExecModelOutput(result);
  assert.ok(Buffer.byteLength(parts[0].text)>300000);
  assert.deepEqual(JSON.parse(parts[0].text),result);
});

async function withPage(root:any,run:(tool:any)=>Promise<void>){
  const saved=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>root}});
  try{await run(createReadPageTool().definition);}
  finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete (globalThis as any).document;}
}
test('page text and HTML have no default size cap',async()=>{
  await withPage({innerText:body,outerHTML:`<main>${body}</main>`},async tool=>{
    const text=await tool.execute({format:'text'});
    const html=await tool.execute({format:'html'});
    assert.equal(text.text,body);assert.equal(text.nextOffset,null);
    assert.equal(html.html,`<main>${body}</main>`);assert.equal(html.nextOffset,null);
  });
});
test('an explicit page byte budget continues Chinese and emoji text without loss',async()=>{
  const text='中文🙂 evidence '.repeat(100)+'FINAL_DETAIL';
  await withPage({innerText:text},async tool=>{
    let offset=0,all='',reads=0;
    do{
      const result=await tool.execute({format:'text',maxBytes:500,offset});
      assert.ok(Buffer.byteLength(result.text)<=500);
      assert.ok(!result.text.includes('\uFFFD'));
      all+=result.text;reads++;
      if(result.nextOffset===null)break;
      assert.ok(result.nextOffset>offset);offset=result.nextOffset;
    }while(reads<20);
    assert.equal(all,text);assert.ok(reads>1);
  });
});
test('explicit array budgets stop between records and recover every link',async()=>{
  const anchors=Array.from({length:12},(_,i)=>({href:`https://fixture.test/${i}`,innerText:'中文'.repeat(80),getAttribute:()=>null}));
  await withPage({querySelectorAll:()=>anchors},async tool=>{
    let offset=0,all:any[]=[];
    do{
      const result=await tool.execute({format:'links',maxBytes:500,offset});
      assert.ok(result.items.length>0);all.push(...result.items);
      if(result.nextOffset===null)break;
      assert.ok(result.nextOffset>offset);offset=result.nextOffset;
    }while(all.length<20);
    assert.deepEqual(all.map(x=>x.href),anchors.map(x=>x.href));
  });
});
