import {translate,getLocale} from "@/shared/locale";
import {track,failureReason} from "@/shared/analytics";
import { send } from '@/shared/messages';
import type { SkillUpdate, UpdateState } from '@/background/skillUpdates';
export function mountSkillUpdates() {
  const section=document.createElement('div');section.className='skill-updates';section.id='skillUpdates';
  section.innerHTML='<div class="setup-credit"><strong>Skill updates</strong><button class="btn secondary compact" id="checkSkillUpdates">Check for updates</button></div><p class="hint" role="status" id="skillUpdateStatus">Checking installed versions…</p><div id="skillUpdateList"></div><p class="hint">Checks daily. Updates are installed only when you choose. Local files and pasted skills can be updated by importing a new version.</p>';
  document.querySelector('#section-skills .hint')!.after(section);
  const status=section.querySelector<HTMLElement>('#skillUpdateStatus')!,list=section.querySelector<HTMLElement>('#skillUpdateList')!,check=section.querySelector<HTMLButtonElement>('#checkSkillUpdates')!;
  let busy=false;
  function render(state:UpdateState) {
    list.replaceChildren();
    status.textContent=state.updates.length?`${state.updates.length} skill update${state.updates.length===1?'':'s'} available.`:state.checkedAt?'All catalog skills are up to date.':'No update check yet.';
    if(state.checkedAt)status.textContent+=` Last checked ${new Date(state.checkedAt).toLocaleString(getLocale())}.`;
    for(const update of state.updates) {
      const row=document.createElement('div');row.className='skill-update-item';
      const info=document.createElement('div'),title=document.createElement('strong');title.textContent=update.name;
      const versions=document.createElement('p');versions.className='hint';versions.textContent=`${update.currentVersion} → ${update.version}${update.unlinked?' · Not linked to catalog':''}${update.localModified?' · Contains local edits':''}`;
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Review update';
      const scope=document.createElement('p');scope.className='hint';scope.textContent=`Sites: ${update.matches.join(', ')||'None'}. Dependencies: ${update.dependencies.join(', ')||'None'}.`;
      const source=document.createElement('a');source.href=`https://xgoose.org/skill/?slug=${encodeURIComponent(update.slug)}`;source.target='_blank';source.rel='noopener';source.textContent='View skill and source ↗';
      details.append(summary,scope,source);info.append(title,versions,details);
      const button=document.createElement('button');button.className='btn secondary compact';button.textContent=update.unlinked?`Link and update ${update.name}`:`Update ${update.name}`;
      button.addEventListener('click',()=>void install(update));row.append(info,button);list.append(row);
    }
  }
  async function refresh(force:boolean) {
    if(busy)return;busy=true;check.disabled=true;
    status.textContent='Checking for updates…';
    try {render(await send('sw:skill_updates',{check:force}));}
    catch(error){status.textContent=`Could not check for updates: ${error instanceof Error?error.message:String(error)}. Try again.`;}
    finally{busy=false;check.disabled=false;}
  }
  async function install(update:SkillUpdate) {
    if(busy)return;
    const question=translate("Update {name} from {current} to {version}?").replace("{name}",update.name).replace("{current}",update.currentVersion).replace("{version}",update.version);
    const linkWarning=update.unlinked?" "+translate("This links your local skill to the reviewed marketplace entry and installs that version."):"";
    const warning=update.localModified?" "+translate("This replaces your local edits. Export or copy your source first if you want to keep them."):"";
    if(!confirm(question+linkWarning+warning+"\n"+translate("The new version will run on:")+" "+(update.matches.join(', ')||translate("No matching sites"))+". "+translate("Review the source before updating.")))return;
    const started=Date.now();track("skill_update_started",{skill:update.name,version:update.version});
    busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=`Updating ${update.name}…`;
    try{await send('sw:update_skill',update);track('skill_update_succeeded',{skill:update.name,version:update.version,duration_ms:Date.now()-started});render(await send('sw:skill_updates',{}));status.textContent=`${update.name} updated to ${update.version}. ${status.textContent}`;}
    catch(error){track("skill_update_failed",{skill:update.name,reason:failureReason(error),duration_ms:Date.now()-started});status.textContent=`Update failed: ${error instanceof Error?error.message:String(error)}. Your installed version is still available.`;}
    finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  check.addEventListener('click',()=>void refresh(true));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['xgoose.skills.updates-v1']&&!busy)render(changes['xgoose.skills.updates-v1'].newValue as UpdateState);});
  void refresh(true);
}
