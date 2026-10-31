// ==XGooseSkill==
// @name         instagram
// @namespace    instagram
// @version      0.1.1
// @description  Instagram API reader backed by Instaloader: profiles, posts/reels, comments, Stories, highlight lists, account/hashtag search and images.
// @match        http://127.0.0.1:18061/*
// @match        http://localhost:18061/*
// @connect      <self>
// @primary      getProfile
// @keyword      instagram
// @keyword      ins
// @keyword      reels
// ==/XGooseSkill==
import {defineSkill,fn} from '@xgoose/skill';
import {z} from 'zod';

// Run on the local API page, avoiding cross-origin access from instagram.com.
async function request(operation,args={}) {
 const url=new URL(operation==='health'?'/health':`/v1/${operation}`,location.origin);
 for(const [k,v] of Object.entries(args))if(v!==undefined)url.searchParams.set(k,String(v));
 const response=await fetch(url.href,{headers:{Accept:'application/json'}});
 const data=await response.json();
 if(!response.ok)throw new Error(JSON.stringify(data.detail??data));
 return data;
}
function imageHints(post) {
 return {...post,readImages:post.images?.length?`readPostImages({shortcode:"${post.shortcode}",images:[N]})`:undefined};
}
const profile=z.object({username:z.string()});
const page=z.object({username:z.string(),limit:z.number().int().positive().optional(),cursor:z.string().optional()});
const post=z.object({shortcode:z.string().describe('Shortcode or complete post/reel URL')});
const entry=(summary,input,handler,args)=>fn({summary,input,handler,examples:[{args}]});
export default defineSkill({
 status:entry('API health, Instaloader version and whether a session is configured.',z.object({}),()=>request('health'),{}),
 getProfile:entry('Profile bio, counts, private/verified status and source link.',profile,({username})=>request('profile',{target:username}),{username:'instagram'}),
 getUserPosts:entry('A page of posts with captions, media and counts; continue with cursor.',page,async({username,...args})=>{const data=await request('posts',{target:username,...args});return {...data,items:data.items.map(imageHints)};},{username:'instagram',limit:10}),
 getPost:entry('One post/reel including carousel URLs, caption, counts and image markers.',post,async({shortcode})=>imageHints(await request('post',{target:shortcode})),{shortcode:'POST_SHORTCODE'}),
 getComments:entry('A page of comments; preserves the library iterator across cursors.',z.object({shortcode:z.string(),limit:z.number().int().positive().optional(),cursor:z.string().optional()}),({shortcode,...args})=>request('comments',{target:shortcode,...args}),{shortcode:'POST_SHORTCODE'}),
 search:entry('Search accounts and hashtags through Instaloader TopSearchResults.',z.object({query:z.string(),limit:z.number().int().positive().optional()}),({query,...args})=>request('search',{target:query,...args}),{query:'travel'}),
 getStories:entry('Currently available Stories with image/video URLs.',page,({username,...args})=>request('stories',{target:username,...args}),{username:'instagram'}),
 getHighlights:entry('Highlight ID/title list for a profile.',page,({username,...args})=>request('highlights',{target:username,...args}),{username:'instagram'}),
 readPostImages:entry('Pass selected original images to the extension background image reader.',z.object({shortcode:z.string(),images:z.array(z.number().int().positive()).optional()}),async({shortcode,images})=>{
  const post=await request('post',{target:shortcode});
  return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:(images??post.images.map(x=>x.image)).map(n=>({image:n,url:post.images[n-1].url}))}};
 },{shortcode:'POST_SHORTCODE',images:[1]}),
},{instructions:'Open http://127.0.0.1:18061/ and invoke via skill_call. The API uses its configured Instaloader session, independently of browser cookies. Continue returned cursors; the API keeps the library iterator. [image N] markers match images, with readImages as a separate call hint. Search covers accounts and hashtags.'});
