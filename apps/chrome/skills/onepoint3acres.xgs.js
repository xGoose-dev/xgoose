// ==XGooseSkill==
// @name         onepoint3acres
// @namespace    acres
// @version      0.1.1
// @description  一亩三分地新版 API：关键词/语义搜索、版块、热帖、新帖、正文、回复、楼中楼、图片、用户 profile 和主题记录。
// @match        https://www.1point3acres.com/*
// @match        https://1point3acres.com/*
// @detect       /(^|\.)1point3acres\.com$/.test(location.hostname)
// @connect      api.1point3acres.com
// @connect      trpc.1point3acres.com
// @primary      searchThreads
// @keyword      一亩三分地
// @keyword      地里
// @keyword      面经
// @keyword      1point3acres
// @action       本页帖子 | 用 acres.getThread 读取本页正文，再用 acres.getThreadPosts 阅读回复并总结。
// ==/XGooseSkill==
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';

// Native endpoints confirmed with the user's local /Users/maxhu/play/1point3acres-mcp.
// Additional read routes cross-checked with WindustH/atp, crates/atp-1point3acres.
const API='https://api.1point3acres.com', TRPC='https://trpc.1point3acres.com/trpc/';
const cache=new Map();
const url=tid=>`https://www.1point3acres.com/home/thread/${tid}`;
function currentTid(){return Number(location.pathname.match(/(?:thread\/|thread-)(\d+)/)?.[1] || new URL(location.href).searchParams.get('tid')) || undefined;}
async function get(path,params={}){
 const target=new URL(path,API);
 for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)target.searchParams.set(k,String(v));
 const response=await fetch(target.href,{credentials:'include',headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error(`一亩三分地 HTTP ${response.status}: ${target.pathname}`);
 const data=await response.json();
 if(data.errno)throw new Error(data.msg || `API errno ${data.errno}`);
 return data;
}
async function trpc(procedure,payload){
 const item={json:payload}, values={};
 for(const [k,v] of Object.entries(payload))if(v===null)values[k]=['undefined'];
 if(Object.keys(values).length)item.meta={values};
 const data=await get(TRPC+procedure,{batch:1,input:JSON.stringify({'0':item})});
 if(data[0].error)throw new Error(data[0].error.json?.message || JSON.stringify(data[0].error));
 return data[0].result.data.json;
}
function text(raw=''){
 return new DOMParser().parseFromString(String(raw).replace(/\[\/?[a-zA-Z0-9*]+(?:=[^\]]*)?\]/g,''),'text/html').body.textContent.trim();
}
function body(raw='',key){
 const images=[];
 const marker=value=>{const src=new URL(value,location.href).href;if(!images.includes(src))images.push(src);return `[image ${images.indexOf(src)+1}]`;};
 let value=String(raw).replace(/\[img(?:=[^\]]*)?\]([\s\S]*?)\[\/img\]/gi,(_,src)=>marker(src.trim()));
 const doc=new DOMParser().parseFromString(value,'text/html');
 for(const img of doc.querySelectorAll('img')){
  const src=img.getAttribute('zoomfile')||img.getAttribute('file')||img.getAttribute('src');
  if(src&&!/smilies|smiley/.test(src))img.replaceWith(marker(new URL(src,location.href).href));else img.remove();
 }
 for(const br of doc.querySelectorAll('br'))br.replaceWith('\n');
 for(const block of doc.querySelectorAll('p,div,li'))block.append('\n');
 const visible=text(doc.body.innerHTML), locked=/需要积分高于\s*\d+|本帖内容需要|才可浏览/.test(visible);
 const result={text:visible,images,rice_locked:locked};cache.set(key,result);return result;
}
function content(raw,key,maxChars){
 const result=body(raw,key), size=maxChars??result.text.length;
 return {...result,text:result.text.slice(0,size),totalChars:result.text.length,truncated:result.text.length>size,
  readMore:result.text.length>size?`getPostText({key:"${key}",offset:${size}})`:undefined,
  readImages:result.images.length?`readImages({key:"${key}",images:[N]})`:undefined};
}
function thread(item,maxChars,preview=false){
 return {tid:item.tid,title:text(item.subject),author:text(item.author),userId:item.authorid,forumId:item.fid,forum:item.forum_name,
  postedAt:item.dateline,lastPostAt:item.lastpost,replies:item.replies,views:item.views,recommends:item.recommend_add,url:url(item.tid),
  ...content(item.message_bbcode||item.message_html||item.message||'',`${preview?'preview:':''}thread:${item.tid}`,maxChars)};
}
function post(item,tid,maxChars){
 return {pid:item.pid,tid,author:text(item.author),userId:item.authorid,postedAt:item.dateline,upvotes:item.votes?.upvote,
  replyCount:item.replies?.count??0,url:tid?`${url(tid)}?pid=${item.pid}`:undefined,
  ...content(item.message_bbcode||item.message_html||'',`post:${item.pid}`,maxChars),
  replies:(item.replies?.data||[]).map(p=>post(p,tid,maxChars))};
}
async function getThread({tid=currentTid(),maxChars}={}){const data=await get(`/api/v3/home-threads/${tid}`);return thread(data.thread,maxChars);}
async function getThreadPosts({tid=currentTid(),page=1,pageSize=20,order='time_asc',maxChars}={}){
 const data=await get(`/api/threads/${tid}/nested-posts`,{pg:page,ps:pageSize,order,sub_limit:5,with_total:1});
 return {tid,page,pageSize,total:data.total,posts:data.posts.map(p=>post(p,tid,maxChars))};
}
const id=z.number().int().positive(), page=z.number().int().positive().optional(), pageSize=z.number().int().min(1).max(50).optional(), maxChars=z.number().int().positive().optional();
const paging={page,pageSize}, reading={tid:id.optional(),maxChars};
const entry=(summary,input,handler,args={})=>fn({summary,input,handler,examples:[{args}]});
export default defineSkill({
 searchThreads:entry('新版 tRPC 搜索；返回原生 cursor，可限定版块/时间并选择关键词、语义或混合搜索。',z.object({query:z.string(),sortBy:z.enum(['relevance','dateline']).optional(),searchType:z.enum(['hybrid','keywords','semantic']).optional(),cursor:z.number().nullable().optional(),forumIds:z.array(id).optional(),days:id.optional(),maxChars}),async({query,sortBy='relevance',searchType='hybrid',cursor,forumIds,days,maxChars})=>{
  const input={query,type:searchType,days:days??null,fids:forumIds?.join(',')??null,sortBy,direction:'forward'};if(cursor!==undefined&&cursor!==null)input.cursor=cursor;
  const data=await trpc('search.search',input);return {query,nextCursor:data.cursor??null,results:data.data.map(item=>thread(item,maxChars,true))};
 },{query:'租车',searchType:'keywords'}),
 getThread:entry('读取楼主正文、图片和主题信息；支持新版和旧版页面自动识别 tid。',z.object(reading),getThread),
 getThreadPosts:entry('读取一页回复和内联楼中楼；order 支持从早到晚或从晚到早。',z.object({...reading,...paging,order:z.enum(['time_asc','time_desc']).optional()}),getThreadPosts),
 readThread:entry('一次读取楼主正文和一页回复。',z.object({...reading,...paging,order:z.enum(['time_asc','time_desc']).optional()}),async args=>({thread:await getThread(args),replies:await getThreadPosts(args)})),
 getPostReplies:entry('读取单个 pid 下的楼中楼后续分页。',z.object({pid:id,tid:id.optional(),...paging,maxChars}),async({pid,tid,page=1,pageSize=20,maxChars})=>{
  const data=await get(`/api/posts/${pid}/nested-posts`,{pg:page,ps:pageSize});return {pid,page,pageSize,total:data.total,posts:data.posts.map(p=>post(p,tid,maxChars))};
 },{pid:20501693,page:1}),
 listForums:entry('版块目录，包含父子版块 fid。',z.object({}),async()=>({forums:(await get('/api/forums')).forums})),
 listForumThreads:entry('指定版块的分页主题列表。',z.object({fid:id,...paging}),async({fid,page=1,pageSize=20})=>{
  const data=await get(`/api/forums/${fid}/threads`,{pg:page,ps:pageSize});return {fid,page,pageSize,total:data.total,threads:data.threads.map(t=>thread(t,undefined,true))};
 },{fid:124}),
 listFrontThreads:entry('首页热门或最新主题。',z.object({kind:z.enum(['hot','new']).optional(),...paging}),async({kind='hot',page=1,pageSize=20}={})=>{
  const data=await get('/api/threads',{type:kind,pg:page,ps:pageSize,with_post:1,includes:'forum_name'});return {kind,page,pageSize,total:data.total,threads:data.threads.map(t=>thread(t,undefined,true))};
 },{kind:'new'}),
 getUserProfile:entry('用户 profile、积分、用户组及统计。',z.object({uid:id}),async({uid})=>({...(await get(`/api/users/${uid}/profile`)).data,url:`https://www.1point3acres.com/bbs/home.php?mod=space&uid=${uid}&do=profile`}),{uid:702978}),
 getUserThreads:entry('用户发起的主题列表。',z.object({uid:id,...paging}),async({uid,page=1,pageSize=20})=>{
  const data=await get(`/api/users/${uid}/threads`,{pg:page,ps:pageSize,includes:'forum_name'});return {uid,page,pageSize,total:data.total,threads:data.threads.map(t=>thread(t,undefined,true))};
 },{uid:702978}),
 getPostText:entry('从已读取正文继续取文本，key 由 readMore 给出。',z.object({key:z.string(),offset:z.number().int().nonnegative().optional(),maxChars}),({key,offset=0,maxChars=6000})=>{
  const item=cache.get(key);if(!item)throw new Error('请先重新读取原主题或回复以恢复正文');const end=Math.min(item.text.length,offset+maxChars);
  return {key,text:item.text.slice(offset,end),nextOffset:end,hasMore:end<item.text.length};
 },{key:'thread:1159213',offset:4000}),
 readImages:entry('将正文 [image N] 对应的完整原图 URL 交给扩展后台。',z.object({key:z.string(),images:z.array(id)}),({key,images})=>{
  const item=cache.get(key);if(!item)throw new Error('请先重新读取原主题或回复以恢复图片');
  return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:images.map(n=>({image:n,url:item.images[n-1]}))}};
 },{key:'thread:1159213',images:[1]}),
},{instructions:'本 skill 同时适配一亩三分地新版 /home 和旧版 /bbs，使用新版 API。搜索默认只请求一页，以 nextCursor 续查。正文的 [image N] 对应独立 readImages 提示；返回 maxChars 截取结果时可用 readMore 续读。'});
