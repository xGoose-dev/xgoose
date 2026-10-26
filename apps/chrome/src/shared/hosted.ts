export interface HostedQuota {
  claimable: boolean;
  granted_micros: number;
  remaining_micros: number;
  expires_at: string | null;
  platform_paused: boolean;
}

export function hostedBlocker(quota: HostedQuota, consent: boolean, now = Date.now()): string | null {
  if (!consent) return "Review and agree to Hosted conversation storage in Settings → Free AI & account.";
  if (!quota.granted_micros) return quota.claimable
    ? "Claim your free trial credit in Settings → Free AI & account before using Hosted AI."
    : "Free trial claims are currently paused. Try again later or choose BYOK in Settings.";
  if (quota.expires_at && Date.parse(quota.expires_at) <= now) return "Your Hosted trial has expired. Open your account to review credit, or choose BYOK.";
  if (quota.remaining_micros <= 0) return "Your Hosted credit is used or reserved by earlier requests. Review your account balance, or choose BYOK.";
  if (quota.platform_paused) return "Hosted AI is temporarily paused or has reached its shared daily limit. Try again later or choose BYOK.";
  return null;
}

/** Preserve the gateway's actionable message when the OpenAI SDK reads errors. */
export async function normalizeHostedError(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.text();
  let message = "", code = "hosted_error",context:unknown;
  try {
    const data = JSON.parse(body);
    code = typeof data.error === "string" ? data.error : data.error?.code ?? code;
    message = data.error?.message || data.message || "";
    if(code==="context_length_exceeded")context=data.detail??data.error?.context;
    if (code === "too_many_requests" && data.detail) {
      message = hostedBlocker(data.detail, true) || message;
    }
  } catch { /* Do not show an HTML error document in chat. */ }
  if (!message || message.includes("consent, trial balance")) message = response.status === 429
    ? "Hosted AI is busy or this request exceeds the available credit. Wait for any current request to finish, then check credit and consent in Settings → Free AI & account."
    : `Hosted AI request failed (HTTP ${response.status}). Check your connection and account in Settings.`;
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify({error:{message,code,type:code,...(context?{context}:{})}}), {status:response.status,headers});
}
