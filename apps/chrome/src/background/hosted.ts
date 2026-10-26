import { apiFetch } from "@/shared/account";
import { hostedBlocker, type HostedQuota } from "@/shared/hosted";
import { getFreshAccount } from "./account";
import { getConsent, setConsent } from "./transcripts";

export async function hostedStatus(claim = false, useHosted = false) {
  const account = await getFreshAccount();
  if (!account) throw new Error("Sign in with email in Settings → Free AI & account.");
  const [quota, consent] = await Promise.all([
    apiFetch<HostedQuota>(claim ? "/me/trial/claim" : "/me/quota", {
      method: claim ? "POST" : "GET", bearer: account.accessToken,
    }),
    getConsent(),
  ]);
  if (!quota.ok) throw new Error(quota.error);
  // Selecting Test or starting a Hosted conversation uses the storage policy
  // disclosed in Settings. Merely opening Settings never changes consent.
  if (useHosted && !consent.hosted) await setConsent({hosted:true, byok:false});
  return { quota: quota.data, consent: {...consent, hosted:consent.hosted || useHosted}, blocker: hostedBlocker(quota.data, true) };
}

export async function testHosted(model = "luna") {
  try {
    const state = await hostedStatus(false, true);
    if (state.blocker) return {ok:false as const,error:state.blocker};
    const account = await getFreshAccount();
    if (!account) throw new Error("Sign in before testing Hosted AI.");
    const result = await apiFetch<{choices?: unknown[]}>("/ai/v1/chat/completions", {
      method:"POST", bearer:account.accessToken, signal:AbortSignal.timeout(210000),
      body:JSON.stringify({model,messages:[{role:"user",content:"Reply with OK."}],stream:false,max_tokens:16}),
    });
    if (!result.ok) return {ok:false as const,error:result.error};
    if (!result.data.choices?.length) throw new Error("Hosted AI returned no model response. Please try again.");
    return {ok:true as const,message:`${model} responded successfully. Hosted AI is ready.`,modelCount:null};
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "Hosted AI did not respond in time. Wait for the current request to finish before testing again."
      : error instanceof Error ? error.message : String(error);
    return {ok:false as const,error:message};
  }
}
