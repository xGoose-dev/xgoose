// ==XGooseSkill==
// @name         discord
// @namespace    discord
// @version      0.1.5
// @description  Search Discord messages using the signed-in web client; read channels, threads, message context, attachments and profiles.
// @match        https://discord.com/*
// @match        https://canary.discord.com/*
// @match        https://ptb.discord.com/*
// @connect      <self>
// @primary      searchMessages
// @keyword      discord
// @action       Search messages | Search the current Discord server using discord.searchMessages. Read relevant message context and cite message links.
// ==/XGooseSkill==
import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

// Reuse the page's observed Discord request headers in memory. No webpack
// exports, method inventories or readiness probes are needed. Authentication
// succeeds or fails on the actual requested GET; headers are never returned.
function sessionRequest() {
  const bridge = globalThis.__xgoose;
  const requests = bridge?.getNetworkRequests?.({filter:'/api/',limit:200}) ?? [];
  for (const request of [...requests].reverse()) {
    const url = new URL(request.url, location.href);
    if (url.origin !== location.origin || !/^\/api\/v\d+\//.test(url.pathname)) continue;
    const raw = bridge.getNetworkRequestDetail?.(request.id,'headers')?.req ?? {};
    const headers = Object.fromEntries(Object.entries(raw).filter(([key]) => /^(authorization|x-super-properties|x-discord-locale|x-discord-timezone)$/i.test(key)));
    if (Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) {
      return {base:url.pathname.match(/^\/api\/v\d+/)[0],headers};
    }
  }
  return {base:'/api/v9',headers:{}};
}
let requestTail = Promise.resolve(), lastRequestAt = 0, blockedUntil = 0;
function get(path, query = {}) {
  const run = () => getRequest(path, query);
  const pending = requestTail.then(run, run);
  requestTail = pending;
  return pending;
}
async function getRequest(path, query) {
  if (blockedUntil > Date.now()) {
    throw Object.assign(new Error('Discord API rate limit cooldown'), {status:429,retryAfterMs:blockedUntil-Date.now()});
  }
  const delay = lastRequestAt + 1000 - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  lastRequestAt = Date.now();
  const {base,headers} = sessionRequest();
  const url = new URL(base + path, location.origin);
  for (const [key,value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key,String(item));
  }
  const response = await fetch(url.href,{method:'GET',credentials:'include',headers,redirect:'error'});
  const body = await response.json();
  if (response.status === 429) {
    const header = response.headers.get('retry-after');
    const retryMs = Number(body.retry_after ?? header ?? 1) * 1000;
    blockedUntil = Date.now() + retryMs;
  }
  if (!response.ok) throw Object.assign(new Error(`Discord HTTP ${response.status}: ${body.message ?? JSON.stringify(body)}`),{status:response.status,body});
  if (response.status === 202) return {indexing:true,retry_after:body.retry_after};
  return body;
}
const id = z.string().regex(/^\d+$/);
const empty = z.object({});
const limit = z.number().int().min(1).max(100).default(25);
// Apply request defaults in the handler, as in the current main implementation.
const tool = spec => fn({...spec, handler: args => spec.handler(spec.input.parse(args ?? {}))});
function current() {
  const [,guildId,channelId] = location.pathname.match(/^\/channels\/([^/]+)(?:\/([^/]+))?/) || [];
  return {guildId:guildId === '@me' ? undefined : guildId, channelId};
}
function guild(value) { const v=value || current().guildId; if(!v) throw Error('Choose a server or supply guildId.'); return v; }
function channel(value) { const v=value || current().channelId; if(!v) throw Error('Choose a channel or supply channelId.'); return v; }
function boundary(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? ((BigInt(Date.parse(value))-1420070400000n)<<22n).toString() : value;
}
function user(u) { return {id:u.id, username:u.username, displayName:u.global_name, avatar:u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null}; }
function message(m, guildId) {
  return {id:m.id, kind:'message', title:m.author?.global_name || m.author?.username || 'Message',
    url:`https://discord.com/channels/${guildId || m.guild_id || '@me'}/${m.channel_id}/${m.id}`,
    author:m.author ? user(m.author) : null, publishedAt:m.timestamp, text:m.content,
    channelId:m.channel_id, hit:m.hit, editedAt:m.edited_timestamp,
    replyTo:m.message_reference?.message_id,
    attachments:(m.attachments || []).map(a=>({id:a.id, name:a.filename, url:a.url, contentType:a.content_type, width:a.width, height:a.height})),
    embeds:(m.embeds || []).map(e=>({title:e.title, description:e.description, url:e.url, image:e.image?.url, thumbnail:e.thumbnail?.url})),
    mentions:(m.mentions || []).map(user),
    reactions:m.reactions?.map(r=>({emoji:r.emoji, count:r.count})), thread:m.thread};
}
function page(rows, guildId, extra={}) { return {readerVersion:1, sources:rows.map(m=>message(m,guildId)), ...extra}; }
const searchInput = z.object({
  guildId:id.optional(), content:z.string().max(1024).optional(), channelIds:z.array(id).optional(), authorIds:z.array(id).optional(),
  mentions:z.array(id).optional(), has:z.array(z.enum(['link','embed','file','video','image','sound','sticker'])).optional(),
  before:z.string().optional(), after:z.string().optional(), sortBy:z.enum(['timestamp','relevance']).default('timestamp'),
  sortOrder:z.enum(['desc','asc']).default('desc'), limit:z.number().int().min(1).max(25).default(25), offset:z.number().int().min(0).max(9975).default(0),
});
export default defineSkill({
  getContext:tool({summary:'Get selected server/channel IDs and current page URL.',input:empty,handler:()=>({...current(),url:location.href})}),
  listGuilds:tool({summary:'List joined servers through the native API; before/after paginate.',input:z.object({limit, before:id.optional(),after:id.optional()}),handler:async a=>({guilds:(await get('/users/@me/guilds',a)).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:g.owner}))})}),
  listChannels:tool({summary:'List server channels, categories and parent IDs.',input:z.object({guildId:id.optional()}),handler:async a=>({channels:(await get(`/guilds/${guild(a.guildId)}/channels`)).map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parent_id,position:c.position,topic:c.topic}))})}),
  listDMs:tool({summary:'List existing DM and group conversations.',input:empty,handler:async()=>({channels:(await get('/users/@me/channels')).map(c=>({id:c.id,name:c.name,type:c.type,recipients:(c.recipients||[]).map(user),lastMessageId:c.last_message_id}))})}),
  searchMessages:tool({summary:'Native server message search with filters and result offset. Returns search hits; use readMessages around a hit for context. Dates use UTC YYYY-MM-DD or snowflake IDs.',input:searchInput,handler:async a=>{
    const guildId=guild(a.guildId), q={offset:a.offset,limit:a.limit,sort_by:a.sortBy,sort_order:a.sortOrder};
    if(a.content!==undefined) q.content=a.content;
    for(const [key,value] of [['channel_id',a.channelIds],['author_id',a.authorIds],['mentions',a.mentions],['has',a.has]]) if(value?.length) q[key]=value;
    if(a.before) q.max_id=boundary(a.before); if(a.after) q.min_id=boundary(a.after);
    const raw=await get(`/guilds/${guildId}/messages/search`,q);
    if(raw.indexing) return {status:'indexing',retryAfterSeconds:raw.retry_after};
    const unique=new Map(), matchIds=new Set();
    const groups=raw.messages.map(group=>group.map(m=>{
      if(!unique.has(m.id) || m.hit === true) unique.set(m.id,m);
      if(m.hit === true || (group.length === 1 && m.hit !== false)) matchIds.add(m.id);
      return m.id;
    }));
    const next=a.offset+a.limit;
    return page([...unique.values()],guildId,{totalResults:raw.total_results,groups,matchIds:[...matchIds],offset:a.offset,
      nextOffset:next<raw.total_results && next<=9975 ? next : null,
      offsetLimitReached:next<raw.total_results && next>9975,deepHistoricalIndexing:raw.doing_deep_historical_index,
      threads:raw.threads?.map(t=>({id:t.id,name:t.name,parentId:t.parent_id,guildId}))});
  }}),
  readMessages:tool({summary:'Read channel or thread history. before, after and around are exclusive message-ID cursors.',input:z.object({channelId:id.optional(),guildId:id.optional(),limit,before:id.optional(),after:id.optional(),around:id.optional()}).refine(a=>[a.before,a.after,a.around].filter(Boolean).length<=1,'Choose one cursor.'),handler:async a=>{
    const channelId=channel(a.channelId), query={limit:a.limit};
    for(const k of ['before','after','around']) if(a[k]) query[k]=a[k];
    const rows=await get(`/channels/${channelId}/messages`,query);
    const ids=rows.map(m=>m.id).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    const guildId=a.guildId || (channelId === current().channelId ? current().guildId : (await get(`/channels/${channelId}`)).guild_id);
    return page(rows,guildId,{oldestId:ids[0] || null,newestId:ids.at(-1) || null,returned:rows.length});
  }}),
  listThreads:tool({summary:'List active threads in a server. Read their messages using the thread ID as channelId.',input:z.object({guildId:id.optional()}),handler:async a=>{const raw=await get(`/guilds/${guild(a.guildId)}/threads/active`); return {threads:raw.threads.map(t=>({id:t.id,name:t.name,parentId:t.parent_id,messageCount:t.message_count,metadata:t.thread_metadata}))};}}),
  getUser:tool({summary:'Read a user profile and optional server-specific nickname, roles and membership dates.',input:z.object({userId:id,guildId:id.optional()}),handler:async a=>{
    const raw=await get(`/users/${a.userId}/profile`,a.guildId?{guild_id:a.guildId}:{});
    return {user:{...user(raw.user),bio:raw.user.bio || raw.user_profile?.bio,pronouns:raw.user_profile?.pronouns},member:raw.guild_member && {nick:raw.guild_member.nick,roles:raw.guild_member.roles,joinedAt:raw.guild_member.joined_at},mutualGuilds:raw.mutual_guilds};
  }}),
},{instructions:'Use getContext or listGuilds/listChannels to resolve IDs. searchMessages uses Discord server-side search; content is the search text, while authors/channels/dates are separate filters. Pass nextOffset to continue. sources contain message bodies once; groups reference their IDs; matchIds identifies matches. Search does not supply surrounding context; read it separately. nextOffset advances by the requested limit, including short pages. offsetLimitReached means narrow the dates to continue beyond the native 10,000-result window. totalResults is the server estimate and may change while messages are created or deleted. Search omits reactions; readMessages returns them when supplied by the server. Read around a hit with readMessages({channelId,around:messageId}) to understand the conversation. Threads are channels. Cite message URLs. Attachments preserve CDN URLs; use the host readImages image channel to inspect them. An indexing status is pending search indexing; retry after the returned delay. Read requests reuse observed same-origin Discord API headers in memory. Actual HTTP errors, including authentication and rate limits, are returned without an extra probe or automatic retry.'});
