import type {Account} from '@/shared/account';
type Renewal = {ok:true;account:Account}|{ok:false;status:number};
export class SessionRefreshUnavailable extends Error {
 readonly status = 503;
 constructor(){super('Connection interrupted while renewing your session. Your account is still saved. Please retry.');this.name='SessionRefreshUnavailable';}
}
/** One coordinator per extension worker, shared by settings, tabs and model calls. */
export function createAccountSession(io:{read:()=>Promise<Account|null>;save:(a:Account)=>Promise<void>;clear:()=>Promise<void>;renew:(a:Account)=>Promise<Renewal>;wait?:(ms:number)=>Promise<void>}) {
 let refreshing:Promise<Account|null>|null=null, writes=Promise.resolve(), generation=0;
 const serialize=<T>(fn:()=>Promise<T>)=>{const job=writes.then(fn);writes=job.then(()=>{},()=>{});return job;};
 const same=(a:Account|null,b:Account)=>a?.user.id===b.user.id&&a.accessToken===b.accessToken&&a.refreshToken===b.refreshToken;
 const valid=(a:Account|null,buffer=0)=>!!a&&Date.parse(a.accessTokenExpiresAt)-Date.now()>buffer;
 const wait=io.wait??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 async function snapshot(){await writes;return io.read();}
 async function replace(account:Account|null){generation++;await serialize(()=>account?io.save(account):io.clear());}
 async function refresh(rejectedToken?:string):Promise<Account|null>{
  await writes;
  const account=await io.read();if(!account)return null;
  if(rejectedToken&&account.accessToken!==rejectedToken)return account;
  if(refreshing)return refreshing;
  const epoch=generation;
  const job=(async()=>{
   // Persist the request secret before sending, so a restart or lost response
   // retries this exact rotation even after the server's short overlap.
   const prepared=await serialize(async()=>{
    const current=await io.read();if(epoch!==generation||!same(current,account))return null;
    const next={...account,refreshRequestId:account.refreshRequestId??crypto.randomUUID()};
    await io.save(next);return next;
   });
   if(!prepared)return snapshot();
   let result:Renewal={ok:false,status:0};
   for(let attempt=0;attempt<3;attempt++){
    const current=await snapshot();if(epoch!==generation||!same(current,prepared))return current;
    try{result=await io.renew(prepared);}catch{result={ok:false,status:0};}
    if(result.ok||![0,408,425,429].includes(result.status)&&result.status<500)break;
    if(attempt<2)await wait(250*(attempt+1));
   }
   return serialize(async()=>{
    const current=await io.read();
    if(epoch!==generation||!same(current,prepared))return current;
    if(!result.ok){
     if(result.status===401||result.status===403){await io.clear();return null;}
     throw new SessionRefreshUnavailable();
    }
    const {refreshRequestId:completed,...renewed}=result.account;
    await io.save(renewed);return renewed;
   });
  })();
  refreshing=job;
  try{return await job;}finally{if(refreshing===job)refreshing=null;}
 }
 async function fresh():Promise<Account|null>{
  const account=await snapshot();
  if(!refreshing&&(!account||valid(account,120000)))return account;
  try{return await (refreshing??refresh(account?.accessToken));}
  catch(error){
   const current=await snapshot();
   if(!current||valid(current))return current;
   throw error;
  }
 }
 return {replace,refresh,fresh,snapshot};
}
