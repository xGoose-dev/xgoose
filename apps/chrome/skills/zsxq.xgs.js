// ==XGooseSkill==
// @name         zsxq
// @namespace    zsxq
// @version      0.1.3
// @description  知识星球前端 API：当前登录用户、星球、主题、搜索、正文、图片和评论，复用网页登录态。
// @match        https://wx.zsxq.com/*
// @connect      api.zsxq.com
// @connect      <self>
// @primary      getGroups
// @keyword      知识星球
// @keyword      zsxq
// ==/XGooseSkill==
import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

// Uses the HTTP service shipped with the running website, including its current
// URL routing and signature generator. Verified frontend source (2026-10-31):
// https://wx.zsxq.com/chunk-5LGB6CKA.js (hA.get / Nt / sv).
// Browser API paths: https://github.com/Tangc/zsxq-mcp/blob/main/zsxq/topics.go
const id=z.string().describe('Preserve the complete ID as a string');
let frontendClient;
async function requestBuilder() {
  if(frontendClient) return frontendClient;
  for(const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    const url=link.href;
    const module=await import(url);
    const HttpService=Object.values(module).find(value=>typeof value==='function' && typeof value.prototype?.getUrl==='function' && typeof value.prototype?.get401ErrorInfo==='function' && typeof value.prototype?.get==='function');
    if(HttpService) {
      // The website's service generates the signed URL and HttpHeaders. Its
      // transport adapter returns that request instead of starting Angular I/O.
      frontendClient=new HttpService({get:(url,options)=>({pipe:()=>({url,options})})},null,null);
      return frontendClient;
    }
  }
  throw new Error('ZSXQ frontend HTTP service is not present in the loaded modules.');
}
async function api(path,params={}) {
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)) if(value!==undefined) query.set(key,String(value));
  const resource=path+(query.size?'?'+query.toString():'');
  const client=await requestBuilder();
  const request=client.get(resource);
  const headers={Accept:'application/json, text/plain, */*'};
  for(const key of request.options.headers.keys()) headers[key]=request.options.headers.get(key);
  const response=await fetch(request.url,{credentials:'include',headers});
  if(!response.ok) throw new Error(`ZSXQ HTTP ${response.status}: ${await response.text()}`);
  const raw=await response.text();
  const data=JSON.parse(raw.replace(/("[\w]*_id"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'));
  if(!data.succeeded) throw new Error(`ZSXQ ${data.code}: ${data.info||data.error}`);
  return data.resp_data;
}
const skill={
  getCurrentUser:fn({summary:'Read the current signed-in user through the frontend API.',input:z.object({}),handler:()=>api('users/self')}),
  getGroups:fn({summary:'Read joined/created groups directly from the frontend JSON API.',input:z.object({}),handler:()=>api('groups')}),
  getGroup:fn({summary:'Read group details by ID.',input:z.object({groupId:id}),handler:({groupId})=>api(`groups/${encodeURIComponent(groupId)}`)}),
  getTopics:fn({summary:'Read group topics with API pagination; use end_time to continue.',input:z.object({groupId:id,scope:z.string().default('all'),count:z.number().int().default(20),end_time:z.string().optional()}),handler:({groupId,...params})=>api(`groups/${encodeURIComponent(groupId)}/topics`,params)}),
  searchTopics:fn({summary:'Search group topics using the frontend search API and its ordering.',input:z.object({groupId:id,keyword:z.string(),count:z.number().int().default(20),order_by:z.string().default('default'),index:z.union([z.string(),z.number()]).optional()}),handler:({groupId,...params})=>api(`search/groups/${encodeURIComponent(groupId)}/topics`,params)}),
  getTopic:fn({summary:'Read topic JSON including talk/question/answer, images and file metadata.',input:z.object({topicId:id}),handler:({topicId})=>api(`topics/${encodeURIComponent(topicId)}/info`)}),
  getComments:fn({summary:'Read topic comments with the actual website sort, sticky setting and index cursor.',input:z.object({topicId:id,sort:z.enum(['asc','desc']).default('asc'),count:z.number().int().default(30),with_sticky:z.boolean().default(true),index:z.string().optional()}),handler:({topicId,...params})=>api(`topics/${encodeURIComponent(topicId)}/comments`,params)}),
  getUser:fn({summary:'Read a user profile through the website API.',input:z.object({userId:id}),handler:({userId})=>api(`users/${encodeURIComponent(userId)}`)}),
  readCurrent:fn({summary:'Read the current /topic/{id} directly from its JSON API.',input:z.object({}),handler:()=>skill.getTopic.handler({topicId:location.pathname.match(/^\/topic\/(\d+)/)[1]})}),
};
export default defineSkill(skill,{instructions:'Use the website frontend JSON API with the existing browser login. The running website supplies URL version routing and signed headers; cookies are attached automatically. No OAuth setup or separately configured API token is needed. API calls do not navigate or scrape topic text from the DOM. Use getGroups for group IDs, searchTopics/getTopics for topic IDs, and getTopic/getComments for details. Return original API fields and pagination data. Continue topic lists with end_time and comment lists with the returned index. Image URLs use the shared image reader. For long articles, talk.article.inline_article_url identifies the separate article body; topic JSON alone may not contain that body.'});
