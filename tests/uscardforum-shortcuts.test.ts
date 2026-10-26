import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
const loadSource=(name:string)=>readFileSync(new URL(`../apps/chrome/skills/${name}.xgs.js`,import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace('export default defineSkill','globalThis.skill = defineSkill');
function fixture(count=10, highest=count, name='discourse-forum', origin='https://linux.do') {
 const posts=Array.from({length:count},(_,i)=>({id:i+1,post_number:i+1,username:'reader',cooked:`Floor ${i+1} evidence`,topic_id:42}));
 const requests:string[]=[];
 const context:any={z,Headers,URLSearchParams,Math,Map,Set,Number,Date,setTimeout:(done:()=>void)=>{done();return 0;},location:{origin,pathname:'/t/example/42'},
  document:{querySelector:()=>null,createElement(){return {innerHTML:'',get textContent(){return this.innerHTML;}};}},
  defineSkill(spec:any,options:any){context.actions=options.actions;return Object.fromEntries(Object.entries(spec).map(([key,value]:any)=>[key,value.handler]));},fn:(x:any)=>x,
  window:{xgoose:{skills:{discourse:{getTopic:async({id}:any)=>({posts:[{text:`Read topic ${id}`,url:`https://www.uscardforum.com/t/${id}/1`}]}),searchTopics:async()=>({topics:[{id:1,title:'Deal',created_at:'2026-10-22'}]})}}}},
  fetch:async(path:string)=>{requests.push(path);return {ok:true,json:async()=>{
   if(path.startsWith('/latest.json'))return {topic_list:{topics:Array.from({length:12},(_,i)=>({id:i+1,title:`Topic ${i+1}`,created_at:`2026-10-${String(i+1).padStart(2,'0')}`,last_posted_at:'2026-10-23'}))}};
   if(path.includes('/posts.json')){const ids=new URLSearchParams(path.split('?')[1]).getAll('post_ids[]').map(Number);return {post_stream:{posts:posts.filter(p=>ids.includes(p.id))}};}
   return {id:42,title:'Example',highest_post_number:highest,posts_count:count,post_stream:{stream:posts.map(p=>p.id),posts:posts.slice(0,5)}};
  }};},};
 runInNewContext(loadSource(name),context);return {skill:context.skill,context,requests};
}
test('generic Discourse owns the three English actions and uscf adds only deals',()=>{
 const generic=fixture().context;assert.deepEqual(Array.from(generic.actions,(a:any)=>a.label),['Latest topics','Summarize this thread','Surprise me randomly']);
 const specific=fixture(10,10,'uscardforum').context;assert.deepEqual(Array.from(specific.actions,(a:any)=>a.label),['最近羊毛']);
 assert.equal(specific.skill.readTopicForSummary,undefined);
});
test('summary reads every visible floor through 300, with original floor links',async()=>{
 const {skill}=fixture(300);const result=await skill.readTopicForSummary({});
 assert.equal(result.read_count,300);assert.equal(result.complete,true);assert.equal(result.selection,'all visible posts');
 assert.equal(result.posts[299].post_number,300);assert.equal(result.posts[299].url,'https://linux.do/t/42/300');
});
test('long threads select the main post and latest 30, including gaps from deleted floors',async()=>{
 const {skill}=fixture(100,900);const result=await skill.readTopicForSummary({});
 assert.equal(result.read_count,31);assert.equal(result.posts[0].post_number,1);assert.equal(result.posts[1].post_number,71);assert.equal(result.posts[30].post_number,100);
});
test('random recommendations return five unique read topics with jump links',async()=>{
 const {skill}=fixture();const result=await skill.getRecentTopics({kind:'random'});
 assert.equal(result.topics.length,5);assert.equal(new Set(result.topics.map((t:any)=>t.id)).size,5);
 for(const topic of result.topics){assert.ok(topic.posts[0].text);assert.match(topic.url,/^https:\/\/linux.do\/t\/\d+$/);}
});
test('new topics order by creation and deal results deduplicate',async()=>{
 const {skill}=fixture();const latest=await skill.getRecentTopics({kind:'new'});assert.equal(latest.topics[0].id,12);
 const specific=fixture(10,10,'uscardforum','https://www.uscardforum.com').skill;
 const deals=await specific.getRecentDeals({});assert.equal(deals.topics.length,1);
 assert.equal(deals.topics[0].url,'https://www.uscardforum.com/t/1');
});

test('generic thread summary supports topic URLs without a slug and rejects list pages',async()=>{
 const {skill,context}=fixture(); context.location.pathname='/t/42';
 assert.equal((await skill.readTopicForSummary({})).read_count,10);
 context.location.pathname='/latest'; assert.equal((await skill.readTopicForSummary({})).status,'not_a_topic');
});
