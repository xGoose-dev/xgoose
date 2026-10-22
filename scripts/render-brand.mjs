// Rasterize the vector master with Chromium. No external fonts or design services.
import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const svg=await readFile(resolve(root,'branding/icon.svg'),'utf8');
const browser=await chromium.launch({headless:true});
try {
 for(const size of [16,32,48,96,128,512]) {
  const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
  const dest=size===512?resolve(root,'docs/store/icon-512.png'):resolve(root,`apps/chrome/static/images/icon-${size}.png`);
  await page.screenshot({path:dest,omitBackground:true});await page.close();
 }
} finally {await browser.close();}
