import test from "node:test";
import assert from "node:assert/strict";
import { hostedBlocker, normalizeHostedError, type HostedQuota } from "../apps/chrome/src/shared/hosted.ts";
import { SettingsSchema } from "../apps/chrome/src/shared/types.ts";
const ready: HostedQuota = {claimable:false,granted_micros:5e6,remaining_micros:4e6,expires_at:"2100-01-01T00:00:00Z",platform_paused:false};
test("fresh installs use Hosted AI and only matching sites; saved preferences survive", () => {
  const defaults = SettingsSchema.parse({});
  assert.equal(defaults.provider, "xgoose-hosted"); assert.equal(defaults.model, "luna"); assert.equal(defaults.launcherVisibility, "skill-sites");
  const saved = SettingsSchema.parse({provider:"gemini",model:"saved-model",launcherVisibility:"always"});
  assert.equal(saved.provider,"gemini"); assert.equal(saved.model,"saved-model"); assert.equal(saved.launcherVisibility,"always");
});
test("Hosted prerequisites distinguish consent, unclaimed credit, expiry and availability", () => {
  assert.equal(hostedBlocker(ready,true),null);
  assert.match(hostedBlocker(ready,false)!, /agree/);
  assert.match(hostedBlocker({...ready,granted_micros:0,claimable:true},true)!, /Claim/);
  assert.match(hostedBlocker({...ready,expires_at:"2000-01-01"},true)!, /expired/);
  assert.match(hostedBlocker({...ready,remaining_micros:0},true)!, /credit/);
  assert.match(hostedBlocker({...ready,platform_paused:true},true)!, /paused/);
});
test("Hosted errors preserve actionable messages for the OpenAI SDK without replay", async () => {
  const response=await normalizeHostedError(Response.json({error:"too_many_requests",message:"Hosted unavailable: consent, trial balance, expiry, rate or concurrency limit",detail:{...ready,granted_micros:0,claimable:true}},{status:429,headers:{"x-request-id":"fixture"}}));
  assert.equal(response.status,429); assert.equal(response.headers.get("x-request-id"),"fixture");
  assert.match((await response.json()).error.message,/Claim your free trial/);
  const specific=await normalizeHostedError(Response.json({error:"forbidden",message:"Please review your consent."},{status:403}));
  assert.equal((await specific.json()).error.message,"Please review your consent.");
  const success=Response.json({choices:[{}]}); assert.equal(await normalizeHostedError(success),success);
});
