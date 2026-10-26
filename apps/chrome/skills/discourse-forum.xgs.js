// ==XGooseSkill==
// @name         discourse-forum
// @namespace    discourse
// @version      0.2.3
// @description  Helpers for Discourse-powered forums (full-text search, read topics + posts, post replies, fetch user data via the Discourse JSON API).
// @match        *://meta.discourse.org/*
// @match        *://*.discourse.org/*
// @match        *://www.uscardforum.com/*
// @match        *://linux.do/*
// @match        https://*/*
// @match        http://*/*
// @detect       !!document.querySelector('meta[name="generator"][content^="Discourse"]')
// @run-at       document_idle
// @primary      searchTopics
// @keyword      discourse
// @keyword      forum
// @keyword      topic
// @keyword      post
// @keyword      uscardforum
// @keyword      美卡论坛
// @keyword      linux.do
// ==/XGooseSkill==

/**
 * Discourse JSON API wrapper.
 *
 * Auth: same-origin cookies + CSRF token from `<meta name="csrf-token">`.
 * All writes (POST /posts.json, etc.) require the token; reads are anonymous-OK
 * but we always send `credentials: 'include'` so logged-in users see their
 * own visibility (drafts, PMs, etc.).
 *
 * Endpoint reference:
 *   GET  /search.json?q={q}&page={n}&order={...}
 *   GET  /t/{id}.json
 *   GET  /t/{id}.json?post_number={n}
 *   GET  /categories.json?include_subcategories=true
 *   GET  /latest.json?order={created|latest}&page={n}
 *   GET  /hot.json?page={n}
 *   GET  /session/current.json
 *   GET  /u/{username}/summary.json
 *   GET  /notifications.json?limit={n}
 *   GET  /site.json
 *   POST /posts.json  body { topic_id, raw, reply_to_post_number? }
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? null;
}

async function csrfFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  const token = getCsrfToken();
  if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(url, { credentials: 'include', cache: 'no-cache', ...init, headers });
}

let forumReadQueue=Promise.resolve(), forumReadLastAt=0, forumReadBlockedUntil=0;
const forumReadPending=new Map();
function getJson(url) {
  if(forumReadPending.has(url))return forumReadPending.get(url);
  const pending=forumReadQueue.catch(()=>{}).then(async()=>{
    if(forumReadBlockedUntil>Date.now())return {status:'rate_limited',httpStatus:429,url,retry_after_ms:forumReadBlockedUntil-Date.now(),message:'Forum cooldown active. Continue after retry_after_ms; no request was sent.'};
    const delay=Math.max(0,forumReadLastAt+1100-Date.now());
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    forumReadLastAt=Date.now();
    return fetchForumJson(url);
  });
  forumReadQueue=pending.then(()=>{},()=>{});
  forumReadPending.set(url,pending);
  pending.then(()=>forumReadPending.delete(url),()=>forumReadPending.delete(url));
  return pending;
}

async function fetchForumJson(url) {
  const r = await csrfFetch(url, { method: 'GET' });
  if (!r.ok) {
    if (r.status === 429) {
      const retryAfter=r.headers?.get('retry-after');
      const seconds=retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter || '')-Date.now();
      const retryMs=Number.isFinite(seconds)?Math.max(1100,seconds):30000;
      forumReadBlockedUntil=Date.now()+retryMs;
      return {retry_after_ms:retryMs,
        status: 'rate_limited',
        url,
        httpStatus: r.status,
        message:
          'The Discourse forum endpoint rate-limited this request (HTTP 429). This is a site/forum API throttle, not a browser sandbox or extension permission issue. Retry with fewer/broader queries, use latest/hot topic lists, or summarize currently visible page content.',
      };
    }
    if (r.status === 401 || r.status === 403) {
      return {
        status: 'forum_rejected',
        url,
        httpStatus: r.status,
        message:
          `The Discourse forum API rejected this request (HTTP ${r.status}). This is a site login/permission/bot-protection issue, not a browser sandbox or extension permission issue. Use visible page content or ask the user to log in/refresh if needed.`,
      };
    }
    throw new Error(`GET ${url} -> HTTP ${r.status} (forum API error; not browser sandbox)`);
  }
  return await r.json();
}

function queuedSearch(url) { return getJson(url); }

function compactSearchResult(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.httpStatus) return raw;
  const topics = Array.isArray(raw.topics)
    ? raw.topics.slice(0, 8).map((t) => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        posts_count: t.posts_count,
        reply_count: t.reply_count,
        created_at: t.created_at,
        last_posted_at: t.last_posted_at,
        tags: Array.isArray(t.tags) ? t.tags.map((x) => typeof x === 'string' ? x : x?.name).filter(Boolean) : t.tags,
        category_id: t.category_id,
      }))
    : [];
  const posts = Array.isArray(raw.posts)
    ? raw.posts.slice(0, 8).map((p) => ({
        id: p.id,
        topic_id: p.topic_id,
        post_number: p.post_number,
        username: p.username,
        created_at: p.created_at,
        like_count: p.like_count,
        blurb: typeof p.blurb === 'string' ? p.blurb.slice(0, 350) : p.blurb,
      }))
    : [];
  return {
    status: raw.status ?? 'ok',
    topics,
    posts,
    total_topics: Array.isArray(raw.topics) ? raw.topics.length : undefined,
    total_posts: Array.isArray(raw.posts) ? raw.posts.length : undefined,
    hint: 'Compact search result. Use discourse.getTopic({ id }) or getTopicPosts({ topicId }) to read a specific thread in full.',
  };
}

function htmlToText(html) {
  if (typeof html !== 'string') return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.innerText || div.textContent || '').replace(/\s+/g, ' ').trim();
}

function compactTopicResult(raw, maxChars = 4000) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.httpStatus) return raw;
  const postsRaw = raw.post_stream?.posts || raw.posts || [];
  const posts = Array.isArray(postsRaw)
    ? postsRaw.slice(0, 5).map((p) => ({
        id: p.id,
        post_number: p.post_number,
        username: p.username,
        created_at: p.created_at,
        like_count: p.like_count,
        reply_count: p.reply_count,
        text: htmlToText(p.cooked || p.blurb || p.raw).slice(0, maxChars),
        text_truncated: htmlToText(p.cooked || p.blurb || p.raw).length > maxChars,
        url: `${location.origin}/t/${p.topic_id ?? raw.id}/${p.post_number}`,
      }))
    : [];
  return {
    id: raw.id,
    url: `${location.origin}/t/${raw.id}`,
    title: raw.title,
    slug: raw.slug,
    category_id: raw.category_id,
    tags: Array.isArray(raw.tags) ? raw.tags.map((x) => typeof x === 'string' ? x : x?.name).filter(Boolean) : raw.tags,
    posts_count: raw.posts_count,
    reply_count: raw.reply_count,
    created_at: raw.created_at,
    last_posted_at: raw.last_posted_at,
    posts,
    hint: 'Compact topic result. The post body is in posts[].text (HTML-stripped, up to maxChars per post, first 5 posts only; text_truncated flags incomplete bodies) — there is NO cooked / post_stream / raw field on this object. Use readTopicPosts({ topicId, fromPostNumber }) and follow next_cursor to read later posts.',
  };
}

// Output shape of compactTopicResult — declared so the agent reads posts[].text
// instead of guessing the raw Discourse shape (post_stream.posts[].cooked).
const TopicResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string().optional(),
  category_id: z.number().optional(),
  tags: z.array(z.string()).optional(),
  posts_count: z.number().optional(),
  reply_count: z.number().optional(),
  created_at: z.string().optional(),
  last_posted_at: z.string().optional(),
  posts: z
    .array(
      z.object({
        id: z.number(),
        post_number: z.number(),
        username: z.string(),
        created_at: z.string().optional(),
        like_count: z.number().nullable().optional(),
        reply_count: z.number().optional(),
        text_truncated: z.boolean(),
        url: z.string(),
        text: z
          .string()
          .describe(
            'Post body as HTML-stripped plain text (bounded by maxChars). READ THIS field — there is no `cooked`, `raw`, or `post_stream` on this result.',
          ),
      }),
    )
    .describe('Up to 5 posts at or after postNumber. Prefer readTopicPosts for large ranges and follow next_cursor.'),
  hint: z.string().optional(),
});

async function forumJson(path) {
  const result = await getJson(path);
  if (result?.httpStatus) throw new Error(result.message);
  return result;
}
function postText(post) {
  const node = document.createElement('div');
  node.innerHTML = post.cooked || '';
  return (node.innerText || node.textContent || post.raw || '').replace(/\s+/g,' ').trim();
}
function topicLink(id) { return `${location.origin}/t/${id}`; }
async function summaryTopic(topicId) {
  const route = location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/);
  const id = topicId || (route ? Number(route[1]) : null);
  if (!Number.isSafeInteger(id) || id <= 0) return {status:'not_a_topic',message:'Open a topic before using Summarize this thread.'};
  const topic = await forumJson(`/t/${id}.json`);
  const stream = topic.post_stream?.stream;
  if (!Array.isArray(stream) || !stream.length) throw new Error('Forum did not return a readable post stream. Do not claim to have read the full topic.');
  const long = (topic.highest_post_number || topic.posts_count || stream.length) > 300;
  const selected = long ? [...new Set([stream[0], ...stream.slice(-30)])] : stream;
  const posts = new Map((topic.post_stream?.posts || []).map(p=>[p.id,p]));
  const missing = selected.filter(id=>!posts.has(id));
  // Sequential, bounded reads avoid turning a shortcut into a burst of forum requests.
  for (let offset=0;offset<missing.length;offset+=20) {
    const params = new URLSearchParams();
    for (const postId of missing.slice(offset,offset+20)) params.append('post_ids[]',String(postId));
    const result = await forumJson(`/t/${id}/posts.json?${params}`);
    for (const post of result.post_stream?.posts || []) posts.set(post.id,post);
  }
  // Keep all selected floors represented while bounding the model context.
  const perPost = Math.max(60, Math.min(6000, Math.floor(24000/selected.length)));
  const result = selected.map(postId=>posts.get(postId)).filter(Boolean).map(post=>{
    const text=postText(post);
    return {post_number:post.post_number,username:post.username,created_at:post.created_at,text:text.slice(0,perPost),text_truncated:text.length>perPost,url:`${topicLink(id)}/${post.post_number}`};
  });
  return {title:topic.title,url:topicLink(id),posts_count:topic.posts_count,highest_post_number:topic.highest_post_number,
    selection:long?'first post and latest 30 posts':'all visible posts',selected_count:selected.length,read_count:result.length,
    complete:result.length===selected.length,posts:result,
    hint:'Read posts[].text. If text_truncated=true, use discourse.getTopicPosts for a longer body. State the selected range and any truncation; never claim to have read omitted text.'};
}
async function recentTopics(kind='new') {
  const result = await forumJson(`/latest.json?order=${kind==='random'?'latest':'created'}`);
  let candidates = [...new Map((result.topic_list?.topics || []).filter(t=>!t.pinned && t.archetype!=='private_message').map(t=>[t.id,t])).values()];
  candidates.sort((a,b)=>Date.parse(kind==='new' ? b.created_at : b.last_posted_at || b.created_at)-Date.parse(kind==='new' ? a.created_at : a.last_posted_at || a.created_at));
  if(kind==='random') {
    candidates=candidates.slice(0,30);
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  }
  const topics=[];
  for(const item of candidates.slice(0,kind==='random'?5:8)) {
    try {
      const detail=compactTopicResult(await forumJson(`/t/${item.id}.json`),2500);
      topics.push({id:item.id,title:item.title,url:topicLink(item.id),created_at:item.created_at,last_posted_at:item.last_posted_at,posts:detail.posts || []});
    } catch(error) { topics.push({id:item.id,title:item.title,url:topicLink(item.id),read_error:String(error)}); }
  }
  return {kind,topics,hint:'Recommend only from the bodies actually read. Include titles, short reasons, dates and clickable Markdown topic links. Identify unread or failed topics instead of inventing their contents.'};
}

// Range reads use the visible post-ID stream, never the first five posts of a
// context window. In-memory evidence expires with this page or after 60 seconds.
const topicReadStates = new Map();
const topicReadLoads = new Map();
let topicReadRevision = 0;
const TopicReadInput = z.object({
  topicId: z.number().int().positive(),
  fromPostNumber: z.number().int().positive().optional().describe('Inclusive floor; deleted floors are skipped. Default 1.'),
  cursor: z.string().max(1000).optional().describe('Pass next_cursor unchanged to continue the same visible-post snapshot.'),
  limit: z.number().int().min(1).max(300).default(100).describe('Maximum posts per call; the 24 KB model-output budget can return fewer.'),
  maxChars: z.number().int().min(100).max(20000).default(1000).describe('Characters per post; truncation and next_text_offset are explicit.'),
  textOffset: z.number().int().min(0).default(0).describe('To recover a long post, set fromPostNumber to that floor, limit:1 and this offset.'),
}).strict().superRefine((value, ctx) => {
  if (value.cursor && (value.fromPostNumber !== undefined || value.textOffset)) ctx.addIssue({code:'custom',message:'Use cursor alone, or fromPostNumber/textOffset.'});
  if (value.textOffset && (value.limit !== 1 || value.fromPostNumber === undefined)) ctx.addIssue({code:'custom',message:'textOffset requires fromPostNumber and limit:1.'});
});

const TopicReadResult = z.object({
  status:z.string(),origin:z.string(),posts:z.array(z.object({
    id:z.number(),post_number:z.number(),username:z.string(),url:z.string(),text:z.string(),
    like_count:z.number().nullable(),text_truncated:z.boolean(),text_offset:z.number(),total_text_chars:z.number(),next_text_offset:z.number().nullable(),
  }).passthrough()),
  complete:z.boolean().describe('True only if this result contains the entire visible topic and untruncated bodies.'),
  next_cursor:z.string().nullable().describe('Continue pages sequentially with this value. Null means there are no more post IDs, not that every body was untruncated.'),
}).passthrough();

function rememberTopicPosts(state, raw) {
  for (const post of raw.post_stream?.posts || raw.posts || []) {
    if (Number.isSafeInteger(post.id) && Number.isSafeInteger(post.post_number) && (!post.topic_id || post.topic_id === state.topic.id)) state.posts.set(post.id, post);
  }
}
async function loadTopicReadState(topicId, fromPostNumber) {
  const cached = topicReadStates.get(topicId);
  if (cached && cached.expires > Date.now()) return cached;
  if (topicReadLoads.has(topicId)) return topicReadLoads.get(topicId);
  const pending = (async () => {
    const topic = await getJson(`/t/${topicId}.json${fromPostNumber > 1 ? `?post_number=${fromPostNumber}` : ''}`);
    if (topic.httpStatus) return {failure:topic};
    let ids = topic.post_stream?.stream;
    if (!Array.isArray(ids) || ids.length < (topic.posts_count || 0)) {
      const stream = await getJson(`/t/${topicId}/post_ids.json`);
      if (stream.httpStatus) return {failure:stream};
      ids = stream.post_ids;
    }
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Forum did not provide a visible post-ID stream; full coverage is unknown.');
    const state = {topic, ids:[...new Set(ids)], posts:new Map(), expires:Date.now()+60000, revision:++topicReadRevision};
    rememberTopicPosts(state, topic);
    topicReadStates.set(topicId, state);
    while (topicReadStates.size > 4) topicReadStates.delete(topicReadStates.keys().next().value);
    return state;
  })();
  topicReadLoads.set(topicId, pending);
  try {return await pending;} finally {topicReadLoads.delete(topicId);}
}
function rangeCursor(state, offset) {
  return JSON.stringify({topicId:state.topic.id,origin:location.origin,revision:state.revision,offset});
}
function rangePost(post, maxChars, textOffset=0) {
  const text = htmlToText(post.cooked || post.raw || post.blurb || '');
  const end = Math.min(text.length, textOffset+maxChars);
  const likes = post.like_count ?? post.actions_summary?.find(action => action.id === 2)?.count ?? null;
  return {id:post.id,post_number:post.post_number,username:post.username,created_at:post.created_at,
    like_count:likes,reply_count:post.reply_count,url:`${location.origin}/t/${post.topic_id}/${post.post_number}`,
    text:text.slice(textOffset,end),text_offset:textOffset,total_text_chars:text.length,
    text_truncated:textOffset>0 || end<text.length,next_text_offset:end<text.length?end:null};
}
async function readTopicRange(rawArgs) {
  const args = TopicReadInput.parse(rawArgs);
  let state, offset = 0;
  if (args.cursor) {
    let cursor; try {cursor=JSON.parse(args.cursor);} catch {throw new Error('Invalid topic cursor.');}
    state=topicReadStates.get(args.topicId);
    if (!state || state.expires<=Date.now() || cursor.topicId!==args.topicId || cursor.origin!==location.origin || cursor.revision!==state.revision || !Number.isSafeInteger(cursor.offset) || cursor.offset<0 || cursor.offset>state.ids.length) throw new Error('Topic cursor expired or belongs to another topic. Restart from the last returned post number.');
    offset=cursor.offset;
  } else {
    state=await loadTopicReadState(args.topicId,args.fromPostNumber || 1);
    if (state.failure) return {...state.failure,origin:location.origin,posts:[],complete:false,next_cursor:null};
    if ((args.fromPostNumber || 1)>1) {
      let candidates=[...state.posts.values()].filter(post=>post?.post_number===args.fromPostNumber);
      if (!candidates.length && args.fromPostNumber<=(state.topic.highest_post_number || Infinity)) {
        const around=await getJson(`/t/${args.topicId}.json?post_number=${args.fromPostNumber}`);
        if (around.httpStatus) return {...around,origin:location.origin,posts:[],complete:false,next_cursor:null};
        rememberTopicPosts(state,around);
        candidates=(around.post_stream?.posts || []).filter(post=>post.post_number>=args.fromPostNumber).sort((a,b)=>a.post_number-b.post_number);
        if(!candidates.length && args.fromPostNumber<=(state.topic.highest_post_number || Infinity))throw new Error('Forum did not return the requested floor or a following visible floor. Coverage is unknown.');
      }
      offset=candidates.length?state.ids.indexOf(candidates[0].id):state.ids.length;
      if (offset<0) throw new Error('Topic post stream changed. Restart the range read.');
    }
  }
  const start=offset, end=Math.min(state.ids.length,start+args.limit), posts=[], missing=[];
  let failure=null, outputLimited=false;
  const makeResult=() => ({id:args.topicId,title:String(state.topic.title || '').slice(0,500),url:`${location.origin}/t/${args.topicId}`,origin:location.origin,
    status:failure?.status || 'ok',...(failure?{httpStatus:failure.httpStatus,message:failure.message,retry_after_ms:failure.retry_after_ms}:{}),
    posts_count:state.topic.posts_count,highest_post_number:state.topic.highest_post_number,visible_post_count:state.ids.length,
    requested_from_post_number:args.fromPostNumber ?? null,first_post_number:posts[0]?.post_number ?? null,last_post_number:posts.at(-1)?.post_number ?? null,
    read_count:posts.length,missing_post_ids:missing,output_limited:outputLimited,
    range_complete:!failure && !outputLimited && !missing.length,text_complete:posts.every(post=>!post.text_truncated),
    complete:start===0 && offset===state.ids.length && !failure && !missing.length && posts.every(post=>!post.text_truncated),
    next_cursor:offset<state.ids.length?rangeCursor(state,offset):null,
    next_post_number:offset<state.ids.length?(state.posts.get(state.ids[offset])?.post_number ?? (posts.at(-1)?.post_number !== undefined?posts.at(-1).post_number+1:args.fromPostNumber || 1)):null,
    posts,hint:'Read posts[].text. Continue with next_cursor sequentially; do not parallelize pages. Full-topic coverage requires all pages, no missing bodies, and recovery of text_truncated posts using fromPostNumber, limit:1 and next_text_offset. Scope is this origin only.'});
  while (offset<end) {
    const id=state.ids[offset];
    if (!state.posts.has(id)) {
      const ids=state.ids.slice(offset,Math.min(end,offset+20)).filter(id=>!state.posts.has(id));
      const params=new URLSearchParams();for(const id of ids)params.append('post_ids[]',String(id));
      const batch=await getJson(`/t/${args.topicId}/posts.json?${params}`);
      if (batch.httpStatus) {failure=batch;break;}
      rememberTopicPosts(state,batch);
      // Bodies omitted by the server are recorded once, without a retry loop.
      for(const id of ids)if(!state.posts.has(id))state.posts.set(id,null);
    }
    const post=state.posts.get(id);
    if(!post){missing.push(id);offset++;continue;}
    const entry=rangePost({...post,topic_id:args.topicId},args.maxChars,args.textOffset);
    posts.push(entry);offset++;
    if(new TextEncoder().encode(JSON.stringify(makeResult())).length>24000){
      if(posts.length>1){posts.pop();offset--;outputLimited=true;break;}
      // Even one unusually long post must leave a usable continuation.
      while(new TextEncoder().encode(JSON.stringify(makeResult())).length>24000 && entry.text.length>1){
        entry.text=entry.text.slice(0,Math.max(1,Math.floor(entry.text.length*0.75)));
        entry.text_truncated=true;entry.next_text_offset=entry.text_offset+entry.text.length;
      }
    }
  }
  return makeResult();
}

export default defineSkill({
  readTopicPosts: fn({
    summary: 'Read up to 300 visible topic posts per call by real post IDs. Serialized 20-post batches, cached bodies, exact floor selection, likes, source origin, a bounded JSON result and next_cursor. Continue sequentially to cover a whole thread.',
    input: TopicReadInput,
    output: TopicReadResult,
    examples: [{args:{topicId:541783,fromPostNumber:632,limit:100}},{args:{topicId:541783,fromPostNumber:632,limit:1,maxChars:6000}}],
    handler: readTopicRange,
  }),

  readTopicForSummary: fn({
    summary: 'Read all visible posts through floor 300; for longer threads read the first post and latest 30. Includes original floor links and truncation flags.',
    input: z.object({topicId:z.number().int().positive().optional()}),
    handler: async ({topicId}={}) => summaryTopic(topicId),
  }),
  getRecentTopics: fn({
    summary: 'Read recent new topics or five randomly selected latest topics, with original links.',
    input: z.object({kind:z.enum(['new','random']).optional()}),
    handler: async ({kind}={}) => recentTopics(kind),
  }),
  searchTopics: fn({
    summary: 'Full-text search across topics and posts on the CURRENT forum origin only. ★ primary entry.',
    input: z.object({
      query: z.string().describe('Search query, e.g. "amex platinum 175k"'),
      page: z.number().int().min(0).optional(),
      order: z
        .enum(['relevance', 'latest', 'views', 'likes', 'activity', 'posts'])
        .optional()
        .describe('Default "relevance". Use "latest" for time-ordered, "likes" for hottest.'),
    }),
    examples: [
      { args: { query: 'chase sapphire reserve' } },
      { args: { query: 'IHG ghost reservation', order: 'latest' } },
    ],
    handler: async ({ query, page, order }) => {
      const params = new URLSearchParams({ q: query });
      if (page !== undefined) params.set('page', String(page));
      if (order !== undefined) params.set('order', order);
      return compactSearchResult(await queuedSearch(`/search.json?${params}`));
    },
  }),

  getTopic: fn({
    summary: 'Preview the first 5 posts only. Read posts[].text; use readTopicPosts for replies or full-thread coverage.',
    input: z.object({ id: z.number().int().positive(), maxChars: z.number().int().min(500).max(20000).optional().describe("Maximum characters per post; default 4000. Increase to recover a truncated body.") }),
    output: TopicResultSchema,
    examples: [{ args: { id: 12345 } }],
    handler: async ({ id, maxChars }) => compactTopicResult(await getJson(`/t/${id}.json`), maxChars),
  }),

  getTopicPosts: fn({
    summary: 'Fetch a topic starting from a specific post number (paginated). Read posts[].text.',
    input: z.object({
      topicId: z.number().int().positive(),
      maxChars: z.number().int().min(500).max(20000).optional(),
      postNumber: z.number().int().min(1).optional().describe('1-indexed. Default 1.'),
    }),
    output: TopicResultSchema,
    handler: async ({ topicId, postNumber, maxChars }) =>
      readTopicRange({topicId,fromPostNumber:postNumber ?? 1,limit:5,maxChars:maxChars ?? 4000}),
  }),

  getCategories: fn({
    summary: 'List forum categories (with subcategories).',
    input: z.object({}),
    handler: async () => getJson('/categories.json?include_subcategories=true'),
  }),

  getLatest: fn({
    summary: 'List latest topics (default sort: most recent activity).',
    input: z.object({
      order: z.enum(['created', 'latest']).optional(),
      page: z.number().int().min(0).optional(),
    }),
    handler: async ({ order, page }) => {
      const params = new URLSearchParams();
      if (order) params.set('order', order);
      if (page !== undefined) params.set('page', String(page));
      const qs = params.toString();
      return getJson(`/latest.json${qs ? '?' + qs : ''}`);
    },
  }),

  getHot: fn({
    summary: 'List hot topics (Discourse-computed trending).',
    input: z.object({ page: z.number().int().min(0).optional() }),
    handler: async ({ page }) => {
      const params = new URLSearchParams();
      if (page !== undefined) params.set('page', String(page));
      const qs = params.toString();
      return getJson(`/hot.json${qs ? '?' + qs : ''}`);
    },
  }),

  getCurrentUser: fn({
    summary: "Return the currently-logged-in user's session info, or null if anonymous.",
    input: z.object({}),
    handler: async () => getJson('/session/current.json'),
  }),

  getUserSummary: fn({
    summary: "Fetch a user's profile summary (badges, top topics, stats).",
    input: z.object({ username: z.string().min(1) }),
    handler: async ({ username }) => getJson(`/u/${encodeURIComponent(username)}/summary.json`),
  }),

  getNotifications: fn({
    summary: 'List unread + recent notifications for the current user.',
    input: z.object({ limit: z.number().int().min(1).max(60).optional() }),
    handler: async ({ limit }) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.toString();
      return getJson(`/notifications.json${qs ? '?' + qs : ''}`);
    },
  }),

  getSite: fn({
    summary: 'Fetch site-level metadata (categories, archetypes, custom fields).',
    input: z.object({}),
    handler: async () => getJson('/site.json'),
  }),

  replyToTopic: fn({
    summary: 'Post a reply to a topic. Requires the user to be signed in.',
    input: z.object({
      topicId: z.number().int().positive(),
      raw: z.string().min(1).describe('Markdown body of the reply.'),
      replyToPostNumber: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Quote a specific post in the topic.'),
    }),
    handler: async ({ topicId, raw, replyToPostNumber }) => {
      const body = { topic_id: topicId, raw };
      if (replyToPostNumber !== undefined) body.reply_to_post_number = replyToPostNumber;
      const r = await csrfFetch('/posts.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = (await r.text()).slice(0, 200);
        throw new Error(`POST /posts.json -> HTTP ${r.status}: ${text}`);
      }
      return await r.json();
    },
  }),
}, {
  instructions: `Use readTopicPosts when replies can affect the answer, including short topics. getTopic is only a five-post preview, never evidence of full-thread coverage. On every continuation, check first_post_number, last_post_number, returned post IDs and next_cursor against the previous result and requested floor. If the range or cursor does not advance, stop repeating that request; recover with a targeted floor read or state exactly which replies remain unread. For current offers, inspect dated relevant replies and distinguish current verified evidence from historical posts. For large or full-thread reads, call discourse.readTopicPosts and follow next_cursor sequentially; do not write Promise.all pagination loops. Cursors expire after 60 seconds: resume from next_post_number. Recover text_truncated bodies with fromPostNumber, limit:1, textOffset:next_text_offset. Search is scoped to location.origin. Discourse shortcuts already supply fetched topic bodies in action-result. Use those results first; only fetch more when missing or truncated text affects the answer. For summaries, state whether all visible posts or the first and latest 30 posts were selected. Never present title-only guesses as verified content. Respond in the conversation's language, or otherwise match the forum's language.`,
  actions: [
    {label:'Latest topics', prompt:"Summarize the newest topics from action-result with a short description, creation time and clickable Markdown link for each. Sort by creation time; activity on old topics does not make them new. Use the conversation's language or match the forum's language.",js:"return await xgoose.skills.discourse.getRecentTopics({kind:'new'});"},
    {label:'Summarize this thread', prompt:"Summarize the thread in action-result: include context from the first post, recent developments, useful evidence and disagreements, with links to specific posts. Through floor 300 use all visible posts; above 300 use the first post and latest 30 posts. State the selected range and any text truncation; retrieve longer relevant bodies with discourse.getTopicPosts when needed. If not on a topic page, ask the user to open a topic. Use the conversation's language or match the forum's language.",js:'return await xgoose.skills.discourse.readTopicForSummary({});'},
    {label:'Surprise me randomly', prompt:"Recommend the five randomly sampled recent topics in action-result. Give each a title, one-sentence reason, update date and clickable Markdown link. No duplicates or invented content; identify unread topics and say if fewer than five are available. Use the conversation's language or match the forum's language.",js:"return await xgoose.skills.discourse.getRecentTopics({kind:'random'});"},
  ],
});
