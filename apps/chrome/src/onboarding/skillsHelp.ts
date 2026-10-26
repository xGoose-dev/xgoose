import {initializeLocale} from "@/shared/locale";
import {send} from "@/shared/messages";
import {track} from "@/shared/analytics";
void initializeLocale(document.body);
document.querySelector<HTMLButtonElement>("#openStarterSkill")!.addEventListener("click",async()=>{
 const status=document.querySelector<HTMLElement>("#starterSkillStatus")!;
 try{const response=await fetch(chrome.runtime.getURL("starter-skill.xgs.js"));if(!response.ok)throw new Error("Starter could not be loaded.");const source=await response.text();const result=await send("sw:open_install_page",{source});if(!result.ok)throw new Error(result.error);track("onboarding_starter_opened");}catch(error){status.textContent=error instanceof Error?error.message:String(error);}
});
