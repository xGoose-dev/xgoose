import {apiFetch} from "@/shared/account";
import {parseHostedModelCatalogue} from "@/shared/hostedModels";
import {getFreshAccount} from "./account";
import {withHostedSession} from "./hostedSession";

export async function listHostedModels(refresh = false) {
  const account = await getFreshAccount();
  if (!account) return {ok:false as const, error:"Not signed in", signedIn:false};
  const res = await withHostedSession(a => apiFetch<unknown>(`/ai/v1/models${refresh ? "?refresh=1" : ""}`, {
    method:"GET", bearer:a.accessToken,
  }), {accountId:account.user.id});
  if (!res.ok) return {ok:false as const, error:res.error || `HTTP ${res.status}`, signedIn:true};
  return {ok:true as const, ...parseHostedModelCatalogue(res.data)};
}
