// Compose store artwork around unmodified screenshots of the actual extension.
// Refresh docs/store/*-raw.png from a local browser when the product UI changes.
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const svg=await readFile(resolve(root,'branding/icon.svg'),'utf8');
const png=async name=>'data:image/png;base64,'+(await readFile(resolve(root,'docs/store',name))).toString('base64');
const browser=await chromium.launch({headless:true});
async function render(name,width,height,body,extra=''){
 const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
 await p.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#fff;color:#24203b;font-family:Arial,Helvetica,sans-serif}h1,p{margin:0}h1{letter-spacing:-.045em}svg{display:block} ${extra}</style>${body}`);
 await p.locator('img').evaluateAll(async images=>{await Promise.all(images.map(im=>im.decode()));});
 await p.screenshot({path:resolve(root,'docs/store',name),type:'png'});await p.close();
}
try{
 await render('01-research.png',1280,800,`<img src="${await png('research.png')}" style="position:absolute;inset:0;width:1280px;height:800px"><section style="position:absolute;inset:0 auto 0 0;width:620px;background:#fff;border-right:1px solid #e4e0f1;padding:56px 60px"><div style="display:flex;align-items:center;gap:12px;font-size:25px;font-weight:700"><div style="width:55px">${svg}</div>xgoose</div><h1 style="font-size:52px;line-height:1.08;margin-top:126px">Research the page.<br>Keep the sources.</h1><p style="font-size:21px;line-height:1.6;margin-top:26px;max-width:400px;color:#686279">Ask questions where you browse. Use website skills to search and read, with links back to the original topics.</p><div style="position:absolute;bottom:56px;left:60px;font-size:15px;color:#686279">Real extension session on uscardforum</div></section>`);
 for(const [id,title,subtitle] of [['skills','Choose the skills your assistant can use.','Review the source. Enable or disable each installed skill.'],['email','An email. A confirmation. You’re in.','Sign in from the extension. No password or separate registration.']]){
  await render(id==='skills'?'02-skills.png':'03-email.png',1280,800,`<header style="height:160px;padding:34px 52px;border-bottom:1px solid #ded8f1;background:#f1eeff"><h1 style="font-size:38px;line-height:1.15;max-width:1060px">${title}</h1><p style="font-size:18px;color:#686279;margin-top:15px">${subtitle}</p><div style="position:absolute;right:38px;top:35px;width:75px">${svg}</div></header><img src="${await png(id+'-raw.png')}" style="display:block;width:1280px;height:640px">`);
 }
 await render('promo-small.png',440,280,`<div style="position:absolute;left:26px;top:24px;width:88px">${svg}</div><p style="position:absolute;left:128px;top:53px;font-size:32px;font-weight:700;letter-spacing:-1px">xgoose</p><h1 style="position:absolute;left:34px;top:137px;font-size:34px;line-height:1.08">AI, right on your page.</h1><p style="position:absolute;left:34px;top:230px;font-size:15px;color:#686279">Website skills. Your provider.</p>`,'body{background:#f1eeff}');
 for(const [name,w,h] of [['promo-marquee.png',1400,560],['social.png',1200,630]]){
  await render(name,w,h,`<div style="position:absolute;left:64px;top:54px;display:flex;align-items:center;gap:16px;font-size:31px;font-weight:700"><div style="width:70px">${svg}</div>xgoose for Chrome</div><h1 style="position:absolute;left:72px;top:220px;font-size:64px;line-height:1.08;max-width:760px">An AI assistant.<br>Right on your page.</h1><p style="position:absolute;left:76px;bottom:60px;font-size:23px;color:#686279">Website skills. Source-linked answers. Your provider.</p><div style="position:absolute;right:60px;top:160px;width:${w===1200?240:320}px">${svg}</div>`,'body{background:#f1eeff}');
 }
}finally{await browser.close();}
