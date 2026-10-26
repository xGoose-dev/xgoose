// ==XGooseSkill==
// @name         discourse-forum
// @namespace    discourse
// @version      0.2.11
// @description  Search Discourse forums, read topics and replies, and research community insights.
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
    ? raw.topics.map((t) => ({
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
    ? raw.posts.map((p) => ({
        id: p.id,
        topic_id: p.topic_id,
        post_number: p.post_number,
        username: p.username,
        created_at: p.created_at,
        like_count: p.like_count,
        blurb: p.blurb,
      }))
    : [];
  return {
    status: raw.status ?? 'ok',
    topics,
    posts,
    total_topics: Array.isArray(raw.topics) ? raw.topics.length : undefined,
    total_posts: Array.isArray(raw.posts) ? raw.posts.length : undefined,
    ...(raw.grouped_search_result?{grouped_search_result:raw.grouped_search_result}:{}),
    hint: 'Search snippets only. Read relevant posts with readTopicPosts({topicId}); getTopic returns a five-post preview.',
  };
}

function htmlToText(html) {
  if (typeof html !== 'string') return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.innerText || div.textContent || '').replace(/\s+/g, ' ').trim();
}

function compactTopicResult(raw, maxChars) {
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
        text: maxChars === undefined ? htmlToText(p.cooked || p.blurb || p.raw) : htmlToText(p.cooked || p.blurb || p.raw).slice(0, maxChars),
        text_truncated: maxChars !== undefined && htmlToText(p.cooked || p.blurb || p.raw).length > maxChars,
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
    hint: 'First five posts only; bodies are in posts[].text. Use readTopicPosts for replies or truncated text.',
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
  posts_count: z.number().optional().describe('Total posts including the opening post.'),
  reply_count: z.number().optional().describe('Direct reply relationships, not total topic replies.'),
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
            'Plain-text post body, limited by maxChars.',
          ),
      }),
    )
    .describe('First five posts; use readTopicPosts for replies.'),
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
async function summaryTopic(topicId, firstReplies=30, latestReplies=100) {
  const route = location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/);
  const id = topicId || (route ? Number(route[1]) : null);
  if (!Number.isSafeInteger(id) || id <= 0) return {status:'not_a_topic',message:'Open a topic before using Summarize this thread.'};
  const topic = await forumJson(`/t/${id}.json`);
  const stream = topic.post_stream?.stream;
  if (!Array.isArray(stream) || !stream.length) throw new Error('Forum did not return a readable post stream.');
  // Select actual visible replies, not arithmetic floor numbers: deleted floors
  // do not need replacement reads, and overlapping windows appear only once.
  const replies = stream.slice(1);
  const selected = [...new Set([stream[0], ...replies.slice(0,firstReplies), ...(latestReplies?replies.slice(-latestReplies):[])])];
  const posts = new Map((topic.post_stream?.posts || []).map(p=>[p.id,p]));
  const missing = selected.filter(id=>!posts.has(id));
  // Sequential, bounded reads avoid turning a shortcut into a burst of forum requests.
  for (let offset=0;offset<missing.length;offset+=20) {
    const params = new URLSearchParams();
    for (const postId of missing.slice(offset,offset+20)) params.append('post_ids[]',String(postId));
    const result = await forumJson(`/t/${id}/posts.json?${params}`);
    for (const post of result.post_stream?.posts || []) posts.set(post.id,post);
  }
  const result = selected.map(postId=>posts.get(postId)).filter(Boolean).map(post=>{
    const text=postText(post);
    return {post_number:post.post_number,username:post.username,created_at:post.created_at,text,text_truncated:false,url:`${topicLink(id)}/${post.post_number}`};
  });
  return {title:topic.title,url:topicLink(id),posts_count:topic.posts_count,highest_post_number:topic.highest_post_number,
    selection:selected.length===stream.length?'all visible posts':`first post, first ${firstReplies} replies and latest ${latestReplies} replies`,selected_count:selected.length,read_count:result.length,
    complete:result.length===selected.length,posts:result,
    hint:'Read posts[].text. Counts are approximate; selection and text_truncated describe the returned data.'};
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
      const detail=compactTopicResult(await forumJson(`/t/${item.id}.json`));
      topics.push({id:item.id,title:item.title,url:topicLink(item.id),created_at:item.created_at,last_posted_at:item.last_posted_at,posts:detail.posts || []});
    } catch(error) { topics.push({id:item.id,title:item.title,url:topicLink(item.id),read_error:String(error)}); }
  }
  return {kind,topics,hint:'Five-post previews with titles, dates and topic links.'};
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
  limit: z.number().int().min(1).max(300).default(100).describe('Maximum posts per call.'),
  maxChars: z.number().int().positive().optional().describe('Optional characters per post; omitted returns the full body.'),
  maxTotalChars: z.number().int().positive().optional().describe('Optional total body character budget. Stops between posts and returns next_cursor; a single oversized post is returned whole.'),
  textOffset: z.number().int().min(0).default(0).describe('To recover a long post, set fromPostNumber to that floor, limit:1 and this offset.'),
}).strict().superRefine((value, ctx) => {
  if (value.cursor && (value.fromPostNumber !== undefined || value.textOffset)) ctx.addIssue({code:'custom',message:'Use cursor alone, or fromPostNumber/textOffset.'});
  if (value.textOffset && (value.limit !== 1 || value.fromPostNumber === undefined)) ctx.addIssue({code:'custom',message:'textOffset requires fromPostNumber and limit:1.'});
});

const TopicReadResult = z.object({
  status:z.string(),origin:z.string(),
  posts_count:z.number().optional().describe('Total posts including the opening post.'),
  highest_post_number:z.number().optional().describe('Last floor number; deleted posts can leave gaps.'),
  posts:z.array(z.object({
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
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Forum did not provide a visible post-ID stream.');
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
  const end = maxChars === undefined ? text.length : Math.min(text.length, textOffset+maxChars);
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
        if(!candidates.length && args.fromPostNumber<=(state.topic.highest_post_number || Infinity))throw new Error('Forum did not return the requested floor or a following visible floor.');
      }
      offset=candidates.length?state.ids.indexOf(candidates[0].id):state.ids.length;
      if (offset<0) throw new Error('Topic post stream changed. Restart the range read.');
    }
  }
  const start=offset, end=Math.min(state.ids.length,start+args.limit), posts=[], missing=[];
  let failure=null, outputLimited=false, totalChars=0;
  const makeResult=() => ({id:args.topicId,title:String(state.topic.title || '').slice(0,500),url:`${location.origin}/t/${args.topicId}`,origin:location.origin,
    status:failure?.status || 'ok',...(failure?{httpStatus:failure.httpStatus,message:failure.message,retry_after_ms:failure.retry_after_ms}:{}),
    posts_count:state.topic.posts_count,highest_post_number:state.topic.highest_post_number,visible_post_count:state.ids.length,
    requested_from_post_number:args.fromPostNumber ?? null,first_post_number:posts[0]?.post_number ?? null,last_post_number:posts.at(-1)?.post_number ?? null,
    read_count:posts.length,missing_post_ids:missing,output_limited:outputLimited,
    range_complete:!failure && !missing.length && !outputLimited,text_complete:posts.every(post=>!post.text_truncated),
    complete:start===0 && offset===state.ids.length && !failure && !missing.length && posts.every(post=>!post.text_truncated),
    next_cursor:offset<state.ids.length?rangeCursor(state,offset):null,
    next_post_number:offset<state.ids.length?(state.posts.get(state.ids[offset])?.post_number ?? (posts.at(-1)?.post_number !== undefined?posts.at(-1).post_number+1:args.fromPostNumber || 1)):null,
    posts,hint:'Bodies: posts[].text. Continue next_cursor sequentially. missing_post_ids and text_truncated describe gaps and partial bodies.'});
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
    if(args.maxTotalChars !== undefined && posts.length && totalChars+entry.text.length>args.maxTotalChars){outputLimited=true;break;}
    totalChars+=entry.text.length;
    posts.push(entry);offset++;
  }
  return makeResult();
}

export default defineSkill({
  readTopicPosts: fn({
    summary: 'Read full post bodies in a topic range with automatic batching; follow next_cursor for more posts.',
    input: TopicReadInput,
    output: TopicReadResult,
    examples: [{args:{topicId:541783,fromPostNumber:632,limit:100}},{args:{topicId:541783,fromPostNumber:632,limit:1,maxChars:6000}}],
    handler: readTopicRange,
  }),

  readTopicForSummary: fn({
    summary: 'Read the original post, first 30 replies and latest 100 replies by default; deduplicate overlaps.',
    input: z.object({topicId:z.number().int().positive().optional(),firstReplies:z.number().int().min(0).max(300).default(30),latestReplies:z.number().int().min(0).max(300).default(100)}),
    handler: async ({topicId,firstReplies,latestReplies}={}) => summaryTopic(topicId,firstReplies,latestReplies),
  }),
  getRecentTopics: fn({
    summary: 'Read recent new topics or five randomly selected latest topics, with original links.',
    input: z.object({kind:z.enum(['new','random']).optional()}),
    handler: async ({kind}={}) => recentTopics(kind),
  }),
  searchTopics: fn({
    summary: 'Full-text search across topics and posts on the CURRENT forum origin only. ★ primary entry.',
    input: z.object({
      query: z.string().describe('Keywords and Discourse operators: in:title, @username, category:slug, #tag, after:YYYY-MM-DD, before:YYYY-MM-DD, exact phrases or -exclude.'),
      page: z.number().int().min(0).optional().describe('Search page, starting at 1.'),
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
    summary: 'Preview topic metadata and its first five posts. Use readTopicPosts for replies.',
    input: z.object({ id: z.number().int().positive(), maxChars: z.number().int().positive().optional().describe('Optional characters per post; omitted returns the full body.') }),
    output: TopicResultSchema,
    examples: [{ args: { id: 12345 } }],
    handler: async ({ id, maxChars }) => compactTopicResult(await getJson(`/t/${id}.json`), maxChars),
  }),

  getTopicPosts: fn({
    summary: 'Read five posts at or after postNumber. Use readTopicPosts for larger ranges.',
    input: z.object({
      topicId: z.number().int().positive(),
      maxChars: z.number().int().positive().optional(),
      postNumber: z.number().int().min(1).optional().describe('1-indexed. Default 1.'),
    }),
    output: TopicReadResult,
    handler: async ({ topicId, postNumber, maxChars }) =>
      readTopicRange({topicId,fromPostNumber:postNumber ?? 1,limit:5,maxChars}),
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
        .describe('Reply to this post number within the topic.'),
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
  instructions: `Find relevant discussions, read key posts and summarize community consensus and actionable data points.
- Prioritize recent information, helpful topics with high engagement, first-hand experiences and official announcements or policy changes.
- Use provided action-result first. Search snippets locate discussions; read bodies for content claims. Listing/count questions need the requested metadata only.
- Check topic size before choosing reading depth. getTopic and getTopicPosts return five posts. Use readTopicPosts for larger ranges with a bounded limit; follow next_cursor sequentially. If expired, resume from next_post_number. Recover needed truncated text with fromPostNumber, limit:1 and textOffset:next_text_offset.
- Summarize rather than quote whole threads. Describe outcomes, dates, amounts and relevant circumstances; include author, available likes and post links. Follow the user's scope and language.`,
  actions: [
    {label:'Latest topics', prompt:"List the newest topics in action-result by creation time, with a short description and source link for each.",js:"return await xgoose.skills.discourse.getRecentTopics({kind:'new'});"},
    {label:'Summarize this thread', prompt:"Summarize the original post, first 30 and latest 100 replies, deduplicating overlaps. Summarize community consensus and actionable DPs with authors, dates and sources. Follow user-specified ranges.",js:'return await xgoose.skills.discourse.readTopicForSummary({});'},
    {label:'Surprise me randomly', prompt:"Recommend the sampled topics in action-result with a title, reason, update date and source link.",js:"return await xgoose.skills.discourse.getRecentTopics({kind:'random'});"},
  ],
});
