import {getFreshAccount,refreshTokens} from './account';
import {HOSTED_AUTH_STOPPED} from '@/shared/hosted';
import type {Account} from '@/shared/account';
/** Only the rejected HTTP request is retried, never an agent turn or a tool. */
export async function withHostedSession<T extends {status:number}>(request:(account:Account)=>Promise<T>,options:{accountId?:string;signal?:AbortSignal;dispose?:(response:T)=>Promise<void>}={}):Promise<T>{
 options.signal?.throwIfAborted();
 const first=await getFreshAccount();
 const accountId=options.accountId??first?.user.id;
 const authorized=(a:Account|null)=>{if(!a||a.user.id!==accountId)throw new Error(HOSTED_AUTH_STOPPED);return a;};
 const account=authorized(first);options.signal?.throwIfAborted();
 const response=await request(account);
 if(response.status!==401)return response;
 await options.dispose?.(response);options.signal?.throwIfAborted();
 const renewed=authorized(await refreshTokens(account.accessToken));options.signal?.throwIfAborted();
 const retry=await request(renewed);
 if(retry.status!==401)return retry;
 await options.dispose?.(retry);throw new Error(HOSTED_AUTH_STOPPED);
}
