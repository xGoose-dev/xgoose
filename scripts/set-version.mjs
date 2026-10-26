// Change only Chrome release versions, preserving shared package versions.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const version=process.argv[2];
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version??'')||version==='0.0.0'||version.split('.').some(n=>Number(n)>65535)){
  throw new Error('Usage: node scripts/set-version.mjs 0.2.9 (numeric Chrome version)');
}
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['package.json','apps/chrome/package.json','apps/chrome/static/manifest.json','package-lock.json'];
const docs=await Promise.all(files.map(async file=>[file,JSON.parse(await readFile(resolve(root,file),'utf8'))]));
for(const [file,doc] of docs){
  doc.version=version;
  if(file==='package-lock.json'){
    doc.packages[''].version=version;
    doc.packages['apps/chrome'].version=version;
  }
}
for(const [file,doc] of docs)await writeFile(resolve(root,file),JSON.stringify(doc,null,2)+'\n');
console.log(`Chrome release version set to ${version}.`);
