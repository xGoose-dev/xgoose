import {connectionErrorMessage} from '@/shared/connectionError';
import {HOSTED_AUTH_STOPPED,isHostedAuthStopped} from '@/shared/hosted';
import {withHostedSession} from './hostedSession';
import {providerHeaders} from '@/shared/host';
import {XGOOSE_API_URL} from '@/shared/account';
export interface ProviderRequest {url:string;method:string;headers:Record<string,string>;body?:string;hostedAccountId?:string}
/** Retry only a rejected HTTP model request, before exposing any stream or tools. */
export async function providerFetch(req:ProviderRequest,signal?:AbortSignal):Promise<Response>{
 const hosted=req.hostedAccountId!==undefined;
 if(hosted){
  const url=new URL(req.url);
  if(url.origin!==XGOOSE_API_URL||url.pathname!=='/ai/v1/chat/completions'||url.username||url.password)throw new Error('Hosted credentials cannot be sent to this endpoint.');
 }
 signal?.throwIfAborted();
 const options:RequestInit={method:req.method,headers:providerHeaders(req.headers),body:req.body,signal,...(hosted?{redirect:'error' as const}:{})};
 const connect = async (init: RequestInit): Promise<Response> => {
  try { return await fetch(req.url, init); }
  catch (error) {
   if(signal?.aborted || (error as Error)?.name !== 'TypeError')throw error;
   // SDKs replace transport exceptions with “Connection error.” An HTTP error
   // preserves an actionable message through the same streaming error path.
   return Response.json({error:{message:connectionErrorMessage(req.url),code:'provider_connection_failed',type:'connection_error'}},{status:502});
  }
 };
 if(!hosted)return connect(options);
 try{return await withHostedSession(account=>{
  const headers=new Headers(options.headers);headers.set('authorization',`Bearer ${account.accessToken}`);
  return connect({...options,headers});
 },{accountId:req.hostedAccountId,signal,dispose:async(response)=>{await response.body?.cancel();}});
 }catch(error){
  if(error instanceof Error&&isHostedAuthStopped(error.message))return Response.json({error:{message:HOSTED_AUTH_STOPPED,code:"hosted_auth_expired",type:"authentication_error"}},{status:401});
  throw error;
 }
}
