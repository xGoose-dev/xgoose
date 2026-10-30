import {build} from 'esbuild';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,cpSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),chrome=resolve(root,'../chrome'),out=resolve(root,'dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const replacements=new Map([[resolve(chrome,'src/background/account.ts'),resolve(root,'src/account.ts')],[resolve(chrome,'src/shared/platformBridge.ts'),resolve(root,'src/platformBridge.ts')]]);
const adapter={name:'safari-native-adapters',setup(b){b.onResolve({filter:/^(\.|@\/)/},args=>{
 const p=args.path.startsWith('@/')?resolve(chrome,'src',args.path.slice(2)):resolve(args.resolveDir,args.path);
 const replacement=replacements.get(p.endsWith('.ts')?p:p+'.ts');if(replacement)return {path:replacement};
});}};
for(const [entry,name] of [['background/index.ts','background'],['content/index.ts','content'],['page/pageBridgeEntry.ts','pageBridge'],['page/skillRuntimeEntry.ts','skillRuntime']]){
 await build({entryPoints:[name==='content'?resolve(root,'src/content.ts'):name==='pageBridge'?resolve(root,'src/page.ts'):resolve(chrome,'src',entry)],outfile:resolve(out,name+'.js'),bundle:true,format:'iife',platform:'browser',target:'safari18',minify:true,legalComments:'none',banner:{js:'globalThis.chrome = globalThis.browser ?? globalThis.chrome;'},tsconfig:resolve(chrome,'tsconfig.json'),define:{__XGOOSE_PLATFORM__:'"safari"'},plugins:[adapter]});
}
await build({entryPoints:[resolve(root,'src/popup.ts')],outfile:resolve(out,'popup.js'),bundle:true,target:'safari18'});
execFileSync(process.execPath,[resolve(chrome,'scripts/build-skills.mjs')],{stdio:'inherit'});
cpSync(resolve(chrome,'dist/skills'),resolve(out,'skills'),{recursive:true});
// Product help must describe Safari's shipped capabilities, never Chrome setup.
const registry=JSON.parse(readFileSync(resolve(out,'skills/registry.json'),'utf8')).filter(s=>s.name!=='xgoose-guide');
rmSync(resolve(out,'skills/xgoose-guide.xgs.js'),{force:true});
// A navigation between the fixed permission check and file injection must not
// run an old document's packaged script in its replacement document.
for(const file of ['skillRuntime.js',...registry.map(s=>s.filePath)]){
 const path=resolve(out,file),source=readFileSync(path,'utf8');
 const wrapped=`;(function(){const p=globalThis.__xgoosePackagedPermit;if(!p||p.nonce!==document.documentElement.dataset.xgooseDocument||!p.paths.includes(${JSON.stringify(file)}))return;\n${source}\n})();`;
 writeFileSync(path,wrapped);
 const entry=registry.find(s=>s.filePath===file);if(entry)entry.sha=createHash('sha256').update(wrapped).digest('hex');
}
writeFileSync(resolve(out,'skills/registry.json'),JSON.stringify(registry,null,2));
cpSync(resolve(chrome,'static/images'),resolve(out,'images'),{recursive:true});
for(const file of ['agent.html','agent.css'])cpSync(resolve(chrome,'static',file),resolve(out,file));
for(const f of ['manifest.json','popup.html','popup.css'])cpSync(resolve(root,'static',f),resolve(out,f));
const manifest=JSON.parse(readFileSync(resolve(out,'manifest.json'),'utf8'));
if(typeof manifest.description!=='string'||manifest.description.length>112)throw new Error('Safari manifest description must contain at most 112 characters.');
cpSync(resolve(chrome,'static/third-party-notices.txt'),resolve(out,'third-party-notices.txt'));
// Native settings can display all bundled skills before Safari has ever run.
writeFileSync(resolve(root,'Native/Shared/skills.json'),readFileSync(resolve(out,'skills/registry.json')));
console.log('Safari resources ready:',out);
