// ==XGooseSkill==
// @name         discuz-forum
// @namespace    discuz
// @version      0.2.1
// @description  Discuz forums: native search options, boards, thread posts, full floor continuation, numbered images, attachments, member profiles and topic/reply history. Browser-session mobile API and HTML access; UTF-8/GBK.
// @match        *://stage1st.com/*
// @match        *://*.stage1st.com/*
// @match        *://www.mydigit.cn/*
// @match        *://bbs.kafan.cn/*
// @match        https://*/*
// @match        http://*/*
// @detect       !!document.querySelector('meta[name="generator"][content^="Discuz!"]') || typeof window.discuz_uid !== 'undefined'
// @run-at       document_idle
// @connect      <self>
// @primary      searchThreads
// @keyword      discuz
// @keyword      forum
// @keyword      bbs
// @keyword      论坛
// @keyword      帖子
// @keyword      stage1st
// @keyword      s1
// @keyword      泥潭
// @keyword      卡饭
// @keyword      数码之家
// @action       概括这个帖子 | 用 discuz.getThread 读取当前帖子：先读第 1 页（主楼和早期回复），再用 page:-1 读最后一页。概括主楼内容、主要观点和分歧、最新进展，标注楼层并附原帖链接。
// @action       本版热帖 | 用 discuz.listThreads 以 order:"heats" 列出当前版块的热门主题（不在版块页时先用 listForums 选一个版块并说明）。挑出有意思的主题，附回复数和链接，不要把标题列表当成已读正文。
// @action       本版新帖 | 用 discuz.listThreads 以 order:"dateline" 列出当前版块最新发布的主题（不在版块页时先用 listForums 选一个版块）。给出看点、发帖时间和链接。
// ==/XGooseSkill==

/**
 * Discuz! X3.x reader. Captured against stage1st.com/2b (Discuz! X3.5, UTF-8)
 * and bbs.kafan.cn (X3.4, GBK, mobile API disabled).
 *
 * Activation: matches every site. The xgoose extension checks the same
 * markers as @detect (generator meta or an inline `discuz_uid =`) before
 * injecting, so non-Discuz pages never load this bundle.
 *
 * Root: Discuz may live under a sub-path (/2b/, /bbs/). Every page defines
 * `var SITEURL = '…'` and `<base href>`; all requests are relative to that.
 *
 * Mobile JSON API (used first; many sites disable it or answer with HTML):
 *   GET api/mobile/index.php?version=4&module=forumindex
 *       → Variables.catlist[{fid,name,forums:[fid]}], forumlist[{fid,name,threads,posts,todayposts,description,sublist}]
 *   GET …&module=forumdisplay&fid={fid}&page={n}&tpp={≤50}&orderby={lastpost|dateline|replies|views|heats}[&filter=typeid&typeid=]
 *       → Variables.forum{fid,name,threads}, forum_threadlist[{tid,subject,author,authorid,dbdateline,dblastpost,lastposter,replies,views,displayorder,typeid}], threadtypes.types{id:name}
 *   GET …&module=viewthread&tid={tid}&page={n}[&authorid=]
 *       → Variables.thread{tid,fid,subject,author,authorid,dateline,replies,views}, postlist[{pid,number,author,authorid,dbdateline,message(HTML)}], ppp
 *       `ppp` is fixed server-side (40 on S1). Out-of-range pages are clamped to the last page.
 *   Errors: top-level Message{messageval,messagestr}, e.g. thread_nonexistence, or "mobile:外野维护下".
 *
 * HTML (fallback, and the only search path):
 *   GET search.php?mod=forum&srchtxt={q}&searchsubmit=yes[&srchfid[]=][&srchuname=][&orderby=]
 *       → 302 to search.php?mod=forum&searchid={id}&…; results in li.pbw. Paging that searchid
 *       with &page=N does not count as a new search. Discuz search matches thread TITLES.
 *       Guests on S1: one new search per 10 s ("抱歉，您在 10 秒内只能进行一次搜索").
 *       GBK sites need the query percent-encoded as GBK, not UTF-8.
 *   GET forum.php?mod=forumdisplay&fid=…  → tbody[id^=normalthread_|stickthread_]
 *   GET forum.php?mod=viewthread&tid=…    → #postlist > div[id^=post_], body in td.t_f
 *   Site messages (maintenance, permissions, flood) render in #messagetext; a login
 *   wall adds #messagelogin.
 *
 * All requests send the browser's cookies, so a logged-in user sees member-only
 * boards and posts. Post bodies drop Discuz anti-copy "jammer" text and hidden spans.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const MAX_SEARCH_WAIT_SECONDS = 15;
const searchIds = new Map();
const mobileApi = new Map();
const postCache = new Map();

function siteRoot() {
  const declared = typeof window.SITEURL === 'string' ? window.SITEURL : document.querySelector('base[href]')?.href;
  const url = new URL(declared || '.', location.href);
  return location.origin + url.pathname.replace(/[^/]*$/, '');
}

const absolute = (href) => new URL(href, siteRoot()).href;
const threadUrl = (tid, page) => absolute(`forum.php?mod=viewthread&tid=${tid}${page > 1 ? `&page=${page}` : ''}`);
const postUrl = (tid, pid) => absolute(`forum.php?mod=redirect&goto=findpost&ptid=${tid}&pid=${pid}`);
const forumUrl = (fid) => absolute(`forum.php?mod=forumdisplay&fid=${fid}`);

const txt = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const int = (value) => {
  const m = String(value ?? '').replace(/,/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : null;
};
const iso = (unix) => (int(unix) ? new Date(int(unix) * 1000).toISOString() : null);
const idFrom = (href, patterns) => {
  for (const re of patterns) {
    const m = String(href ?? '').match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
const tidOf = (href) => idFrom(href, [/[?&]tid=(\d+)/, /thread-(\d+)-/]);
const fidOf = (href) => idFrom(href, [/[?&]fid=(\d+)/, /forum-(\d+)-/]);
const uidOf = (href) => idFrom(href, [/[?&]uid=(\d+)/, /space-uid-(\d+)/]);

function charset(response) {
  return response.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] || document.characterSet || 'utf-8';
}

async function getHtml(path) {
  const r = await fetch(absolute(path), { credentials: 'include', headers: { Accept: 'text/html' } });
  const html = new TextDecoder(charset(r)).decode(await r.arrayBuffer());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Missing threads/boards come back as 404 pages that still carry a #messagetext notice.
  if (!r.ok && !doc.querySelector('#messagetext')) throw new Error(`discuz: GET ${path} → HTTP ${r.status}`);
  return { doc, url: r.url };
}

/** Site-rendered notices (maintenance, permission walls, flood control). */
function siteMessage(doc) {
  const box = doc.querySelector('#messagetext');
  if (!box) return null;
  box.querySelectorAll('script').forEach((n) => n.remove());
  return { message: txt(box.querySelector('p') ?? box), loginRequired: !!doc.querySelector('#messagelogin') };
}

function messageStatus({ message, loginRequired, code }) {
  if (loginRequired || /login|登录/i.test(`${code ?? ''} ${message}`)) return { status: 'login_required', message };
  if (/nonexistence|不存在|已被删除/i.test(`${code ?? ''} ${message}`)) return { status: 'not_found', message };
  return { status: 'site_message', message };
}

/** Returns Variables, a shaped status for site errors, or null when the mobile API is unavailable. */
async function api(module, params = {}) {
  if (mobileApi.get(module) === false) return null;
  const query = new URLSearchParams({ version: '4', module, ...params });
  const r = await fetch(absolute(`api/mobile/index.php?${query}`), { credentials: 'include' });
  // Errors such as thread_nonexistence arrive as HTTP 404 with a JSON body; only non-JSON means "no API".
  if (!/json/i.test(r.headers.get('content-type') ?? '')) {
    mobileApi.set(module, false);
    return null;
  }
  const data = await r.json();
  mobileApi.set(module, true);
  const v = data.Variables ?? {};
  const msg = data.Message;
  if (msg?.messageval && !(v.postlist?.length || v.forum_threadlist?.length || v.forumlist?.length)) {
    return { error: messageStatus({ code: msg.messageval, message: String(msg.messagestr ?? '').replace(/^mobile:/, '') }) };
  }
  if (!r.ok) throw new Error(`discuz: mobile API ${module} → HTTP ${r.status}`);
  return v;
}

let gbkTable;
function encodeQuery(text, cs) {
  if (!/gb/i.test(cs)) return encodeURIComponent(text);
  if (!gbkTable) {
    gbkTable = new Map();
    const decoder = new TextDecoder('gbk');
    const hex = (n) => n.toString(16).toUpperCase();
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        const ch = decoder.decode(new Uint8Array([lead, trail]));
        if (ch.length === 1 && ch !== '\ufffd' && !gbkTable.has(ch)) gbkTable.set(ch, `%${hex(lead)}%${hex(trail)}`);
      }
    }
  }
  return [...text].map((ch) => (ch.charCodeAt(0) < 0x80 ? encodeURIComponent(ch) : gbkTable.get(ch) ?? encodeURIComponent(ch))).join('');
}

/** Post HTML → plain text plus image URLs. Drops jammer text, smilies, edit stamps and attachment chrome. */
function postBody(html, maxChars) {
  const root = typeof html === 'string' ? new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body : html.cloneNode(true);
  root.querySelectorAll('script,style,.jammer,.pstatus,.tip,.aimg_tip,[style*="display:none"],[style*="display: none"]').forEach((n) => n.remove());
  const attachments = [...root.querySelectorAll('a[href*="mod=attachment"], a[href*="attachment.php"], a[href*="/data/attachment/"]')].map(a => ({name: txt(a), url: absolute(a.getAttribute('href'))}));
  const hidden = [...root.querySelectorAll('.locked, .showhide')].map(txt).filter(Boolean);
  const images = [];
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('zoomfile') || img.getAttribute('file') || img.getAttribute('src') || '';
    if (img.hasAttribute('smilieid') || /smiley|smilies|static\/image\//.test(src)) return img.remove();
    if (!src) return img.remove();
    const url = absolute(src);
    if (!images.includes(url)) images.push(url);
    img.replaceWith(`[image ${images.indexOf(url) + 1}]`);
  });
  root.querySelectorAll('.reply_wrap, .quote, blockquote').forEach((q) => {
    if (!root.contains(q)) return;
    q.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const lines = (q.textContent ?? '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    q.replaceWith(`\n${lines.map((line) => `> ${line}`).join('\n')}\n`);
  });
  root.querySelectorAll('a[href^="http"]').forEach((a) => {
    const label = txt(a);
    if (label && label !== a.href && !label.includes('...')) a.append(` (${a.href})`);
  });
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  root.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach((n) => n.append('\n'));
  const full = (root.textContent ?? '')
    .replace(/\[attach\]\d+\[\/attach\]/g, '[附件]')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: full.slice(0, maxChars), truncated: full.length > maxChars, totalChars: full.length, images, attachments, hidden };
}

function readBody(html, maxChars, tid, pid) {
  const body = postBody(html, Infinity);
  postCache.set(`${tid}:${pid}`, body);
  return {...body, text: body.text.slice(0, maxChars), truncated: body.text.length > maxChars,
    readMore: body.text.length > maxChars ? `getPost({threadId:${tid},postId:${pid},offset:${maxChars}})` : undefined,
    readImages: body.images.length ? `readPostImages({threadId:${tid},postId:${pid},images:[N]})` : undefined};
}

function pageCount(doc) {
  const pg = doc.querySelector('.pg');
  if (!pg) return 1;
  const declared = int(pg.querySelector('label span[title]')?.getAttribute('title'));
  return Math.max(declared ?? 1, ...[...pg.querySelectorAll('a')].map((a) => int(txt(a).replace(/^\.+/, '')) ?? 1));
}

const NAMED_FLOORS = { 楼主: 1, 沙发: 2, 板凳: 3, 地板: 4 };
function floorOf(node) {
  const label = txt(node);
  return int(label) ?? NAMED_FLOORS[label.replace(/[#\s]/g, '')] ?? null;
}

function displayedTime(node) {
  return node?.querySelector('span[title]')?.getAttribute('title') || txt(node).replace(/^发表于\s*/, '') || null;
}

function currentFid() {
  const crumbs = document.querySelectorAll('#pt a[href*="forum-"], #pt a[href*="fid="]');
  return int(window.fid) || fidOf(location.href) || fidOf(crumbs[crumbs.length - 1]?.getAttribute('href'));
}

function currentTid() {
  return int(window.tid) || tidOf(location.href);
}

// ---------- search ----------

function parseSearch(doc, url) {
  const results = [...doc.querySelectorAll('li.pbw')].map((li) => {
    const link = li.querySelector('h3 a');
    const tid = int(li.id) ?? tidOf(link?.getAttribute('href'));
    const stats = txt(li.querySelector('p.xg1'));
    const meta = li.querySelector('p:last-of-type');
    const authorLink = meta?.querySelector('a[href*="uid"]');
    const forumLink = meta?.querySelector('a[href*="forum-"], a[href*="fid="]');
    const excerpt = li.querySelectorAll('p')[1];
    return {
      tid,
      title: txt(link),
      url: threadUrl(tid),
      replies: int(stats.match(/(\d+)\s*个回复/)?.[1]),
      views: int(stats.match(/(\d+)\s*次查看/)?.[1]),
      excerpt: excerpt && excerpt !== meta ? txt(excerpt).slice(0, 300) : '',
      postedAt: txt(meta?.querySelector('span')) || null,
      author: txt(authorLink) || null,
      authorId: uidOf(authorLink?.getAttribute('href')),
      forum: txt(forumLink) || null,
      forumId: fidOf(forumLink?.getAttribute('href')),
    };
  });
  return {
    status: 'ok',
    searchId: int(new URL(url).searchParams.get('searchid')),
    total: int(txt(doc.querySelector('h2 em')).match(/(\d+)\s*个/)?.[1]),
    page: int(new URL(url).searchParams.get('page')) || 1,
    pages: pageCount(doc),
    results,
  };
}

async function runSearch({ query, forumIds, author, orderBy, filters }, retried = false) {
  const cs = document.characterSet;
  let path = `search.php?mod=forum&searchsubmit=yes&srchtxt=${encodeQuery(query, cs)}`;
  for (const fid of forumIds ?? []) path += `&srchfid%5B%5D=${fid}`;
  if (author) path += `&srchuname=${encodeQuery(author, cs)}`;
  if (orderBy) path += `&orderby=${orderBy}&ascdesc=desc`;
  for (const [name, value] of Object.entries(filters ?? {})) path += `&${encodeURIComponent(name)}=${encodeQuery(value, cs)}`;
  const { doc, url } = await getHtml(path);
  const notice = siteMessage(doc);
  if (!notice) return parseSearch(doc, url);
  const wait = int(notice.message.match(/(\d+)\s*秒/)?.[1]);
  if (wait !== null && /搜索/.test(notice.message)) {
    if (!retried && wait <= MAX_SEARCH_WAIT_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
      return runSearch({ query, forumIds, author, orderBy, filters }, true);
    }
    return { status: 'rate_limited', retryAfterSeconds: wait, message: notice.message };
  }
  return messageStatus(notice);
}

// ---------- boards and threads ----------

function forumFromApi(f) {
  return {
    fid: int(f.fid),
    name: txt(new DOMParser().parseFromString(f.name ?? '', 'text/html').body),
    description: f.description ? txt(new DOMParser().parseFromString(f.description, 'text/html').body) : null,
    threads: int(f.threads),
    posts: int(f.posts),
    todayPosts: int(f.todayposts),
    url: forumUrl(f.fid),
    subforums: (f.sublist ?? []).map(forumFromApi),
  };
}

async function listForumsHtml() {
  const { doc } = await getHtml('forum.php');
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  const headings = [...doc.querySelectorAll('h2 a[href*="gid="]')];
  const categories = [...doc.querySelectorAll('[id^="category_"]')]
    .filter((el) => /^category_\d+$/.test(el.id))
    .map((el) => {
      const gid = int(el.id);
      const seen = new Set();
      const forums = [...el.querySelectorAll('h2 a, dt a')]
        .map((a) => ({ a, fid: fidOf(a.getAttribute('href')) }))
        .filter(({ fid }) => fid && !seen.has(fid) && seen.add(fid))
        .map(({ a, fid }) => ({ fid, name: txt(a), url: forumUrl(fid), todayPosts: int(txt(a.parentElement?.querySelector('em'))) }));
      const heading = headings.find((a) => int(new URL(a.href, location.href).searchParams.get('gid')) === gid);
      return { name: txt(heading) || null, forums };
    })
    .filter((c) => c.forums.length);
  return { status: 'ok', source: 'html', categories };
}

const ORDER = {
  lastpost: { orderby: 'lastpost', filter: 'lastpost' },
  dateline: { orderby: 'dateline', filter: 'author' },
  replies: { orderby: 'replies', filter: 'reply' },
  views: { orderby: 'views', filter: 'reply' },
  heats: { orderby: 'heats', filter: 'heat' },
};

async function listThreadsApi({ fid, page, perPage, order, typeId, includeSticky }) {
  const params = { fid: String(fid), page: String(page), tpp: String(perPage), orderby: ORDER[order].orderby };
  if (typeId) Object.assign(params, { filter: 'typeid', typeid: String(typeId) });
  const v = await api('forumdisplay', params);
  if (!v || v.error) return v && v.error;
  const types = v.threadtypes?.types ?? {};
  const threads = v.forum_threadlist
    .filter((t) => includeSticky || int(t.displayorder) <= 0)
    .map((t) => ({
      tid: int(t.tid),
      title: t.subject,
      url: threadUrl(t.tid),
      type: types[t.typeid] ?? null,
      sticky: int(t.displayorder) > 0,
      author: t.author,
      authorId: int(t.authorid),
      postedAt: iso(t.dbdateline) ?? t.dateline,
      lastPostAt: iso(t.dblastpost) ?? t.lastpost,
      lastPoster: t.lastposter,
      replies: int(t.replies),
      views: int(t.views),
    }));
  return {
    status: 'ok',
    source: 'api',
    forum: { fid: int(v.forum.fid), name: v.forum.name, description: v.forum.description || null, threads: int(v.forum.threads), url: forumUrl(fid) },
    page: int(v.page) || page,
    pages: int(v.forum.threads) ? Math.ceil(int(v.forum.threads) / (int(v.tpp) || perPage)) : null,
    threads,
  };
}

async function listThreadsHtml({ fid, page, order, typeId, includeSticky }) {
  const { orderby, filter } = ORDER[order];
  const path = typeId
    ? `forum.php?mod=forumdisplay&fid=${fid}&filter=typeid&typeid=${typeId}&orderby=${orderby}&page=${page}`
    : `forum.php?mod=forumdisplay&fid=${fid}&filter=${filter}&orderby=${orderby}&page=${page}`;
  const { doc } = await getHtml(path);
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  const threads = [...doc.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')]
    .filter((row) => includeSticky || row.id.startsWith('normalthread_'))
    .map((row) => {
      const tid = int(row.id);
      const [starter, last] = row.querySelectorAll('td.by');
      const authorLink = starter?.querySelector('cite a');
      return {
        tid,
        title: txt(row.querySelector('a.xst')),
        url: threadUrl(tid),
        type: txt(row.querySelector('th em a')) || null,
        sticky: row.id.startsWith('stickthread_'),
        author: txt(starter?.querySelector('cite')) || null,
        authorId: uidOf(authorLink?.getAttribute('href')),
        postedAt: displayedTime(starter?.querySelector('em')),
        lastPostAt: displayedTime(last?.querySelector('em')),
        lastPoster: txt(last?.querySelector('cite')) || null,
        replies: int(txt(row.querySelector('td.num a'))),
        views: int(txt(row.querySelector('td.num em'))),
      };
    });
  return {
    status: 'ok',
    source: 'html',
    forum: { fid, name: txt(doc.querySelector('h1.xs2 a, .bm_h h1 a')) || null, description: null, threads: null, url: forumUrl(fid) },
    page,
    pages: pageCount(doc),
    threads,
  };
}

// ---------- thread posts ----------

async function threadPageApi({ tid, page, authorId, maxChars }) {
  const params = { tid: String(tid), page: String(page) };
  if (authorId) params.authorid = String(authorId);
  const v = await api('viewthread', params);
  if (!v || v.error) return v && v.error;
  const t = v.thread;
  const ppp = int(v.ppp) || 40;
  // With authorId the API gives no filtered total; report at least one more page while pages are full.
  const pages = authorId
    ? null
    : Math.max(1, Math.ceil((int(t.replies) + 1) / ppp));
  return {
    status: 'ok',
    source: 'api',
    thread: {
      tid: int(t.tid), title: t.subject, url: threadUrl(t.tid), forumId: int(t.fid),
      author: t.author, authorId: int(t.authorid), postedAt: iso(t.dateline),
      replies: int(t.replies), views: int(t.views), closed: t.closed === '1',
    },
    page: authorId ? (int(v.page) || page) : Math.min(page, pages),
    pages,
    hasMore: authorId ? v.postlist.length >= ppp : page < pages,
    posts: v.postlist.map((p) => ({
      pid: int(p.pid),
      floor: int(p.number) ?? int(p.position),
      author: p.author,
      authorId: int(p.authorid),
      postedAt: iso(p.dbdateline) ?? txt(new DOMParser().parseFromString(p.dateline ?? '', 'text/html').body),
      url: postUrl(t.tid, p.pid),
      ...readBody(p.message ?? '', maxChars, int(t.tid), int(p.pid)),
    })),
  };
}

async function threadPageHtml({ tid, page, authorId, maxChars }) {
  const { doc } = await getHtml(`forum.php?mod=viewthread&tid=${tid}&page=${page}${authorId ? `&authorid=${authorId}` : ''}`);
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  return parseThreadHtml(doc, tid, page, maxChars);
}
function parseThreadHtml(doc, tid, page, maxChars) {
  const pages = pageCount(doc);
  const forumLinks = doc.querySelectorAll('#pt a[href*="forum-"], #pt a[href*="fid="]');
  const posts = [...doc.querySelectorAll('#postlist > div[id^="post_"]')]
    .filter((el) => /^post_\d+$/.test(el.id))
    .map((el) => {
      const pid = int(el.id);
      const authorLink = el.querySelector('.authi a.xw1, .pls .authi a[href*="uid"]');
      const originalBody = el.querySelector('td.t_f, .t_fsz, .locked');
      const body = originalBody?.cloneNode(true);
      if (body) for (const extra of el.querySelectorAll('.attnm a[href], .locked')) {
        if (!originalBody.contains(extra)) body.append(extra.cloneNode(true));
      }
      return {
        pid,
        floor: floorOf(el.querySelector(`#postnum${pid}, [id^="postnum"]`)),
        author: txt(authorLink) || txt(el.querySelector('.pls .authi')) || null,
        authorId: uidOf(authorLink?.getAttribute('href')),
        postedAt: displayedTime(el.querySelector('em[id^="authorposton"]')),
        url: postUrl(tid, pid),
        ...(body ? readBody(body, maxChars, tid, pid) : { text: '', truncated: false, images: [] }),
      };
    });
  const first = posts[0];
  const stats = txt([...doc.querySelectorAll('div.hm')].find((d) => /查看/.test(d.textContent)));
  return {
    status: 'ok',
    source: 'html',
    thread: {
      tid, title: txt(doc.querySelector('#thread_subject')) || null, url: threadUrl(tid),
      forumId: fidOf(forumLinks[forumLinks.length - 1]?.getAttribute('href')),
      author: first?.floor === 1 ? first.author : null, authorId: first?.floor === 1 ? first.authorId : null,
      postedAt: first?.floor === 1 ? first.postedAt : null,
      replies: int(stats.match(/回复:?\s*(\d+)/)?.[1]), views: int(stats.match(/查看:?\s*(\d+)/)?.[1]), closed: null,
    },
    page: Math.min(page, pages),
    pages,
    hasMore: page < pages,
    posts,
  };
}

async function threadPage(args) {
  return (await threadPageApi(args)) ?? threadPageHtml(args);
}

// ---------- schemas ----------

const status = z.enum(['ok', 'not_found', 'login_required', 'rate_limited', 'site_message'])
  .describe('Non-"ok" results carry `message`: not_found = deleted/missing; login_required = sign in on this site; rate_limited = wait retryAfterSeconds; site_message = board closed/maintenance or other notice.');
const when = z.string().nullable().describe('ISO 8601 when the API gave a timestamp, otherwise the site-local time as displayed ("2026-10-25 14:57").');
const threadRow = z.object({
  tid: z.number(), title: z.string(), url: z.string(), type: z.string().nullable().describe('Board thread category, e.g. "NS"'),
  sticky: z.boolean(), author: z.string().nullable(), authorId: z.number().nullable(), postedAt: when, lastPostAt: when,
  lastPoster: z.string().nullable(), replies: z.number().nullable(), views: z.number().nullable(),
});
const post = z.object({
  pid: z.number(), floor: z.number().nullable().describe('Floor number; 1 is the opening post'), author: z.string().nullable(),
  authorId: z.number().nullable(), postedAt: when, url: z.string().describe('Permalink to this floor'),
  text: z.string().describe('Plain text; quotes prefixed "> ", images "[image N]"'), truncated: z.boolean(), totalChars: z.number().optional(), readMore: z.string().optional(), readImages: z.string().optional(), attachments: z.array(z.object({name:z.string(),url:z.string()})).optional(), hidden:z.array(z.string()).optional(), images: z.array(z.string()).describe('Original image URLs; text uses [image N]'),
});
const board = z.object({
  fid: z.number(), name: z.string(), description: z.string().nullable().optional(), threads: z.number().nullable().optional(),
  posts: z.number().nullable().optional(), todayPosts: z.number().nullable(), url: z.string(),
});
const forum = board.extend({ subforums: z.array(board).optional() });
const order = z.enum(['lastpost', 'dateline', 'replies', 'views', 'heats']);

async function cachedPost({threadId, postId}) {
  const tid = threadId ?? currentTid(), key = `${tid}:${postId}`;
  if (!postCache.has(key)) {
    const {doc, url} = await getHtml(`forum.php?mod=redirect&goto=findpost&ptid=${tid}&pid=${postId}`);
    const notice = siteMessage(doc);
    if (notice) throw new Error(notice.message);
    parseThreadHtml(doc, tid, int(new URL(url).searchParams.get('page')) || 1, Infinity);
  }
  const body = postCache.get(key);
  if (!body) throw new Error(`Post ${postId} was not returned by this forum`);
  return {tid, body};
}
async function getUserProfile({userId}) {
  const {doc, url} = await getHtml(`home.php?mod=space&uid=${userId}&do=profile`);
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  const fields = {};
  for (const dt of doc.querySelectorAll('.pf_l dt, .pf_l li em')) {
    const value = dt.tagName === 'DT' ? dt.nextElementSibling : dt.parentElement;
    fields[txt(dt)] = txt(value).replace(txt(dt), '').trim();
  }
  return {status: 'ok', userId, url, nickname: txt(doc.querySelector('#uhd h2, .uhd h2, .mt')), avatar: doc.querySelector('#uhd img, .avt img')?.getAttribute('src') ? absolute(doc.querySelector('#uhd img, .avt img').getAttribute('src')) : null, fields};
}
async function userPosts({userId, page = 1}, replies) {
  const {doc, url} = await getHtml(`home.php?mod=space&uid=${userId}&do=thread&view=me&type=${replies ? 'reply' : 'thread'}&page=${page}`);
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  const seen = new Set(), items = [];
  for (const a of doc.querySelectorAll('#delform th a[href], .tl th a[href]')) {
    const href = a.getAttribute('href'), tid = tidOf(href);
    if (!tid || !txt(a) || seen.has(tid)) continue;
    seen.add(tid); items.push({threadId: tid, title: txt(a), url: absolute(href), excerpt: txt(a.closest('tbody')?.querySelector('.quote, .xg1'))});
  }
  return {status: 'ok', userId, page, pages: pageCount(doc), url, items};
}
async function searchOptions() {
  const {doc} = await getHtml('search.php?mod=forum');
  const notice = siteMessage(doc);
  if (notice) return messageStatus(notice);
  const controls = [];
  for (const el of doc.querySelectorAll('form select[name], form input[name]')) {
    const name = el.getAttribute('name');
    if (!/^(srchtype|srchfrom|before|srchfilter|srchlocality)$/.test(name)) continue;
    if (el.tagName === 'SELECT') controls.push({name, options: [...el.querySelectorAll('option')].map(o=>({value:o.getAttribute('value'), label:txt(o)}))});
    else if (['radio','checkbox'].includes(el.getAttribute('type'))) controls.push({name, options:[{value:el.getAttribute('value'),label:txt(el.closest('label'))}]});
  }
  return {status:'ok', controls};
}
const postInput = z.object({threadId:z.number().int().positive().optional(), postId:z.number().int().positive()});
const userInput = z.object({userId:z.number().int().positive(), page:z.number().int().positive().optional()});
export default defineSkill({
  getPost: fn({summary:'Read a single floor by pid; offset/nextOffset recover the entire text.', input:postInput.extend({offset:z.number().int().nonnegative().optional(),maxChars:z.number().int().positive().optional()}), examples:[{args:{threadId:123,postId:456,offset:1500}}], handler:async(args)=>{
    const {tid,body}=await cachedPost(args), offset=args.offset??0, size=args.maxChars??6000, end=Math.min(body.text.length,offset+size);
    return {...body,threadId:tid,postId:args.postId,text:body.text.slice(offset,end),offset,nextOffset:end,hasMore:end<body.text.length,truncated:end<body.text.length,readImages:body.images.length?`readPostImages({threadId:${tid},postId:${args.postId},images:[N]})`:undefined};
  }}),
  readPostImages: fn({summary:'Resolve numbered original post images for the extension background.',input:postInput.extend({images:z.array(z.number().int().positive())}),examples:[{args:{threadId:123,postId:456,images:[1]}}],handler:async(args)=>{
    const {body}=await cachedPost(args);
    return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:args.images.map(n=>({image:n,url:body.images[n-1]}))}};
  }}),
  getUserProfile:fn({summary:'Read member profile fields from the native profile page.',input:userInput,examples:[{args:{userId:123}}],handler:getUserProfile}),
  getUserThreads:fn({summary:'Paginated topics started by a member.',input:userInput,examples:[{args:{userId:123,page:1}}],handler:args=>userPosts(args,false)}),
  getUserReplies:fn({summary:'Native member reply-history topic list, with excerpts where shown.',input:userInput,examples:[{args:{userId:123,page:1}}],handler:args=>userPosts(args,true)}),
  getSearchOptions:fn({summary:'Discover search modes and time filters actually offered by this forum.',input:z.object({}),examples:[{args:{}}],handler:searchOptions}),
  searchThreads: fn({
    summary: '★ Search this Discuz forum. Default title search; getSearchOptions discovers any available full-text/time filters. New searches are throttled per user (S1 guests: 1 per 10 s; waits ≤15 s automatically); paging an existing searchId is free.',
    input: z.object({
      query: z.string().min(1).describe('Title keywords, e.g. "大表哥" or "Switch 2". Discuz splits on spaces.'),
      page: z.number().int().min(1).optional().describe('Result page (50 per page on most sites). Pages > 1 reuse the earlier searchId for the same query.'),
      forumIds: z.array(z.number().int().positive()).optional().describe('Restrict to these board fids (see listForums).'),
      author: z.string().optional().describe('Only threads started by this username.'),
      filters: z.record(z.string()).optional().describe('Search controls returned by getSearchOptions, e.g. srchtype or srchfrom.'),
      orderBy: order.exclude(['heats']).optional().describe('Default "lastpost" (latest activity). "dateline" = newest threads.'),
    }),
    output: z.object({
      status, message: z.string().optional(), retryAfterSeconds: z.number().optional(),
      searchId: z.number().nullable().optional(), total: z.number().nullable().optional().describe('Matches reported by the site (often capped, e.g. 100)'),
      page: z.number().optional(), pages: z.number().optional(),
      results: z.array(z.object({
        tid: z.number().describe('Pass to getThread'), title: z.string(), url: z.string(), replies: z.number().nullable(), views: z.number().nullable(),
        excerpt: z.string().describe('Start of the opening post'), postedAt: z.string().nullable(), author: z.string().nullable(),
        authorId: z.number().nullable(), forum: z.string().nullable(), forumId: z.number().nullable(),
      })).optional(),
    }),
    examples: [
      { args: { query: '大表哥' } },
      { args: { query: '大表哥', page: 2 }, note: 'Next page of the same search; no new throttle hit.' },
      { args: { query: '显卡', forumIds: [4], orderBy: 'dateline' } },
    ],
    handler: async ({ query, page = 1, forumIds, author, orderBy, filters }) => {
      const key = JSON.stringify([location.host, query, forumIds ?? [], author ?? '', orderBy ?? '', filters ?? {}]);
      let searchId = searchIds.get(key);
      if (!searchId) {
        const first = await runSearch({ query, forumIds, author, orderBy, filters });
        if (first.status !== 'ok') return first;
        if (first.searchId) searchIds.set(key, first.searchId);
        if (page === 1 || !first.searchId) return first;
        searchId = first.searchId;
      }
      const { doc, url } = await getHtml(`search.php?mod=forum&searchid=${searchId}&orderby=${orderBy ?? 'lastpost'}&ascdesc=desc&searchsubmit=yes&page=${page}`);
      const notice = siteMessage(doc);
      if (notice) {
        searchIds.delete(key);
        return messageStatus(notice);
      }
      return parseSearch(doc, url);
    },
  }),

  getThread: fn({
    summary: 'Read one page of a thread: thread meta + posts (plain text, bounded by maxChars). Defaults to the thread open in this tab. Use page:-1 for the latest replies; follow `pages` for more.',
    input: z.object({
      threadId: z.union([z.number().int().positive(), z.string().url()]).optional().describe('tid, or a thread URL (thread-123-1-1.html / viewthread&tid=123). Omit on a thread page.'),
      page: z.number().int().optional().describe('1-based page; negative counts from the end (-1 = last page). Default 1.'),
      authorId: z.number().int().positive().optional().describe('Only posts by this uid ("只看该作者").'),
      maxChars: z.number().int().min(200).max(20000).optional().describe('Max characters per post, default 1500. Raise to recover a truncated post.'),
    }),
    output: z.object({
      status, message: z.string().optional(), source: z.enum(['api', 'html']).optional(),
      thread: z.object({
        tid: z.number(), title: z.string().nullable(), url: z.string(), forumId: z.number().nullable(), author: z.string().nullable(),
        authorId: z.number().nullable(), postedAt: when, replies: z.number().nullable(), views: z.number().nullable(), closed: z.boolean().nullable(),
      }).optional(),
      hasMore: z.boolean().optional(), page: z.number().optional(), pages: z.number().nullable().optional().describe('Total pages; posts per page is fixed by the site (S1: 40)'),
      posts: z.array(post).optional(),
    }),
    examples: [
      { args: { threadId: 2292509 } },
      { args: { threadId: 2261859, page: -1 }, note: 'Latest replies of a long thread' },
      { args: { page: -1 }, note: 'Latest page of the thread open in this tab' },
    ],
    handler: async ({ threadId, page = 1, authorId, maxChars = 1500 }) => {
      const tid = typeof threadId === 'string' ? tidOf(threadId) : threadId ?? currentTid();
      if (!tid) throw new Error('discuz.getThread: pass threadId; the current page is not a thread');
      if (page < 0 && authorId) {
        const result = await threadPageHtml({tid, page: 1, authorId, maxChars});
        if (result.status !== 'ok') return result;
        const target = Math.max(1, result.pages + page + 1);
        return target === 1 ? result : threadPageHtml({tid, page: target, authorId, maxChars});
      }
      const first = await threadPage({ tid, page: Math.max(page, 1), authorId, maxChars });
      if (page >= 1 || first.status !== 'ok') return first;
      const target = Math.max(1, first.pages + page + 1);
      return target === first.page ? first : threadPage({ tid, page: target, authorId, maxChars });
    },
  }),

  listThreads: fn({
    summary: 'List threads in a board. Defaults to the board of the current page. Sticky/announcement threads are excluded unless includeSticky.',
    input: z.object({
      forumId: z.number().int().positive().optional().describe('Board fid (see listForums). Omit on a board or thread page.'),
      page: z.number().int().min(1).optional(),
      order: order.optional().describe('"lastpost" (default, latest activity), "dateline" (newest threads), "replies", "views", "heats" (hot).'),
      typeId: z.number().int().positive().optional().describe('Thread category id within the board (the [NS]/[PC]-style tag).'),
      perPage: z.number().int().min(5).max(50).optional().describe('JSON API only; HTML pages use the site default. Default 30.'),
      includeSticky: z.boolean().optional(),
    }),
    output: z.object({
      status, message: z.string().optional(), source: z.enum(['api', 'html']).optional(),
      forum: z.object({ fid: z.number(), name: z.string().nullable(), description: z.string().nullable(), threads: z.number().nullable(), url: z.string() }).optional(),
      page: z.number().optional(), pages: z.number().nullable().optional(), threads: z.array(threadRow).optional(),
    }),
    examples: [
      { args: { forumId: 4, order: 'heats' } },
      { args: { order: 'dateline' }, note: 'Newest threads in the board open in this tab' },
    ],
    handler: async ({ forumId, page = 1, order: o = 'lastpost', typeId, perPage = 30, includeSticky = false }) => {
      const fid = forumId ?? currentFid();
      if (!fid) throw new Error('discuz.listThreads: pass forumId; the current page is not inside a board (use listForums)');
      const args = { fid, page, perPage, order: o, typeId, includeSticky };
      return (await listThreadsApi(args)) ?? listThreadsHtml(args);
    },
  }),

  listForums: fn({
    summary: 'Board directory: categories with boards (fid, name, today\'s posts, subforums). Logged-in users may see more boards.',
    input: z.object({}),
    output: z.object({
      status, message: z.string().optional(), source: z.enum(['api', 'html']).optional(),
      categories: z.array(z.object({ name: z.string().nullable(), forums: z.array(forum) })).optional(),
    }),
    examples: [{ args: {} }],
    handler: async () => {
      const v = await api('forumindex');
      if (!v) return listForumsHtml();
      if (v.error) return v.error;
      const byFid = new Map(v.forumlist.map((f) => [String(f.fid), forumFromApi(f)]));
      return {
        status: 'ok',
        source: 'api',
        categories: v.catlist.map((c) => ({ name: c.name, forums: (c.forums ?? []).map((fid) => byFid.get(String(fid))).filter(Boolean) })),
      };
    },
  }),
});
