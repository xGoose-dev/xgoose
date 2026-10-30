import {apiFetch} from "@/shared/account";
import {HOSTED_AUTH_STOPPED} from "@/shared/hosted";
import {withHostedSession} from "./hostedSession";
import type {SearchReply} from "@/shared/search";

const active=new Map<string,{owner:string;controller:AbortController}>();
const owner=(sender:chrome.runtime.MessageSender)=>JSON.stringify([sender.tab?.id,sender.frameId,sender.documentId??sender.url]);
export function abortSearch({requestId}:{requestId:string},sender:chrome.runtime.MessageSender) {
  const search=active.get(requestId);
  if(search?.owner===owner(sender))search.controller.abort();
}
export async function searchWeb(input:{query:string;requestId:string;accountId:string},sender:chrome.runtime.MessageSender):Promise<SearchReply> {
  if(active.has(input.requestId))throw new Error("Search already in progress.");
  const controller=new AbortController();
  active.set(input.requestId,{owner:owner(sender),controller});
  try {
    const response=await withHostedSession(account=>apiFetch<SearchReply>("/ai/v1/search",{
      method:"POST",redirect:"error",bearer:account.accessToken,
      headers:{"Idempotency-Key":input.requestId},body:JSON.stringify({query:input.query}),
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)]),
    }),{accountId:input.accountId,signal:controller.signal});
    if(!response.ok)throw new Error(response.error);
    return response.data;
  } catch(error) {
    if(error instanceof Error && error.message===HOSTED_AUTH_STOPPED)throw new Error("Public web search account changed or sign-in expired. Sign in again; website research with your own provider can continue.");
    throw error;
  } finally {active.delete(input.requestId);}
}
