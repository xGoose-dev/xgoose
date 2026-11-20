import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/fail')){req.socket.destroy();return;}
 const body=[];for await(const chunk of req)body.push(chunk);
 res.setHeader('content-type',req.url.startsWith('/echo')?'application/json':'text/html');
 res.end(req.url.startsWith('/echo')?JSON.stringify({method:req.method,body:Buffer.concat(body).toString(),header:req.headers['x-fixture']??null}):'<!doctype html><title>Network compatibility fixture</title><main>Ready</main>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
try{
 for(const mode of ['mega-after','frozen-after','locked-before']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.evaluate(()=>{window.originalXHR=XMLHttpRequest;window.originalOpen=XMLHttpRequest.prototype.open;window.originalFetch=fetch;});
  const harden=()=>{
   Object.defineProperty(XMLHttpRequest.prototype,'open',{writable:false,configurable:true});
   Object.defineProperty(window,'fetch',{writable:false,configurable:true});
  };
  if(mode==='locked-before'){
   await page.evaluate(harden);
   await page.evaluate(()=>{Object.freeze(XMLHttpRequest.prototype);Object.freeze(console);});
  }
  await page.addScriptTag({path:resolve('apps/chrome/dist/pageBridge.js')});
  if(mode!=='locked-before')await page.evaluate(harden);
  if(mode==='frozen-after')await page.evaluate(()=>Object.freeze(XMLHttpRequest.prototype));
  const result=await page.evaluate(async({mode,base})=>{
   const xhr=new XMLHttpRequest();Object.preventExtensions(xhr);
   const request=async(method,body)=>{
    const done=new Promise((resolve,reject)=>{xhr.onload=()=>resolve(JSON.parse(xhr.responseText));xhr.onerror=()=>reject(Error('XHR failed'));});
    xhr.open(method,base+'/echo');xhr.setRequestHeader('X-Fixture','first');xhr.setRequestHeader('X-Fixture','second');xhr.send(body);return done;
   };
   const first=await request('POST','first body'),second=await request('PUT','second body');
   let invalidSend;
   try {new XMLHttpRequest().send();}catch(error){invalidSend=error.name;}
   const sync=new XMLHttpRequest();sync.open('GET',base+'/echo',false);sync.send();
   class DerivedXHR extends XMLHttpRequest{}
   const derived=new DerivedXHR();derived.responseType='json';derived.open('GET',base+'/echo');
   await new Promise((resolve,reject)=>{derived.onload=resolve;derived.onerror=reject;derived.send();});
   const reentrant=new XMLHttpRequest();
   await new Promise((resolve,reject)=>{
    let round=0;reentrant.onerror=reject;reentrant.onload=()=>{
     if(++round===2){resolve();return;}
     reentrant.open('GET',base+'/echo');reentrant.send();
    };
    reentrant.open('GET',base+'/echo');reentrant.send();
   });
   const fetched=await fetch(base+'/echo');await fetched.json();
   const early=new XMLHttpRequest();
   const earlyResult=await new Promise((resolve,reject)=>{
    early.onreadystatechange=()=>{if(early.readyState===1){early.setRequestHeader('X-Fixture','early');early.send('early body');}};
    early.onload=()=>resolve(JSON.parse(early.responseText));early.onerror=reject;
    early.open('POST',base+'/echo?early');
   });
   const failed=new XMLHttpRequest();failed.open('GET',new URL(base+'/fail'));
   await new Promise(resolve=>{failed.onloadend=resolve;failed.send();});
   return {first,second,invalidSend,syncStatus:sync.status,derivedResponse:derived.response,
    sameConstructor:XMLHttpRequest===window.originalXHR,nativeInstance:xhr instanceof originalXHR,derivedInstance:derived instanceof DerivedXHR,
    readyStateConstant:XMLHttpRequest.DONE,bridgeReady:!!window.__xgoose,earlyResult,
    originalOpenPreserved:mode!=='locked-before'||XMLHttpRequest.prototype.open===window.originalOpen,
    originalFetchPreserved:mode!=='locked-before'||fetch===window.originalFetch,
    captures:window.__xgoose.getNetworkRequests().map(entry=>({...entry,reqBody:window.__xgoose.getNetworkRequestDetail(entry.id,'body'),headers:window.__xgoose.getNetworkRequestDetail(entry.id,'headers')}))};
  },{mode,base});
  assert.deepEqual(errors,[],`${mode}: no extension error may reach the page`);
  assert.equal(result.sameConstructor,true,`${mode}: preserve native constructor identity`);
  assert.equal(result.nativeInstance,true);assert.equal(result.derivedInstance,true);assert.equal(result.readyStateConstant,4);
  assert.equal(result.bridgeReady,true);assert.equal(result.originalOpenPreserved,true);assert.equal(result.originalFetchPreserved,true);
  assert.deepEqual(result.first,{method:'POST',body:'first body',header:'first, second'});
  assert.deepEqual(result.second,{method:'PUT',body:'second body',header:'first, second'});
  assert.equal(result.invalidSend,'InvalidStateError');assert.equal(result.syncStatus,200);assert.equal(result.derivedResponse.method,'GET');
  assert.deepEqual(result.earlyResult,{method:'POST',body:'early body',header:'early'});
  if(mode!=='locked-before'){
   assert.equal(result.captures.length,9,'all requests, including OPENED callback and URL-object failure, captured once');
   assert.deepEqual(result.captures.filter(entry=>entry.method==='POST'||entry.method==='PUT').map(entry=>entry.reqBody),['first body','second body','early body']);
   const early=result.captures.find(entry=>entry.url.endsWith('?early'));assert.equal(early.headers.req['x-fixture'],'early');
   const failed=result.captures.find(entry=>entry.url.endsWith('/fail'));assert.equal(failed.status,0);
   assert.ok(result.captures.filter(entry=>entry!==failed).every(entry=>entry.status===200),JSON.stringify(result.captures));
  }else assert.equal(result.captures.length,0,'locked APIs are left intact');
  console.log(JSON.stringify({mode,passed:true,nativeConstructor:true,nonExtensibleInstance:true,xhrReuse:true,synchronousXHR:true,subclass:true,fetch:true,captures:result.captures.length}));
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
