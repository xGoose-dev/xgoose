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
test('summary reads the first 30 replies and latest 100 replies, with the original post and floor links',async()=>{
 const {skill}=fixture(300);const result=await skill.readTopicForSummary({});
 const expected=[1,...Array.from({length:30},(_,i)=>i+2),...Array.from({length:100},(_,i)=>i+201)];
 assert.equal(result.read_count,131);assert.equal(result.complete,true);
 assert.deepEqual(Array.from(result.posts,(p:any)=>p.post_number),expected);
 assert.equal(result.posts.at(-1).url,'https://linux.do/t/42/300');
});
test('short threads deduplicate overlapping windows even when deleted floors inflate the highest floor',async()=>{
 for(const count of [1,30,100,130,131]){
  const {skill}=fixture(count,900);const result=await skill.readTopicForSummary({});
  assert.equal(result.read_count,count);
  assert.equal(new Set(result.posts.map((p:any)=>p.post_number)).size,count);
  assert.equal(result.posts.at(-1).post_number,count);
 }
});
test('long threads select visible reply IDs without filling deleted-floor gaps',async()=>{
 const {skill,requests}=fixture(200,900);const result=await skill.readTopicForSummary({});
 assert.deepEqual(Array.from(result.posts,(p:any)=>p.post_number),[1,...Array.from({length:30},(_,i)=>i+2),...Array.from({length:100},(_,i)=>i+101)]);
 assert.equal(result.read_count,131);
 assert.ok(requests.filter(r=>r.includes('/posts.json')).every(r=>new URLSearchParams(r.split('?')[1]).getAll('post_ids[]').length<=20));
});
test('summary functions let the model adjust reply windows, including an empty tail',async()=>{
 const {skill}=fixture(300);
 const small=await skill.readTopicForSummary({firstReplies:2,latestReplies:3});
 assert.deepEqual(Array.from(small.posts,(p:any)=>p.post_number),[1,2,3,298,299,300]);
 const head=await skill.readTopicForSummary({firstReplies:2,latestReplies:0});
 assert.deepEqual(Array.from(head.posts,(p:any)=>p.post_number),[1,2,3]);
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
