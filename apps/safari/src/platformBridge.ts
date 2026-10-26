import {publicReadAllowed} from "./publicReader";
let pending:Promise<void>|undefined;
export async function nativeCommand(kind:string,payload?:unknown):Promise<any>{
 if(kind==="public-read" && !publicReadAllowed((payload as any)?.pageUrl??"",(payload as any)?.url??""))throw new Error("This public API is unavailable on the current website.");
 const response=await chrome.runtime.sendNativeMessage("application",{kind,payload});
 if(!response?.ok)throw new Error(response?.error??"Open xgoose to finish setup.");
 return response.value;
}
export function prepareHost():Promise<void>{return pending??=(async()=>{
 const legacy=await chrome.storage.local.get(["xgoose.safari.migrated","xgoose.settings","xgoose.account","xgoose.skills.disabled","xgoose.skills.user","xgoose.layout","xgoose.conversations"]);
 if(!legacy["xgoose.safari.migrated"]){await nativeCommand("migrate",legacy);await chrome.storage.local.set({"xgoose.safari.migrated":true});}
 const snapshot=await nativeCommand("snapshot");
 const old=await chrome.storage.local.get("xgoose.native.revision");
 if(old["xgoose.native.revision"]!==snapshot.revision){
  await chrome.storage.local.set({...snapshot.values,"xgoose.native.revision":snapshot.revision});
 }
 // Clean up credentials left by older Safari releases only after native migration succeeded.
 if(snapshot.migrated) await chrome.storage.local.remove("xgoose.account");
})().finally(()=>{pending=undefined});}
