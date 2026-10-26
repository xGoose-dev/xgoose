import { skillCatalog, installCatalogSkill } from './catalog';
import { listSkillsWithEnabled, getUserSkillCode } from './skillRegistry';
import identities from '@/shared/builtinCatalog.json';
import { newerVersion } from '@/shared/skillVersions';
export const UPDATE_KEY = 'xgoose.skills.updates-v1';
const ALARM = 'xgoose-skill-updates';
export interface SkillUpdate {
  name:string; slug:string; currentVersion:string; version:string; localModified:boolean;
  matches:string[]; dependencies:string[]; fingerprint:string;
}
export interface UpdateState { checkedAt:number; updates:SkillUpdate[] }
async function hash(s:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''); }
let checking:Promise<UpdateState>|undefined;
async function scan():Promise<UpdateState> {
  const catalog=await skillCatalog(true), installed=await listSkillsWithEnabled(), updates:SkillUpdate[]=[];
  for(const skill of installed) {
    const user=await getUserSkillCode(skill.name);
    // Local imports/edits without a catalog identity must not silently adopt an author.
    const identity=user ? user.identity : (identities as Record<string,{authorId:string;skillId:string}>)[skill.name];
    if(!identity)continue;
    const item=catalog.find(i=>i.id===identity.skillId&&i.authorId===identity.authorId&&i.name===skill.name&&i.namespace===skill.namespace);
    if(!item||!newerVersion(item.version,skill.version))continue;
    const fingerprint=user ? await hash(user.source) : skill.sha;
    updates.push({name:skill.name,slug:item.slug,currentVersion:skill.version,version:item.version,
      localModified:!!user&&(!user.sourceSha||user.sourceSha!==fingerprint),matches:item.matches,dependencies:item.dependencies,fingerprint});
  }
  const state={checkedAt:Date.now(),updates};
  await chrome.storage.local.set({[UPDATE_KEY]:state});
  await chrome.action.setBadgeBackgroundColor({color:'#2563eb'});
  await chrome.action.setBadgeText({text:updates.length?String(updates.length):''});
  await chrome.action.setTitle({title:updates.length?`xgoose · ${updates.length} skill updates available`:'xgoose'});
  return state;
}
export function checkSkillUpdates():Promise<UpdateState> {
  if(!checking)checking=scan().finally(()=>{checking=undefined;});
  return checking;
}
export async function skillUpdateState():Promise<UpdateState> {
  return ((await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] as UpdateState|undefined)??{checkedAt:0,updates:[]};
}
let updating=false;
export async function updateSkill(request:SkillUpdate):Promise<void> {
  if(updating)throw new Error('Another skill update is running. Try again when it finishes.');
  updating=true;
  try {
    const state=await checkSkillUpdates();
    const current=state.updates.find(i=>i.name===request.name&&i.version===request.version);
    if(!current||current.fingerprint!==request.fingerprint)throw new Error('This skill changed. Check for updates and review it again.');
    await installCatalogSkill(current.slug,current.version,new Set(),async()=>{
      const skill=(await listSkillsWithEnabled()).find(s=>s.name===current.name);
      const user=await getUserSkillCode(current.name);
      const fingerprint=user ? await hash(user.source) : skill?.sha;
      if(!skill||skill.version!==current.currentVersion||fingerprint!==current.fingerprint)throw new Error('This skill was edited while downloading. Review the update again.');
    });
    // A refresh failure after a successful install must not report installation failure.
    const remaining=state.updates.filter(i=>i.name!==current.name);
    await chrome.storage.local.set({[UPDATE_KEY]:{...state,updates:remaining}});
    await chrome.action.setBadgeText({text:remaining.length?String(remaining.length):""});
    await checkSkillUpdates().catch(()=>{});
  } finally {updating=false;}
}
export function installSkillUpdateChecks() {
  const safeCheck=()=>void checkSkillUpdates().catch(()=>{});
  chrome.runtime.onInstalled.addListener(safeCheck);
  chrome.runtime.onStartup.addListener(safeCheck);
  // MV3 workers restart often; recreating the alarm on each wake would postpone it forever.
  void chrome.alarms.get(ALARM).then(alarm=>{if(!alarm)return chrome.alarms.create(ALARM,{periodInMinutes:1440});});
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)safeCheck();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['xgoose.skills.user'])safeCheck();});
}
