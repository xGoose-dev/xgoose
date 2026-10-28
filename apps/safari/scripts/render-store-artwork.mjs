// Store compositions use unmodified, real app captures. No customer sessions.
import {chromium} from '@playwright/test';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(root,'apps/safari/submission/artwork-1.8');
await mkdir(out,{recursive:true});
const logo=await readFile(resolve(root,'branding/icon.svg'),'utf8');
const data=async name=>'data:image/png;base64,'+(await readFile(resolve(out,'raw',name+'.png'))).toString('base64');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const copy={
 en:{
  research:['Give your AI<br>website skills.','Ask on the page. Research supported sites.<br>Follow the original sources.'],
  skills:['A little more<br>website savvy.','Built-in tools for the websites you use.<br>Ready to explore in Safari.'],
  provider:['Your AI.<br>Your choice.','Start with Hosted AI or bring your own key.<br>Connect the provider that works for you.'],
  home:['Start in Safari.<br>Ask on the page.','Choose your language. Connect your AI.<br>Enable xgoose and ask your first question.'],
  caption:'Actual app screens · Website content and answers vary',
  platform:'xgoose for iPhone and iPad',
 },
 zh:{
  research:['给 AI 装上<br>网站技能。','在当前网页提问，用技能搜索和阅读。<br>沿着原始链接，回到信息来源。'],
  skills:['更懂网站，<br>更会帮你。','内置常用网站的专门工具。<br>在 Safari 中，打开就能探索。'],
  provider:['你的 AI，<br>你来选择。','使用托管 AI，或连接自己的 API Key。<br>让模型选择配合你的使用习惯。'],
  home:['从 Safari 开始，<br>留在当前网页。','选择语言，连接 AI，启用扩展。<br>把第一个问题，留给正在浏览的网页。'],
  caption:'真实 App 界面 · 网站内容与 AI 回答可能变化',
  platform:'适用于 iPhone 和 iPad 的 xgoose',
 },
};
const styles=`*{box-sizing:border-box}html,body{margin:0;background:#F5F3FC}body{font-family:'Avenir Next','PingFang SC',sans-serif;color:#24203B}.sheet{position:relative;overflow:hidden;background:#F5F3FC;transform-origin:0 0}.brand{position:absolute;display:flex;align-items:center;gap:22px;font-size:62px;letter-spacing:-2.5px;font-weight:700}.brand svg{width:84px;height:84px}.copy{position:absolute;z-index:2}h1{margin:0;font-size:128px;line-height:1.08;letter-spacing:-5px;font-weight:750}p{font-size:46px;line-height:1.48;letter-spacing:-.6px;margin:32px 0 0;color:#6E657F}.accent{height:9px;width:85px;background:#FFAE57;border-radius:9px;margin-top:34px}.device{position:absolute;border:14px solid #24203B;background:#24203B;border-radius:76px;overflow:hidden;box-shadow:0 30px 70px #24203b24}.device img{display:block;width:100%;height:auto}.foot{position:absolute;font-size:27px;letter-spacing:.1px;color:#867C98}.provider{background:#24203B;color:#fff}.provider p{color:#D3CBE4}.provider .brand{color:white}.provider .foot{color:#C9BFE0}.skills{background:#fff}.skills .device{box-shadow:0 35px 85px #7357e823}.phone .brand{left:104px;top:80px}.phone .copy{left:110px;top:224px;width:1120px}.phone .device{left:202px;top:780px;width:916px}.phone .foot{left:110px;bottom:66px;font-size:27px}.phone h1{font-size:126px}.phone p{font-size:45px}.ipad .brand{left:112px;top:90px}.ipad .copy{left:128px;top:375px;width:1070px}.ipad h1{font-size:126px;line-height:1.13}.ipad p{font-size:44px;line-height:1.65;margin-top:45px}.ipad .device{left:1330px;top:170px;width:1270px;border-radius:64px;border-width:18px}.ipad .foot{left:132px;bottom:110px;font-size:29px}.platform{position:absolute;left:132px;bottom:180px;font-size:40px;letter-spacing:-.5px;font-weight:600}.phone .platform{display:none}.zh h1{letter-spacing:-5px}.zh p{letter-spacing:.3px}`;
const browser=await chromium.launch({headless:true});
const manifest={version:'1.8',source:'Real simulator captures with editorial framing',assets:[]};
try{
 for(const lang of ['en','zh']){
  for(const [device,width,height,features,displayType] of [
   ['iphone-67',1320,2868,['research','skills','provider','home'],'APP_IPHONE_67'],
   ['iphone-61',1206,2622,['research','skills','provider','home'],'APP_IPHONE_61'],
   ['ipad-13',2752,2064,['home','skills','provider'],'APP_IPAD_PRO_3GEN_129'],
  ]){
   const tablet=device.startsWith('ipad'),baseW=tablet?2752:1320,baseH=tablet?2064:2868;
   for(const [index,feature] of features.entries()){
    const filename=`${lang}-${device}-${index+1}-${feature}.png`;
    const image=await data(`${tablet?'ipad':'phone'}-${feature}-${lang}`);
    const [title,deck]=copy[lang][feature];
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const markup=`<!doctype html><html lang="${lang==='zh'?'zh-Hans':'en'}"><meta charset="utf-8"><style>${styles}</style><div class="sheet ${tablet?'ipad':'phone'} ${feature} ${lang}" style="width:${baseW}px;height:${baseH}px;transform:scale(${width/baseW})"><div class="brand">${logo}<span>xgoose</span></div><div class="copy"><h1>${title}</h1><p>${deck}</p><div class="accent"></div></div><div class="device"><img alt="Actual xgoose ${feature} screen" src="${image}"></div><div class="platform">${copy[lang].platform}</div><div class="foot">${copy[lang].caption}</div></div>`;
    await page.setContent(markup);await page.locator('img').evaluate(img=>img.decode());
    const overflow=await page.locator('.copy').evaluate(el=>el.scrollWidth>el.clientWidth);
    if(overflow)throw Error(`Copy overflow: ${filename}`);
    if(!tablet){
     const overlap=await page.evaluate(()=>document.querySelector('.copy').getBoundingClientRect().bottom+30>document.querySelector('.device').getBoundingClientRect().top);
     if(overlap)throw Error(`Copy overlaps device: ${filename}`);
    }
    await page.screenshot({path:resolve(out,filename),animations:'disabled'});await page.close();
    const bytes=await readFile(resolve(out,filename));
    manifest.assets.push({file:filename,locale:lang==='zh'?'zh-Hans':'en-US',displayType,width,height,sha256:createHash('sha256').update(bytes).digest('hex'),source:`raw/${tablet?'ipad':'phone'}-${feature}-${lang}.png`});
   }
  }
  const thumbs=[];
  for(const asset of manifest.assets.filter(a=>a.locale===(lang==='zh'?'zh-Hans':'en-US')&&a.displayType==='APP_IPHONE_67')){
   const src='data:image/png;base64,'+(await readFile(resolve(out,asset.file))).toString('base64');
   thumbs.push(`<figure style="margin:0"><img src="${src}" style="width:100%;display:block"><figcaption style="font:14px Avenir Next,sans-serif;padding:12px 0">${escape(asset.file)}</figcaption></figure>`);
  }
  const p=await browser.newPage({viewport:{width:1520,height:940},deviceScaleFactor:1});
  await p.setContent(`<style>body{margin:0;padding:30px;background:#e9e5f2}main{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}img{border-radius:8px}</style><main>${thumbs.join('')}</main>`);
  await p.screenshot({path:resolve(out,`preview-${lang}.png`),fullPage:true});await p.close();
 }
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(`Rendered ${manifest.assets.length} localized iOS store screenshots.`);
}finally{await browser.close();}
