// iOS derivatives of the same vector master used by the browser stores.
import {chromium} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const assets = resolve(root, 'apps/safari/Native/App/Assets.xcassets');
const master = await readFile(resolve(root, 'branding/icon.svg'), 'utf8');
const browser = await chromium.launch({headless:true});
async function render(svg, size, path, opaque) {
  const page = await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  try {
    await page.setContent(`<style>html,body{margin:0;background:${opaque?'#7357E8':'transparent'}}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({path,omitBackground:!opaque});
  } finally { await page.close(); }
}
try {
  // Apple applies the icon mask. Full bleed, no baked-in rounded corners/alpha.
  const full = master.replace('x="8" y="8" width="112" height="112" rx="30"', 'width="128" height="128"');
  const variants = {
    'ios-marketing.png':full,
    'ios-marketing-dark.png':full.replace('#7357E8','#30215F'),
    'ios-marketing-tinted.png':full.replace('#7357E8','#282828').replace('#24203B','#111111').replace('#FFAE57','#D8D8D8').replace('#C9BFFF','#BBBBBB'),
  };
  for (const [name,svg] of Object.entries(variants)) await render(svg,1024,resolve(assets,'AppIcon.appiconset',name),true);
  for (const [name,size] of [['logo.png',128],['logo@2x.png',256],['logo@3x.png',384]]) await render(master,size,resolve(assets,'LargeIcon.imageset',name),false);
  await writeFile(resolve(assets,'AccentColor.colorset/Contents.json'),JSON.stringify({colors:[
    {idiom:'universal',color:{'color-space':'srgb',components:{red:'0.451',green:'0.341',blue:'0.910',alpha:'1.000'}}},
    {idiom:'universal',appearances:[{appearance:'luminosity',value:'dark'}],color:{'color-space':'srgb',components:{red:'0.612',green:'0.522',blue:'1.000',alpha:'1.000'}}},
  ],info:{author:'xcode',version:1}},null,2)+'\n');
  console.log('Rendered iOS icons and native brand marks from branding/icon.svg');
} finally {await browser.close();}
