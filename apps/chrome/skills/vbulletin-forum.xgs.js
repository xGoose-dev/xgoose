// ==XGooseSkill==
// @name         vbulletin-forum
// @namespace    vbulletin
// @version      0.1.3
// @description  Generic helpers for vBulletin 3.x/4.x forums (search posts/threads, summarize threads, fetch recent threads, getForum).
// @match        *://www.flyertalk.com/*
// @match        *://flyertalk.com/*
// @detect       !!document.querySelector('meta[name="generator"][content*="vBulletin"]') || /vbulletin/i.test(document.documentElement.outerHTML.slice(0, 4000))
// @run-at       document_idle
// @primary      searchPosts
// @keyword      vbulletin
// @keyword      forum
// @keyword      thread
// @keyword      flyertalk
// @keyword      milage run
// ==/XGooseSkill==

/**
 * vBulletin scraper. There is no official JSON API; we hit:
 *
 *   GET  /forum/search.php?do=process&type=thread          → search threads
 *   GET  /forum/search.php?do=process&type=post            → search posts
 *   GET  /forum/external.php?type=RSS2&forumids=…          → recent threads (RSS)
 *   GET  /forum/forumdisplay.php?f={id}                    → forum landing page
 *   GET  /forum/showthread.php?t={id}&page={n}             → thread page
 *
 * All endpoints are anonymous-OK; we always send `credentials: 'include'` so
 * the user's `usergroup` cookie is attached and they see proper access.
 *
 * Output shapes match what `flyertalk.searchAll` expects (see flyertalk skill).
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const SEARCH_URL = '/forum/search.php';

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function txt(node) {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseInteger(s) {
  const m = String(s ?? '').match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

function parseThreadIdFromHref(href) {
  if (!href) return null;
  let m = href.match(/showthread\.php\?(?:[^#]*?&)?t=(\d+)/);
  if (m) return Number(m[1]);
  m = href.match(/\/forum\/[^/]+\/(\d+)-[^/]+\.html/);
  if (m) return Number(m[1]);
  return null;
}

function parsePostIdFromHref(href) {
  if (!href) return null;
  let m = href.match(/showpost\.php\?p=(\d+)/);
  if (m) return Number(m[1]);
  m = href.match(/[?&#]p(?:ost)?=?(\d+)/);
  if (m) return Number(m[1]);
  return null;
}

function parseForumIdFromHref(href) {
  if (!href) return null;
  let m = href.match(/forumdisplay\.php\?(?:[^#]*?&)?f=(\d+)/);
  if (m) return Number(m[1]);
  m = href.match(/\/forum\/[^/]+-(\d+)\/?(?:\?|$)/);
  if (m) return Number(m[1]);
  return null;
}

async function postSearch(opts) {
  const params = new URLSearchParams({ do: 'process' });
  const body = new URLSearchParams({
    s: '',
    securitytoken: 'guest',
    do: 'process',
    type: opts.type,
    query: opts.query,
    titleonly: opts.titleOnly ? '1' : '0',
    showposts: opts.type === 'post' ? '1' : '0',
  });
  if (opts.author) {
    body.set('searchuser', opts.author);
    if (opts.exactName) body.set('exactname', '1');
    if (opts.starterOnly) body.set('starteronly', '1');
  }
  if (opts.forumIds?.length) {
    for (const f of opts.forumIds) body.append('forumchoice[]', String(f));
  }
  if (opts.page) body.set('page', String(opts.page));
  const r = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-cache',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
    body: body.toString(),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`vbulletin.search → HTTP ${r.status}`);
  const text = await r.text();
  // After redirect, the URL may contain ?searchid=...
  const searchId = Number(new URL(r.url).searchParams.get('searchid')) || 0;
  return { searchId, text, finalUrl: r.url };
}

function extractPosts(doc) {
  const rows = doc.querySelectorAll('table.tborder tr, li.threadbit, li.postbit, .searchposts li, div.search_result');
  const results = [];
  rows.forEach((row) => {
    const titleA = row.querySelector('a.title, h3 a, a[href*="showpost.php"], a[href*="showthread.php"]');
    if (!titleA) return;
    const href = titleA.getAttribute('href') ?? '';
    const postId = parsePostIdFromHref(href);
    const threadId = parseThreadIdFromHref(href);
    if (!threadId) return;
    const snippet = row.querySelector('blockquote, .excerpt, .searchresult_excerpt, .snippet');
    const author = row.querySelector('.username, .bigusername, a[href*="member.php"]');
    const date = row.querySelector('.date, .smaller, .time, .post_date');
    const replyCount = row.querySelector('.replycount, .views, .stats');
    results.push({
      postId: postId ?? 0,
      postUrl: new URL(href, location.origin).toString(),
      threadId,
      threadTitle: txt(titleA),
      threadUrl: new URL(href, location.origin).toString(),
      forumId: 0,
      forumName: '',
      forumSlug: '',
      author: txt(author) || undefined,
      dateText: txt(date),
      replyCount: parseInteger(txt(replyCount)),
      snippetText: txt(snippet),
      snippetHtml: snippet?.innerHTML ?? '',
    });
  });
  return results;
}

function extractThreads(doc) {
  const rows = doc.querySelectorAll('tr[id^="thread_"], li.threadbit');
  const results = [];
  rows.forEach((row) => {
    const titleA = row.querySelector('a.title, h3 a, a[href*="showthread.php"]');
    if (!titleA) return;
    const href = titleA.getAttribute('href') ?? '';
    const threadId = parseThreadIdFromHref(href);
    if (!threadId) return;
    const author = row.querySelector('.username, .bigusername, a[href*="member.php"]');
    const date = row.querySelector('.date, .smaller, .time');
    const replyCell = row.querySelector('.alt2.smallfont a[href*="misc.php?do=showthreadviewsstats"], .replies a, .replies');
    results.push({
      threadId,
      threadTitle: txt(titleA),
      threadUrl: new URL(href, location.origin).toString(),
      forumId: 0,
      forumName: '',
      forumSlug: '',
      starter: txt(author) || undefined,
      dateText: txt(date),
      replyCount: parseInteger(txt(replyCell)),
    });
  });
  return results;
}

async function getThreadPage(threadId, page) {
  const url = `/forum/showthread.php?t=${threadId}${page ? `&page=${page}` : ''}`;
  const r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
  if (!r.ok) throw new Error(`getThreadPage → HTTP ${r.status}`);
  const text = await r.text();
  return { url, doc: parseHtml(text) };
}

function extractPostList(doc, start=0, maxChars) {
  const posts = [];
  doc.querySelectorAll('div[id^="edit"], li.postbitlegacy, table[id^="post"], div.post').forEach((el, idx) => {
    const counter = el.querySelector('.postcounter');
    const num = counter?.textContent ?? '';
    const postId = parsePostIdFromHref(counter?.getAttribute('href')) || Number(el.id?.match(/^(?:edit|post)(\d+)$/)?.[1]) || null;
    const author = el.querySelector('.username, .bigusername, a[href*="member.php"]');
    const date = el.querySelector('.date, .postdate, .post_date');
    const body = el.querySelector('blockquote.postcontent, .post_message, .postbody');
    posts.push({
      postNumber: parseInteger(num) || start + idx + 1,
      postId,
      author: txt(author),
      date: txt(date),
      snippet: maxChars === undefined ? txt(body) : txt(body).slice(0, maxChars),
      text_truncated: maxChars !== undefined && txt(body).length > maxChars,
    });
  });
  return posts;
}

function extractThreadMeta(doc) {
  const titleEl = doc.querySelector('h1, .threadtitle, [class*="threadtitle"]');
  const totalPagesEl = doc.querySelector('.pagenav td.vbmenu_control, .pagination, span.selected');
  const totalPagesMatch = txt(totalPagesEl).match(/of\s+(\d+)/i);
  return {
    title: txt(titleEl),
    totalPages: totalPagesMatch ? Number(totalPagesMatch[1]) : 1,
  };
}

export default defineSkill({
  searchPosts: fn({
    summary: 'Full-text search across forum posts. ★ primary entry.',
    input: z.object({
      query: z.string(),
      forumIds: z.array(z.number().int().positive()).optional(),
      author: z.string().optional(),
      exactName: z.boolean().optional(),
      page: z.number().int().min(1).optional(),
    }),
    examples: [{ args: { query: 'amex platinum 175k' } }],
    handler: async (p) => {
      const { searchId, text, finalUrl } = await postSearch({ ...p, type: 'post' });
      const doc = parseHtml(text);
      const results = extractPosts(doc);
      const page = Number(new URL(finalUrl).searchParams.get('page')) || 1;
      return { searchId, results, page, totalPages: null, hasMore: results.length >= 25 };
    },
  }),

  searchThreads: fn({
    summary: 'Search forum threads by title.',
    input: z.object({
      query: z.string(),
      forumIds: z.array(z.number().int().positive()).optional(),
      author: z.string().optional(),
      exactName: z.boolean().optional(),
      starterOnly: z.boolean().optional(),
      titleOnly: z.boolean().optional(),
      page: z.number().int().min(1).optional(),
    }),
    handler: async (p) => {
      const { searchId, text, finalUrl } = await postSearch({ ...p, type: 'thread' });
      const doc = parseHtml(text);
      const results = extractThreads(doc);
      const page = Number(new URL(finalUrl).searchParams.get('page')) || 1;
      return { searchId, results, page, totalPages: null, hasMore: results.length >= 25 };
    },
  }),

  summarizeThread: fn({
    summary: 'Read a thread. Defaults to the original post plus first 30/latest 100 replies; counts, mode, page and text size are configurable.',
    input: z.object({
      threadId: z.number().int().positive(),
      mode: z.enum(['latest', 'first', 'first+last', 'full', 'tldr']).optional(),
      firstReplies: z.number().int().min(0).max(300).default(30),
      latestReplies: z.number().int().min(0).max(300).default(100),
      maxChars: z.number().int().positive().optional(),
      page: z.number().int().optional().describe('Specific page; negative is from end (-1=last, -2=second-to-last).'),
      maxPosts: z.number().int().min(1).max(601).optional(),
    }),
    handler: async ({ threadId, mode, page, maxPosts, firstReplies=30, latestReplies=100, maxChars }) => {
      const m = mode ?? 'first+last';
      const cap = maxPosts ?? (m==='first+last'||m==='tldr'?1+firstReplies+latestReplies:10);
      let perPage=0;
      const cache=new Map();
      const fetchPage = async (p=1) => {
        if(cache.has(p))return cache.get(p);
        const { doc, url } = await getThreadPage(threadId, p);
        const value={doc,url:new URL(url,location.origin).href,posts:extractPostList(doc,(p-1)*perPage,maxChars),meta:extractThreadMeta(doc)};
        for(const post of value.posts)post.url=post.postId?`${value.url}#post${post.postId}`:value.url;
        cache.set(p,value);return value;
      };
      const first = await fetchPage(undefined);
      const totalPages = first.meta.totalPages;
      perPage=first.posts.length;
      const out = { thread: { id: threadId, title: first.meta.title, url: first.url }, totalPages, page: 1, posts: [] };
      if(!perPage)return {...out,coverage:'No readable posts returned.'};
      if (m === 'first') {
        out.posts = first.posts.slice(0, cap);
        return out;
      }
      if ((m === 'first+last' || m === 'tldr') && page === undefined) {
        const head=[...first.posts],tail=[];
        for(let p=2;p<=totalPages && head.length<1+firstReplies;p++)head.push(...(await fetchPage(p)).posts);
        for(let p=totalPages;p>=1 && tail.length<latestReplies;p--)tail.unshift(...(await fetchPage(p)).posts);
        const selected=[...head.slice(0,1+firstReplies),...(latestReplies?tail.filter(post=>post.postNumber!==first.posts[0]?.postNumber).slice(-latestReplies):[])];
        out.posts=[...new Map(selected.map(post=>[post.postNumber,post])).values()].slice(0,cap);
        out.selection=`original post, first ${firstReplies} replies and latest ${latestReplies} replies`;
        out.pagesRead=[...cache.keys()].sort((a,b)=>a-b);
        return out;
      }
      if (m === 'full') {
        const all = [first.posts];
        for (let p = 2; p <= totalPages && all.flat().length < cap; p++) {
          all.push((await fetchPage(p)).posts);
        }
        out.posts = all.flat().slice(0, cap);
        return out;
      }
      // 'latest' (default) or explicit page
      let targetPage = totalPages;
      if (typeof page === 'number') targetPage = page < 0 ? Math.max(1, totalPages + page + 1) : page;
      const last = targetPage === 1 ? first : await fetchPage(targetPage);
      out.page = targetPage;
      out.posts = last.posts.slice(-cap);
      return out;
    },
  }),

  getRecentThreads: fn({
    summary: 'Recent threads in one or more forums (RSS). With full=true also fetches each thread page.',
    input: z.object({
      forumIds: z.array(z.number().int().positive()).min(1),
      full: z.boolean().optional(),
    }),
    handler: async ({ forumIds, full }) => {
      const url = `/forum/external.php?type=RSS2&forumids=${forumIds.join(',')}`;
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/rss+xml' } });
      if (!r.ok) throw new Error(`getRecentThreads → HTTP ${r.status}`);
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const items = doc.querySelectorAll('item');
      const results = [];
      items.forEach((item) => {
        const link = item.querySelector('link')?.textContent ?? '';
        const title = item.querySelector('title')?.textContent ?? '';
        const pubDate = item.querySelector('pubDate')?.textContent ?? '';
        const author = item.querySelector('author')?.textContent ?? '';
        const contentText = item.querySelector('description')?.textContent ?? '';
        const threadId = parseThreadIdFromHref(link);
        results.push({
          threadId: threadId ?? 0,
          title,
          link,
          author,
          pubDate,
          contentText,
        });
      });
      return full ? results : results.map((r) => ({ ...r, contentText: undefined }));
    },
  }),

  getForum: fn({
    summary: 'Fetch a forum index page; returns the forum title + slug + thread links.',
    input: z.object({ id: z.number().int().positive() }),
    handler: async ({ id }) => {
      const url = `/forum/forumdisplay.php?f=${id}`;
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
      if (!r.ok) throw new Error(`getForum → HTTP ${r.status}`);
      const text = await r.text();
      const doc = parseHtml(text);
      const finalUrl = r.url;
      const slugMatch = finalUrl.match(/\/forum\/([^/?#]+)-\d+/);
      return {
        id,
        slug: slugMatch ? slugMatch[1] : '',
        title: txt(doc.querySelector('h1, .forumtitle')),
        url: finalUrl,
        threads: extractThreads(doc),
      };
    },
  }),
});
