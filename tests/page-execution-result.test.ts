import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../apps/chrome/src/background/userScripts.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:fileURLToPath(new URL('../apps/chrome/tsconfig.json',import.meta.url))});
test('page execution reports an absent browser result without confusing it with a returned null',async()=>{
  let result:any=null;
  const context:any={chrome:{userScripts:{execute:async()=>[{documentId:'live-document',result}]}},console};
  vm.runInNewContext(bundle.outputFiles[0].text,context);
  const sender={tab:{id:1},documentId:'live-document'};
  const execute=()=>context.module.executePage(sender,{execId:'example',code:'return null;'});
  await assert.rejects(execute(),/Page execution returned no result/);
  result={ok:true,result:null};assert.equal((await execute()).result,null);
  result={ok:false,error:'Original page error'};assert.equal((await execute()).error,'Original page error');
});
