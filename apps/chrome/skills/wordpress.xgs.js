// ==XGooseSkill==
// @name         wordpress
// @namespace    wordpress
// @version      0.1.1
// @description  WordPress 网站自动识别：文章/页面搜索、正文与图片、评论、作者、分类标签、自定义内容类型和 REST 能力发现。
// @match        https://*/*
// @match        http://*/*
// @detect       !!document.querySelector('link[rel="https://api.w.org/"],meta[name="generator"][content^="WordPress" i],script[src*="/wp-includes/"],link[href*="/wp-content/themes/"]')
// @run-at       document_idle
// @connect      <self>
// @primary      searchPosts
// @keyword      wordpress
// @keyword      wp-json
// @keyword      blog
// @keyword      博客
// ==/XGooseSkill==
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';

// WordPress REST discovery and resource schemas:
// https://developer.wordpress.org/rest-api/using-the-rest-api/discovery/
// https://developer.wordpress.org/rest-api/reference/
function discover() {
 const link=document.querySelector('link[rel="https://api.w.org/"]');
 const generator=document.querySelector('meta[name="generator"]')?.content || '';
 const asset=document.querySelector('script[src*="/wp-includes/"],link[href*="/wp-content/themes/"]');
 const assetUrl=asset?.src || asset?.href;
 const base=assetUrl ? new URL(assetUrl,location.href).pathname.split(/\/wp-(?:content|includes)\//)[0] : '';
 return {detected:!!link || /^WordPress/i.test(generator) || !!asset, generator,
  apiRoot:link ? new URL(link.href,location.href).href : new URL(`${base}/wp-json/`,location.origin).href,
  signals:[link?'rest-discovery':null,/^WordPress/i.test(generator)?'generator':null,asset?'wordpress-assets':null].filter(Boolean)};
}
function apiUrl(path,params={}) {
 const root=new URL(discover().apiRoot);
 if(root.searchParams.has('rest_route'))root.searchParams.set('rest_route','/'+path.replace(/^\//,''));
 else root.pathname=root.pathname.replace(/\/?$/,'/')+path.replace(/^\//,'');
 for(const [key,value] of Object.entries(params))if(value!==undefined)root.searchParams.set(key,String(value));
 return root;
}
async function request(path,params={}) {
 const url=apiUrl(path,params), headers={Accept:'application/json'};
 const nonce=globalThis.wpApiSettings?.nonce;
 if(nonce && url.origin===location.origin)headers['X-WP-Nonce']=nonce;
 const response=await fetch(url,{credentials:'include',headers});
 if(!response.ok)throw new Error(`WordPress HTTP ${response.status}: ${await response.text()}`);
 return {data:await response.json(),total:Number(response.headers.get('X-WP-Total')||0),pages:Number(response.headers.get('X-WP-TotalPages')||0)};
}
function contentText(root) {
 function read(node) {
  if(node.nodeType===3)return node.textContent.replace(/\s+/g,' ');
  const tag=node.nodeName.toLowerCase();
  if(['script','style'].includes(tag))return '';
  if(tag==='br')return '\n';
  if(tag==='pre')return `\n${node.textContent}\n`;
  const text=[...node.childNodes].map(read).join('');
  if(tag==='li')return `\n• ${text.trim()}\n`;
  if(['td','th'].includes(tag))return `${text}\t`;
  return ['p','div','section','article','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','tr','figure'].includes(tag)?`\n${text}\n`:text;
 }
 return read(root).replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function plain(html) {return contentText(new DOMParser().parseFromString(html||'','text/html').body);}
function imageSource(img) {
 const direct=img.getAttribute('data-src');
 if(direct)return direct;
 const srcset=img.getAttribute('data-srcset')||img.getAttribute('srcset');
 if(srcset){
  const candidates=srcset.split(',').map(part=>{const [url,size='1']=part.trim().split(/\s+/);return {url,size:parseFloat(size)};});
  return candidates.sort((a,b)=>b.size-a.size)[0].url;
 }
 return img.getAttribute('src');
}
function post(raw,full=false) {
 const result={id:raw.id,type:raw.type,url:raw.link,title:plain(raw.title?.rendered),date:raw.date,modified:raw.modified,authorId:raw.author,excerpt:plain(raw.excerpt?.rendered),categories:raw.categories,tags:raw.tags};
 if(full){
  const doc=new DOMParser().parseFromString(raw.content?.rendered||'','text/html');
  const images=[...doc.querySelectorAll('img')].map((img,i)=>({image:i+1,url:imageSource(img)?new URL(imageSource(img),raw.link).href:null,alt:img.getAttribute('alt')||'',...(!imageSource(img)?{status:'unavailable'}:{})}));
  [...doc.querySelectorAll('img')].forEach((img,i)=>img.replaceWith(doc.createTextNode(`[image ${i+1}]`)));
  for(const el of doc.querySelectorAll('script,style'))el.remove();
  result.text=contentText(doc.body); result.images=images;
  if(images.length)result.readImages=`readPostImages({id:${raw.id},type:"${raw.type||'post'}",images:[N]})`;
 }
 return result;
}
async function list(path,params,normalize=x=>x){const r=await request(path,params);return {items:r.data.map(normalize),page:params.page||1,total:r.total,totalPages:r.pages,nextPage:(params.page||1)<r.pages?(params.page||1)+1:null};}
async function contentRoute(type='post') {if(type==='post')return 'wp/v2/posts';if(type==='page')return 'wp/v2/pages';const {data}=await request('wp/v2/types');const info=data[type];return `${info.rest_namespace||'wp/v2'}/${info.rest_base}`;}
const empty=z.object({}), paging={page:z.number().int().positive().optional(),perPage:z.number().int().min(1).max(100).optional()};
const resource=z.object({id:z.number().int().positive(),type:z.string().optional()});
const entry=(summary,input,handler,args={})=>fn({summary,input,handler,examples:[{args}]});
export default defineSkill({
 detect:entry('检测当前页面的 WordPress 信号和实际 API 根路径。',empty,async()=>discover()),
 getSiteInfo:entry('读取站点名称、REST namespaces、路由及 MCP Adapter 路由。',empty,async()=>{const {data}=await request('');return {...discover(),name:data.name,description:data.description,url:data.url,namespaces:data.namespaces,mcpRoutes:Object.keys(data.routes||{}).filter(x=>/mcp/.test(x))};}),
 searchPosts:entry('搜索文章或自定义类型，按日期/相关性/标题排序，返回分页。',z.object({query:z.string().optional(),type:z.string().optional(),orderBy:z.enum(['date','relevance','title','modified']).optional(),order:z.enum(['asc','desc']).optional(),author:z.number().optional(),categories:z.string().optional(),tags:z.string().optional(),after:z.string().optional(),before:z.string().optional(),...paging}),async a=>list(await contentRoute(a.type),{search:a.query,page:a.page,per_page:a.perPage||10,orderby:a.orderBy||'date',order:a.order||'desc',author:a.author,categories:a.categories,tags:a.tags,after:a.after,before:a.before},x=>post(x)),{query:'travel'}),
 getPost:entry('读取文章/页面完整正文、图片编号与来源。',resource,async a=>post((await request(`${await contentRoute(a.type)}/${a.id}`)).data,true),{id:1}),
 getCurrentPost:entry('从当前页面 REST alternate 链接识别文章或页面，读取完整正文。',empty,async()=>{const link=document.querySelector('link[rel="alternate"][type="application/json"]');if(!link)throw new Error('当前页没有文章 REST alternate 链接');const url=new URL(link.href,location.href),route=url.searchParams.get('rest_route')||url.pathname;const apiPath=url.searchParams.has('rest_route')?route:route.slice(new URL(discover().apiRoot).pathname.replace(/\/?$/,'/').length);if(!/\/\d+\/?$/.test(apiPath))throw new Error('当前 alternate 链接不是 WordPress 内容接口');return post((await request(apiPath)).data,true);}),
 readPostImages:entry('将文章中所选图片的完整 URL 交给扩展后台读取。',resource.extend({images:z.array(z.number().int().positive()).optional()}),async a=>{const p=post((await request(`${await contentRoute(a.type)}/${a.id}`)).data,true);return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:(a.images||p.images.filter(i=>i.url).map(i=>i.image)).map(n=>{const image=p.images[n-1];if(!image?.url)throw new Error(`图片 ${n} 没有可读取的地址`);return image;})}};},{id:1,images:[1]}),
 getComments:entry('读取文章评论及父评论 ID，可按 parent 筛选楼中楼。',z.object({postId:z.number(),parent:z.number().optional(),...paging}),async a=>list('wp/v2/comments',{post:a.postId,parent:a.parent,page:a.page,per_page:a.perPage||20,order:'asc'},x=>({id:x.id,parent:x.parent,author:x.author_name,authorUrl:x.author_url,date:x.date,text:plain(x.content?.rendered),url:x.link})),{postId:1}),
 getAuthor:entry('读取作者公开资料。',z.object({id:z.number()}),async a=>(await request(`wp/v2/users/${a.id}`)).data,{id:1}),
 getTaxonomy:entry('列出分类或标签，支持关键词和分页。',z.object({taxonomy:z.enum(['categories','tags']).optional(),query:z.string().optional(),...paging}),async a=>list(`wp/v2/${a.taxonomy||'categories'}`,{search:a.query,page:a.page,per_page:a.perPage||20})),
 getTypes:entry('发现站点在 REST API 暴露的自定义内容类型及 rest_base。',empty,async()=>(await request('wp/v2/types')).data),
},{instructions:'WordPress API 根路径由页面 discovery 链接决定，兼容子目录和 ?rest_route=。正文 [image N] 对应 images，readImages 提示可调用后台读图。MCP 路由仅在站点安装对应插件时出现。'});
