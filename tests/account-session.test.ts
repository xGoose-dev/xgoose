import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSession} from '../apps/chrome/src/background/accountSession.ts';
import type {Account} from '../apps/chrome/src/shared/account.ts';
const token=(s:string,user='user',ms=3600000):Account=>({user:{id:user,email:'fixture@example.test',name:null,avatar_url:null,email_verified:true,is_admin:false},accessToken:s,refreshToken:'refresh-'+s,accessTokenExpiresAt:new Date(Date.now()+ms).toISOString(),lastSeenAt:0});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
function fixture(initial:Account|null=token('A')){
 let account=initial, renewals=0, cleared=0;
 const gate=deferred<any>();
 const session=createAccountSession({read:async()=>account,save:async a=>{account=a;},clear:async()=>{cleared++;account=null;},renew:async()=>{renewals++;return gate.promise;}});
 return {session,gate,read:()=>account,renewals:()=>renewals,cleared:()=>cleared,external:(a:Account|null)=>{account=a;}};
}
const started=async(f:ReturnType<typeof fixture>)=>{while(!f.renewals())await new Promise(r=>setTimeout(r,0));};
test('parallel failed requests share one rotation; fresh readers wait during rotation',async()=>{
 const f=fixture();const a=f.session.refresh('A'),b=f.session.refresh('A');await started(f);
 const c=f.session.fresh();f.gate.resolve({ok:true,account:token('B')});
 assert.deepEqual((await Promise.all([a,b,c])).map(x=>x?.accessToken),['B','B','B']);assert.equal(f.renewals(),1);
 assert.equal((await f.session.refresh('A'))?.accessToken,'B');assert.equal(f.renewals(),1,'late A failure must not rotate B');
});
test('revoked refresh clears the account and never falls back to unexpired rejected credentials',async()=>{
 const f=fixture(token('A','user',30000));const fresh=f.session.fresh();await started(f);f.gate.resolve({ok:false,status:401});
 assert.equal(await fresh,null);assert.equal(f.read(),null);assert.equal(f.cleared(),1);
});
test('temporary refresh failure keeps valid storage, expired storage is not used',async()=>{
 for(const ms of [30000,-1000]){const f=fixture(token('A','user',ms));const fresh=f.session.fresh();await started(f);f.gate.resolve({ok:false,status:503});assert.equal((await fresh)?.accessToken,ms>0?'A':undefined);assert.equal(f.read()?.accessToken,'A');}
});
test('logout while refresh is in flight cannot resurrect the session',async()=>{
 const f=fixture();const old=f.session.refresh('A');await started(f);await f.session.replace(null);f.gate.resolve({ok:true,account:token('B')});assert.equal(await old,null);assert.equal(f.read(),null);
});
test('new login wins over both stale refresh success and stale refresh rejection',async()=>{
 for(const reply of [{ok:true,account:token('B')},{ok:false,status:401}]){
  const f=fixture();const old=f.session.refresh('A');await started(f);await f.session.replace(token('C','other'));f.gate.resolve(reply);
  assert.equal((await old)?.accessToken,'C');assert.equal(f.read()?.user.id,'other');assert.equal(f.cleared(),0);
 }
});
test('storage changed by another context is not overwritten or cleared by a stale refresh',async()=>{
 const f=fixture();const old=f.session.refresh('A');await started(f);f.external(token('C'));f.gate.resolve({ok:false,status:401});assert.equal((await old)?.accessToken,'C');assert.equal(f.cleared(),0);
});
test('fresh readers retain a still-valid stored token when an in-flight proactive refresh has a transient failure',async()=>{
 const f=fixture();const refresh=f.session.refresh('A');await started(f);const fresh=f.session.fresh();f.gate.resolve({ok:false,status:503});assert.equal(await refresh,null);assert.equal((await fresh)?.accessToken,'A');
});
