import type {Account} from '@/shared/account';
type Renewal = {ok:true;account:Account}|{ok:false;status:number};
/** One coordinator per extension worker, shared by settings, tabs and model calls. */
export function createAccountSession(io:{read:()=>Promise<Account|null>;save:(a:Account)=>Promise<void>;clear:()=>Promise<void>;renew:(a:Account)=>Promise<Renewal>}) {
 let refreshing:Promise<Account|null>|null=null, writes=Promise.resolve(), generation=0;
 const serialize=<T>(fn:()=>Promise<T>)=>{const job=writes.then(fn);writes=job.then(()=>{},()=>{});return job;};
 const same=(a:Account|null,b:Account)=>a?.user.id===b.user.id&&a.accessToken===b.accessToken&&a.refreshToken===b.refreshToken;
 const valid=(a:Account|null,buffer=0)=>!!a&&Date.parse(a.accessTokenExpiresAt)-Date.now()>buffer;
 async function replace(account:Account|null){generation++;await serialize(()=>account?io.save(account):io.clear());}
 async function refresh(rejectedToken?:string):Promise<Account|null>{
  await writes;
  const account=await io.read();if(!account)return null;
  // A delayed 401 for A must use the already-rotated B, not rotate B again.
  if(rejectedToken&&account.accessToken!==rejectedToken)return account;
  if(refreshing)return refreshing;
  const epoch=generation;
  const job=(async()=>{
   let result:Renewal;
   try{result=await io.renew(account);}catch{return null;}
   return serialize(async()=>{
    const current=await io.read();
    // Logout, a new login or another writer wins over this stale completion.
    if(epoch!==generation||!same(current,account))return current;
    if(!result.ok){if(result.status===401)await io.clear();return null;}
    await io.save(result.account);return result.account;
   });
  })();
  refreshing=job;
  try{return await job;}finally{if(refreshing===job)refreshing=null;}
 }
 const afterRefresh=async(job:Promise<Account|null>)=>{await job;await writes;const account=await io.read();return valid(account)?account:null;};
 async function fresh():Promise<Account|null>{
  if(refreshing)return afterRefresh(refreshing);
  await writes;const account=await io.read();
  if(refreshing)return afterRefresh(refreshing);
  if(!account||valid(account,120000))return account;
  const renewed=await refresh(account.accessToken);
  if(renewed)return renewed;
  // Transient refresh failures may use an unexpired token, never a cleared one.
  await writes;const current=await io.read();return valid(current)?current:null;
 }
 return {replace,refresh,fresh};
}
