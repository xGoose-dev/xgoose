import { send } from "@/shared/messages";
import { skillUrlActive } from "@/shared/patterns";
export async function showRecommendations(){
  try{
    const [catalog,installed]=await Promise.all([send("sw:skill_catalog",undefined),send("sw:list_skills",undefined)]);
    const matches=catalog.filter(s=>!installed.some(i=>i.name===s.name)&&skillUrlActive({url:location.href,matches:s.matches,include:s.include,exclude:s.exclude}));
    if(!matches.length)return;
    const root=document.querySelector("#xgoose-root")?.shadowRoot;if(!root)return;
    const button=document.createElement("button");button.textContent=`此网站有 ${matches.length} 个可用 skills · 查看并安装`;
    button.className="skill-recommendations";button.style.cssText="margin:8px;padding:8px;border-radius:8px;cursor:pointer";
    button.addEventListener("click",()=>{void send("sw:open_skill_catalog",{slugs:matches.map(s=>s.slug)});});
    root.querySelector(".skills-bar")?.append(button);
  }catch{/* Cached catalog failure never blocks the agent. */}
}
