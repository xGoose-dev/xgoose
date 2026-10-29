import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
const source=readFileSync(new URL('../apps/chrome/skills/reddit.xgs.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default defineSkill','globalThis.skill=defineSkill').replace('minIntervalMs:1100','minIntervalMs:0');
function fixture(respond:(url:URL)=>unknown){
 const requests:URL[]=[],store=new Map();const context:any={z,URL,URLSearchParams,Headers,Response,Request,AbortController,AbortSignal,TextEncoder,TextDecoder,structuredClone,setTimeout,clearTimeout,location:new URL('https://www.reddit.com/'),navigator:{},localStorage:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)},fn:(spec:any)=>spec,defineSkill:(spec:any)=>Object.fromEntries(Object.entries(spec).map(([key,value]:any)=>[key,value.handler])),fetch:async(url:string)=>{const u=new URL(url);requests.push(u);return new Response(JSON.stringify(respond(u)),{headers:{'content-type':'application/json'}});}};
 runInNewContext(source,context);return {skill:context.skill,requests};
}
const listing=(children:unknown[],after:string|null=null)=>({kind:'Listing',data:{children,after,before:null}});
test('Reddit user comments preserve body, reply relationship, score and pagination',async()=>{
 const {skill,requests}=fixture(()=>listing([{kind:'t1',data:{id:'abc',name:'t1_abc',body:'A full comment',author:'reader',score:7,parent_id:'t1_parent',link_id:'t3_post',permalink:'/r/test/comments/post/title/abc/'}}],'t1_next'));
 const r=await skill.getUserComments({name:'reader',sort:'top',t:'month',after:'t1_previous'});
 assert.equal(requests[0].pathname,'/user/reader/comments.json');assert.equal(requests[0].searchParams.get('after'),'t1_previous');assert.equal(requests[0].searchParams.get('t'),'month');assert.equal(r.sources[0].text,'A full comment');assert.equal(r.sources[0].score,7);assert.equal(r.sources[0].parent_id,'t1_parent');assert.equal(r.sources[0].link_id,'t3_post');assert.equal(r.after,'t1_next');
 await skill.getUserPosts({name:'reader'});assert.equal(requests[1].pathname,'/user/reader/submitted.json');
});
test('Reddit wiki revisions use flat children and WikiRevision cursors',async()=>{
 const {skill,requests}=fixture(()=>listing([{id:'revision',page:'index',timestamp:1700000000,author:{data:{name:'editor'}},reason:'Update'}],'WikiRevision_next'));
 const r=await skill.getWikiHistory({subreddit:'test',after:'WikiRevision_previous'});
 assert.equal(requests[0].pathname,'/r/test/wiki/revisions/index.json');assert.equal(requests[0].searchParams.get('after'),'WikiRevision_previous');assert.equal(r.revisions[0].author,'editor');assert.equal(r.revisions[0].publishedAt,'2023-11-14T22:13:20.000Z');assert.equal(r.after,'WikiRevision_next');assert.match(r.revisions[0].url,/v=revision$/);
});
