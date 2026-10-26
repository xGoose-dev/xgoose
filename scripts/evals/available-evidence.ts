/** Optional live-model smoke test; uses only synthetic website evidence. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createAgent} from '../../packages/core/src/createAgent.ts';
const openai=process.argv.includes('--openai');
const apiKey=openai?process.env.OPENAI_API_KEY:process.env.GEMINI_API??process.env.GEMINI_API_KEY;
if(!apiKey)throw new Error('Set the selected provider API key for the optional live evaluation.');
const model=openai?'gpt-6-luna':process.argv.includes('--flash')?'gemini-2.5-flash':'gemini-2.5-pro';
const fixtures=[
 {name:'partial-list-correct-counter',question:'最近24小时回复高于100的帖子有哪些？',data:{search:{httpStatus:403},origin:'https://forum.example',topic_list:{more_topics_url:'/latest?page=3',topics:[{id:42,title:'Community model discussion',url:'https://forum.example/t/42',created_at:'2026-10-26T14:39:34Z',posts_count:168,reply_count:2,total_replies:167}]},coverage:'Only three recent list pages were read. More pages exist.'},check:(text:string)=>text.includes('/t/42')&&/167/.test(text)},
 {name:'partial-two-sources',question:'这个网站上大家怎么看模型的速度？',data:{sources:[{url:'https://forum.example/t/51',text:'User A reports faster first output, but inconsistent performance at peak hours.'},{url:'https://forum.example/t/52',text:'User B reports slower long-context responses.'}],next_page:{httpStatus:429},coverage:'Two discussions read; not a representative survey.'},check:(text:string)=>text.includes('/t/51')&&text.includes('/t/52')},
 {name:'no-confirmed-match',question:'列出最近一天回复超过100的帖子。',data:{topics:[{title:'Small discussion',url:'https://forum.example/t/61',total_replies:8}],coverage:'One page read; older pages unavailable.'},check:(text:string)=>/(?:已读|已查看|这一页|这页|当前|可访问|部分|无法确认|不能断定|不代表|未能覆盖|页面|一页|page|partial|available)/i.test(text)&&!/超过100[^。\n]{0,20}(?:Small discussion|\/t\/61)/.test(text)},
];
const results=[];
for(const fixture of fixtures){
 const bundle=createAgent({settings:{provider:openai?'openai-compat':'gemini',model,baseUrl:openai?'https://api.openai.com':'https://generativelanguage.googleapis.com',apiKey,thinking:false},fetchImpl:fetch,tools:[],reminder:'Current page: https://forum.example. Current time: 2026-10-26T18:00:00Z. Source data below has already been retrieved with tools; answer using these available results.'});
 const result=await bundle.agent.stream({messages:[{role:'user',content:fixture.question},{role:'assistant',content:[{type:'tool-call',toolName:'read_page',toolCallId:'already-read',input:{}}]},{role:'tool',content:[{type:'tool-result',toolName:'read_page',toolCallId:'already-read',output:{type:'json',value:fixture.data}}]}]});
 const errors=[];for await(const event of result.fullStream)if(event.type==='error')errors.push(event.error);
 const snapshot=await result.response;const text=snapshot.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text)).join('\n');
 results.push({name:fixture.name,passed:!errors.length&&!!text&&fixture.check(text),text,errors});
}
await mkdir('artifacts/evals',{recursive:true});await writeFile(`artifacts/evals/available-evidence-${model}.json`,JSON.stringify({model,syntheticOnly:true,results},null,2)+'\n');
console.log(JSON.stringify({model,syntheticOnly:true,results}));
if(results.some(result=>!result.passed))process.exitCode=1;
