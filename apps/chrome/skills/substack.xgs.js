// ==XGooseSkill==
// @name         substack
// @namespace    substack
// @version      0.2.1
// @description  Substack publication search, articles, comments, profile, subscriptions, inbox and Notes feeds through existing web APIs.
// @match        https://substack.com/*
// @match        https://*.substack.com/*
// @match        https://*/*
// @detect       /(^|\.)substack\.com$/.test(location.hostname) || !!globalThis._preloads?.pub?.subdomain || !!document.querySelector('script[src*="substackcdn.com"],link[href*="substack.com/feed"]')
// @connect      <self>
// @connect      substack.com
// @primary      searchPosts
// @keyword      substack
// @keyword      newsletter
// ==/XGooseSkill==
import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

// Endpoint/host reference: https://github.com/marcomoauro/substack-mcp/blob/main/src/api/substack/SubstackApi.js
const id = z.union([z.string(),z.number()]);
async function api(host,path,params={}) {
  const url = new URL(`/api/v1/${path}`,host);
  for (const [key,value] of Object.entries(params)) if(value !== undefined) url.searchParams.set(key,value);
  const response = await fetch(url.href,{credentials:'include',headers:{Accept:'application/json'}});
  if(!response.ok) throw new Error(`Substack HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
const publication = (path,params)=>api(location.origin,path,params);
const reader = (path,params)=>api('https://substack.com',path,params);
const page = {limit:z.number().int().default(20),cursor:z.string().optional()};
const skill = {
  searchPosts: fn({summary:'Search articles within the current publication, with sorting and offset pagination.',input:z.object({search:z.string().default(''),sort:z.enum(['new','top']).default('new'),offset:z.number().int().default(0),limit:z.number().int().default(20)}),handler:params=>publication('archive',params)}),
  getPost: fn({summary:'Read a publication article by slug, including body_html and image markup.',input:z.object({slug:z.string()}),handler:({slug})=>publication(`posts/${encodeURIComponent(slug)}`)}),
  getPostById: fn({summary:'Read a reader article by numeric ID, using the global host.',input:z.object({postId:id}),handler:({postId})=>reader(`posts/by-id/${encodeURIComponent(postId)}`)}),
  getComments: fn({summary:'Read article comments from the publication host.',input:z.object({postId:id,limit:z.number().int().default(50)}),handler:({postId,...params})=>publication(`post/${encodeURIComponent(postId)}/comments`,params)}),
  getPublication: fn({summary:'Read publication metadata.',input:z.object({}),handler:()=>publication('publication')}),
  getProfile: fn({summary:'Read the signed-in profile and publication roles.',input:z.object({}),handler:()=>reader('user/profile/self')}),
  getSubscriptions: fn({summary:'Read subscriptions, retaining the response cursor.',input:z.object({...page,limit:z.number().int().default(100)}),handler:params=>reader('subscriptions/all/v2',params)}),
  getInbox: fn({summary:'Read inbox posts. Resume with the last inboxItem content_date as after.',input:z.object({limit:z.number().int().default(20),after:z.string().optional()}),handler:params=>reader('reader/posts',params)}),
  getFeedTabs: fn({summary:'Get the account’s feed tab IDs.',input:z.object({}),handler:()=>reader('reader/feed/tabs')}),
  getFeed: fn({summary:'Read a Notes/posts feed using a tab ID and cursor.',input:z.object({...page,tab:z.string().default('for-you')}),handler:params=>reader('reader/feed',params)}),
  getProfileFeed: fn({summary:'Read one user’s Notes and published posts.',input:z.object({...page,userId:id}),handler:({userId,...params})=>reader(`reader/feed/profile/${encodeURIComponent(userId)}`,params)}),
  getComment: fn({summary:'Read one Note or comment.',input:z.object({commentId:id}),handler:({commentId})=>reader(`reader/comment/${encodeURIComponent(commentId)}`)}),
  getReplies: fn({summary:'Read comment branches and nextCursor.',input:z.object({commentId:id,cursor:z.string().optional()}),handler:({commentId,...params})=>reader(`reader/comment/${encodeURIComponent(commentId)}/replies`,params)}),
  readCurrent: fn({summary:'Read the article open on the current publication.',input:z.object({}),handler:()=>skill.getPost.handler({slug:location.pathname.match(/^\/p\/([^/]+)/)[1]})}),
};
export default defineSkill(skill,{instructions:'Publication functions use the current publication origin, including custom domains. Open a publication for searchPosts/getPost/getComments/getPublication. Profile, subscriptions, inbox, feeds, Notes and replies use substack.com. Call getFeedTabs to discover tab IDs; pass cursor/nextCursor from the actual response. Results keep original API JSON, body_html, media URLs and pagination. Image URLs use the shared image reader. Calls use the browser session. The official mcp.substack.com service is a separate OAuth analytics integration; this skill uses the browser web API.'});
