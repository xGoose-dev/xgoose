import { apiFetch } from "@/shared/account";
import { parseSkillFile } from "@xgoose/skill-runtime/header";
import { editSkillFromSource, getUserSkillCode, saveUserSkill } from "./skillRegistry";
export interface CatalogSkill {id:string;authorId:string;slug:string;name:string;namespace:string;description:string;version:string;matches:string[];include:string[];exclude:string[];dependencies:string[]}
export async function skillCatalog():Promise<CatalogSkill[]> {
  const key="xgoose.skill-catalog-v1",stored=(await chrome.storage.local.get(key))[key] as {at:number;items:CatalogSkill[]}|undefined;
  if(stored&&Date.now()-stored.at<3600000)return stored.items;
  try {
    const response=await apiFetch<{version:number;items:CatalogSkill[]}>("/skills/catalog");
    if(!response.ok)throw new Error(response.error);
    if(response.data.version!==1||!Array.isArray(response.data.items))throw new Error("Unsupported catalog");
    await chrome.storage.local.set({[key]:{at:Date.now(),items:response.data.items}});return response.data.items;
  }catch(error){if(stored)return stored.items;throw error;}
}
async function sha(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,"0")).join("");}
export async function installCatalogSkill(slug:string,version:string,visiting=new Set<string>()):Promise<void>{
  if(visiting.has(slug))throw new Error("Skill dependency cycle");
  visiting.add(slug);
  const catalog=await skillCatalog(),item=catalog.find(s=>s.slug===slug&&s.version===version);
  if(!item)throw new Error("The catalog version changed. Refresh and review the update.");
  for(const ref of item.dependencies){
    const name=ref.replace(/@[^@]+$/,""),dep=catalog.find(s=>s.name===name||s.namespace===name);
    if(!dep)throw new Error(`Missing dependency: ${ref}`);
    if(!await getUserSkillCode(dep.name))await installCatalogSkill(dep.slug,dep.version,new Set(visiting));
  }
  const response=await apiFetch<any>(`/skills/${encodeURIComponent(slug)}/install?version=${encodeURIComponent(version)}`);
  if(!response.ok)throw new Error(response.error);
  const pkg=response.data,source=pkg.skill?.source,bundle=pkg.skill?.bundled;
  if(typeof source!=="string"||typeof bundle!=="string"||await sha(source)!==pkg.source_sha256||await sha(bundle)!==pkg.bundle_sha256)throw new Error("Skill package digest mismatch");
  if(pkg.identity?.authorId!==item.authorId||pkg.identity?.skillId!==item.id||pkg.version!==version)throw new Error("Skill identity or version mismatch");
  const header=parseSkillFile(source).header;
  if(header.name!==item.name||header.namespace!==item.namespace||header.version!==version)throw new Error("Skill metadata does not match its source");
  const existing=await getUserSkillCode(item.name);
  if(existing?.identity&&(existing.identity.authorId!==item.authorId||existing.identity.skillId!==item.id))throw new Error("An installed skill with that name has a different author");
  const edited=await editSkillFromSource({name:item.name,source});if(!edited.ok)throw new Error(edited.error);
  const installed=(await getUserSkillCode(item.name))!;
  await saveUserSkill({...installed,identity:pkg.identity,sourceSha:pkg.source_sha256,bundleSha:await sha(installed.bundled),readOnly:false});
}
