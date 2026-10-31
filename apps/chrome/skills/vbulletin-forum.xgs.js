// ==XGooseSkill==
// @name         vbulletin-forum
// @namespace    vbulletin
// @version      0.2.2
// @description  Generic helpers for vBulletin 3.x/4.x forums (search posts/threads, read threads, see post pictures, recent threads, forum listings).
// @match        *://www.flyertalk.com/*
// @match        *://flyertalk.com/*
// @detect       location.hostname.endsWith('flyertalk.com') || !!document.querySelector('meta[name="generator"][content*="vBulletin"]') || /vbulletin/i.test(document.documentElement.outerHTML.slice(0, 4000))
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
 *   GET  /forum/search.php                                 → security token for searches
 *   POST /forum/search.php?do=process                      → search threads or posts
 *   GET  /forum/search.php?searchid={id}&pp=25&page={n}    → later result pages
 *   GET  /forum/external.php?type=RSS2&forumids=…          → recent threads (RSS)
 *   GET  /forum/forumdisplay.php?f={id}&page={n}           → forum listing
 *   GET  /forum/showthread.php?t={id}&page={n}             → thread page
 *   GET  /forum/showthread.php?p={postId}                  → the page holding one post
 *
 * Reads send the user's cookies so they see what their account can see. Links
 * in result pages are relative to /forum/, so they are resolved against the
 * response URL rather than the site origin.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const forumUrl = (path) => new URL(path, `${location.origin}/forum/`).href;
const postUrl = (postId) => `${forumUrl('showthread.php')}?p=${postId}#post${postId}`;

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function txt(node) {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseInteger(s) {
  const m = String(s ?? '').replace(/,/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

/** Result links carry `?highlight=` search terms; the plain thread or post URL is what the user opens. */
function cleanUrl(href, base) {
  if (!href) return undefined;
  const url = new URL(href, base);
  url.searchParams.delete('highlight');
  return url.href;
}

/** Forum dates (`Dec 2, 2025 | 6:07 pm`, `Yesterday 12:54 am`, `on May 26, 2023`) as their local day; unparseable text as written. */
function siteDay(text) {
  const s = String(text ?? '').replace(/\s*\|\s*/g, ' ').replace(/^on\s+/i, '').replace(/\s*,\s*(?=\d{1,2}:\d{2})/, ' ').trim();
  if (!s) return undefined;
  const relative = s.match(/^(today|yesterday)\b/i);
  const date = relative ? new Date(Date.now() - (/^y/i.test(relative[1]) ? 86_400_000 : 0)) : new Date(s);
  if (Number.isNaN(date.valueOf())) return s.slice(0, 40);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseThreadIdFromHref(href) {
  if (!href) return null;
  let m = href.match(/showthread\.php\?(?:[^#]*?&)?t=(\d+)/);
  if (m) return Number(m[1]);
  m = href.match(/(?:^|\/)(\d+)-[^/]+\.html/);
  if (m) return Number(m[1]);
  return null;
}

function parsePostIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/showpost\.php\?p=(\d+)|[?&]p=(\d+)|#post(\d+)|-post(\d+)\.html/);
  return m ? Number(m.slice(1).find(Boolean)) : null;
}

function parseForumIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/forumdisplay\.php\?(?:[^#]*?&)?f=(\d+)/) || href.match(/(?:^|\/)[^/]+-(\d+)\/?(?:[?#]|$)/);
  return m ? Number(m[1]) : null;
}

/** vBulletin 3 boards usually serve ISO-8859-1; `Response.text()` would always decode UTF-8 and turn curly quotes into U+FFFD. */
async function decodedText(r) {
  const bytes = await r.arrayBuffer();
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)|<\?xml[^>]+encoding=["']([\w-]+)/i);
  const declared = r.headers.get('content-type')?.match(/charset=["']?([\w-]+)/i)?.[1] ?? head?.[1] ?? head?.[2];
  try { return new TextDecoder(declared || 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

async function fetchPage(url, init = {}) {
  const r = await fetch(url, { credentials: 'include', ...init, headers: { Accept: 'text/html', ...init.headers } });
  if (!r.ok) throw new Error(`vbulletin: ${new URL(url).pathname} → HTTP ${r.status}`);
  return { doc: parseHtml(await decodedText(r)), url: r.url };
}

/* ───── Post bodies ───── */

const QUOTE_BLOCKS = 'div[style*="margin"], .bbcode_container';
const isQuote = (el) => el.classList.contains('bbcode_container') || /^\s*Quote:/i.test(el.textContent);
const isDecorative = (img) => {
  const src = img.getAttribute('src') ?? '';
  const tiny = ['width', 'height'].some((side) => Number(img.getAttribute(side)) > 0 && Number(img.getAttribute(side)) < 48);
  return tiny || img.classList.contains('inlineimg') || /smil|statusicon|\/images\/(?:misc|buttons|icons|reputation)\//i.test(src);
};

/** Pictures the author posted (not those inside quotes), numbered as the [image N] markers in post text. */
function contentImages(body) {
  return [...body.querySelectorAll('img')].filter((img) => !isDecorative(img) && ![...body.querySelectorAll(QUOTE_BLOCKS)].some((q) => isQuote(q) && q.contains(img)));
}

/**
 * vBulletin 3 quotes are `<div style="margin…"><label>Quote:</label><div class="panel">
 * [Originally Posted by <strong>user</strong> <a href="…#post123">]<div>text</div></div></div>`;
 * vBulletin 4 uses `.bbcode_container .bbcode_postedby strong` + `.message`.
 */
function postText(body) {
  const root = body.cloneNode(true);
  root.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  contentImages(root).forEach((img, index) => img.replaceWith(` [image ${index + 1}] `));
  root.querySelectorAll('img').forEach((img) => img.remove());
  [...root.querySelectorAll(QUOTE_BLOCKS)].filter(isQuote).reverse().forEach((quote) => {
    const by = [...quote.querySelectorAll('.bbcode_postedby, div')].find((d) => !d.querySelector('div') && /^\s*(?:Originally\s+)?Posted by/i.test(d.textContent) && d.querySelector('strong'));
    const user = txt(by?.querySelector('strong'));
    const postId = parsePostIdFromHref(by?.querySelector('a[href]')?.getAttribute('href'));
    by?.remove();
    quote.querySelectorAll('label').forEach((label) => label.remove());
    const quoted = txt(quote).replace(/^Quote:\s*/i, '');
    const capped = quoted.length > 300 ? `${quoted.slice(0, 300)}…` : quoted;
    quote.replaceWith(`\n[quote${user ? ` @${user}` : ''}${postId ? ` post ${postId}` : ''}: ${capped}]\n`);
  });
  root.querySelectorAll('br,p,div,li').forEach((n) => n.append('\n'));
  return (root.textContent ?? '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Quotes name the quoted post id; when that post is in the same read it becomes its floor. */
function linkQuotes(posts) {
  const floors = new Map(posts.map((post) => [post.post_id, post.post_number]));
  for (const post of posts) post.text = post.text.replace(/\[quote( @[^\]:]*?)? post (\d+):/g, (m, user = '', id) => floors.has(Number(id)) ? `[quote${user} #${floors.get(Number(id))}:` : m);
  return posts;
}

function threadPosts(doc, start, maxChars) {
  return [...doc.querySelectorAll('div[id^="edit"], li.postbitlegacy[id^="post_"], li.postbit[id^="post_"], table[id^="post"]')].flatMap((el, index) => {
    const postId = Number(el.id.match(/(\d+)$/)?.[1]) || null;
    const body = (postId && el.querySelector(`#post_message_${postId}`)) || el.querySelector('[id^="post_message_"], blockquote.postcontent, .postbody');
    if (!postId || !body) return [];
    const head = txt(el.querySelector('.thead, .posthead'));
    const author = [...el.querySelectorAll('.username, .bigusername, a[href*="members/"], a[href*="member.php"]')].find((a) => !body.contains(a));
    const full = postText(body);
    const text = maxChars === undefined ? full : full.slice(0, maxChars);
    return [compact({
      post_number: Number(head.match(/#(\d+)\s*$/)?.[1]) || parseInteger(txt(el.querySelector('.postcounter'))) || start + index + 1,
      post_id: postId,
      username: txt(author),
      created_at: siteDay(txt(el.querySelector('.postdate, .date')) || head.replace(/#\d+\s*$/, '')),
      like_count: parseInteger(txt(el.querySelector('[id^="post_thanks_button_likes_"]'))) || undefined,
      text,
      text_truncated: text.length < full.length || undefined,
      url: postUrl(postId),
    })];
  });
}

/** Highest page linked from the thread's own pager, including its "Last" link. */
function lastPage(doc, threadId) {
  let pages = parseInteger(txt(doc.querySelector('.pagenav td.vbmenu_control')).match(/of\s+(\d+)/i)?.[1]) || 1;
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (parseThreadIdFromHref(href) !== threadId) continue;
    const label = txt(a), query = href.match(/[?&]page=(\d+)/);
    if (query) pages = Math.max(pages, Number(query[1]));
    else if (/^\d+$/.test(label)) pages = Math.max(pages, Number(label));
    else if (/^last\b/i.test(label)) pages = Math.max(pages, Number(href.match(/-(\d+)\.html(?:[?#]|$)/)?.[1] ?? 1));
  }
  return pages;
}

/* ───── Search results and listings ───── */

function postHits(doc, base) {
  return [...doc.querySelectorAll('div.tbox[id^="post"], table[id^="post"]')].flatMap((box) => {
    const postId = Number(box.id.replace(/^post/, '')) || null;
    const threadLink = [...box.querySelectorAll('a[href]')].find((a) => a.querySelector('strong') && parseThreadIdFromHref(a.getAttribute('href')));
    if (!postId || !threadLink) return [];
    const forum = box.querySelector('.thead .right a[href], .thead a[href*="forumdisplay"]');
    const excerpt = box.querySelector('.panel em, .panel, blockquote');
    const titleLink = excerpt?.querySelector('a[href]');
    const title = txt(titleLink);
    titleLink?.remove();
    const stat = (name) => parseInteger(txt([...box.querySelectorAll('.smallfont')].find((n) => txt(n).startsWith(`${name}:`))?.querySelector('strong'))) || undefined;
    return [compact({
      post_id: postId,
      thread_id: parseThreadIdFromHref(threadLink.getAttribute('href')),
      thread: txt(threadLink),
      forum: txt(forum),
      forum_id: parseForumIdFromHref(forum?.getAttribute('href')),
      author: txt([...box.querySelectorAll('.smallfont')].find((n) => /^Posted By/i.test(txt(n)))?.querySelector('a')),
      date: siteDay(txt(box.querySelector('.thead span'))),
      replies: stat('Replies'),
      views: stat('Views'),
      title: title && title !== txt(threadLink) ? title : undefined,
      snippet: txt(excerpt),
      url: cleanUrl(titleLink?.getAttribute('href'), base) ?? postUrl(postId),
    })];
  });
}

function threadRows(doc, base) {
  return [...doc.querySelectorAll('a[id^="thread_title_"]')].map((a) => {
    const id = Number(a.id.slice('thread_title_'.length));
    const row = a.closest('.trow, tr, li') ?? a.parentElement;
    const cell = doc.getElementById(`td_threadtitle_${id}`) ?? row;
    const statsCell = row.querySelector('[title^="Replies"]');
    const stats = statsCell?.getAttribute('title') ?? '';
    const last = txt(statsCell);
    const pager = [...cell.querySelectorAll('.smallfont a[href]')].map((link) => txt(link)).filter((label) => /^\d+$/.test(label));
    return compact({
      id,
      title: txt(a),
      url: cleanUrl(a.getAttribute('href'), base),
      sticky: /^\s*Sticky\b/.test(txt(cell)) || undefined,
      starter: txt(cell.querySelector('.smallfont span[onclick], .smallfont a[href*="members/"], .smallfont a[href*="member.php"]')),
      started: siteDay(txt(cell.querySelector('.jumbo-txt'))),
      replies: parseInteger(stats.match(/Replies:\s*([\d,]+)/)?.[1]),
      views: parseInteger(stats.match(/Views:\s*([\d,]+)/)?.[1]),
      pages: pager.length ? Math.max(...pager.map(Number)) : undefined,
      last_post: siteDay(last.replace(/\s+by\s+.*$/, '')),
      last_poster: last.match(/\bby\s+(.+)$/)?.[1],
      preview: cell.getAttribute?.('title')?.trim() || undefined,
    });
  });
}

function hasNextPage(doc, page) {
  return [...doc.querySelectorAll('a[href]')].some((a) => a.getAttribute('href').match(/[?&]page=(\d+)/)?.[1] === String(page + 1) || /-(\d+)\.html/.exec(a.getAttribute('href'))?.[1] === String(page + 1));
}

/* ───── Search ───── */

let tokenRequest;
/** Searches need the session's own security token; a stale or guest token is rejected. */
function securityToken(fresh) {
  if (fresh || !tokenRequest) {
    tokenRequest = fetchPage(forumUrl('search.php'))
      .then(({ doc }) => doc.querySelector('form[action*="search.php"] input[name="securitytoken"], input[name="securitytoken"]')?.value || 'guest')
      .catch((error) => { tokenRequest = undefined; throw error; });
  }
  return tokenRequest;
}

async function runSearch(opts, retry = true) {
  if (opts.searchId) {
    const { doc, url } = await fetchPage(forumUrl(`search.php?searchid=${opts.searchId}&pp=25&page=${opts.page ?? 1}`));
    return { searchId: opts.searchId, doc, url, page: opts.page ?? 1 };
  }
  const body = new URLSearchParams({
    s: '',
    securitytoken: await securityToken(!retry),
    do: 'process',
    query: opts.query,
    titleonly: opts.titleOnly ? '1' : '0',
    showposts: opts.type === 'post' ? '1' : '0',
    childforums: '1',
  });
  if (opts.author) {
    body.set('searchuser', opts.author);
    if (opts.exactName) body.set('exactname', '1');
    if (opts.starterOnly) body.set('starteronly', '1');
  }
  for (const f of opts.forumIds ?? []) body.append('forumchoice[]', String(f));
  const { doc, url } = await fetchPage(forumUrl('search.php?do=process'), {
    method: 'POST',
    cache: 'no-cache',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const searchId = Number(new URL(url).searchParams.get('searchid')) || 0;
  if (searchId) return { searchId, doc, url, page: 1 };
  // Boards without header redirects answer with a "taking you to the results" page that refreshes to them.
  const refreshed = Number(doc.querySelector('meta[http-equiv="refresh" i]')?.getAttribute('content')?.match(/searchid=(\d+)/)?.[1]);
  if (refreshed) return runSearch({ searchId: refreshed, page: 1 });
  const message = txt(doc.querySelector('.standard_error, td.panelsurround, .blockrow, .panel, #content, body')).replace(/^vBulletin Message\s*/i, '');
  if (/no matches/i.test(message)) return { searchId: 0, doc: null, url, page: 1 };
  if (retry && /security token|logged in since|could not be processed/i.test(message)) return runSearch(opts, false);
  throw new Error(`vbulletin search: ${message.slice(0, 200) || 'the forum returned no result page'}`);
}

const SearchInput = {
  query: z.string(),
  forumIds: z.array(z.number().int().positive()).optional(),
  author: z.string().optional(),
  exactName: z.boolean().optional(),
  searchId: z.number().int().positive().optional().describe('From a previous result; with page, reads later result pages of that search.'),
  page: z.number().int().min(1).optional().describe('Result page; needs searchId for pages after 1.'),
};

async function search(opts, extract) {
  const { searchId, doc, url, page } = await runSearch(opts);
  const results = doc ? extract(doc, url) : [];
  return compact({ searchId: searchId || undefined, page, results, hasMore: !!doc && hasNextPage(doc, page) });
}

/* ───── Images ───── */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024, MAX_IMAGE_DATA_CHARS = 500_000;
/** Downscaled JPEG in the image shape hosts attach to the model; the image host's CORS rules apply. */
async function modelImage(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MB');
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(blob.type)) throw new Error(`Unsupported image type ${blob.type || 'unknown'}`);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MB');
  const bitmap = await createImageBitmap(blob);
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++, scale *= .75) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', attempt ? .75 : .85).split(',')[1];
      if (data.length <= MAX_IMAGE_DATA_CHARS) return { type: 'image', mimeType: 'image/jpeg', data, width: canvas.width, height: canvas.height };
    }
    throw new Error('Image is too detailed for the model context');
  } finally { bitmap.close(); }
}

/** A linked full-size file first, then the inline rendition. FlyerTalk's CDN serves inline pictures at 320px wide; the same path at 1600px is the larger rendition. */
function imageSources(img, base) {
  const src = img.getAttribute('src');
  const link = img.closest('a[href]')?.getAttribute('href');
  const linked = link && /attachment\.php|\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(link) ? link : null;
  const larger = src && /ibsrv\.net\/gimg\//.test(src) ? src.replace(/\/\d+x\d+\//, '/1600x2000/') : null;
  return [...new Set([linked, larger, src].filter(Boolean).map((u) => new URL(u, base).href))];
}

async function readPostImages({ postId, images }) {
  const { doc, url } = await fetchPage(forumUrl(`showthread.php?p=${postId}`));
  const body = doc.querySelector(`#post_message_${postId}`);
  if (!body) throw new Error(`Post ${postId} is not on the page it links to; it may be deleted, moderated or private.`);
  const found = contentImages(body);
  const chosen = images ? [...new Set(images)] : found.slice(0, 3).map((_, index) => index + 1);
  return {
    post_id: postId, url: postUrl(postId), total_images: found.length,
    images: await Promise.all(chosen.map(async (number) => {
      const img = found[number - 1];
      if (!img) return { image: number, error: `The post has ${found.length} images.` };
      const sources = imageSources(img, url);
      let error;
      for (const source of sources) {
        try { return { image: number, url: source, ...await modelImage(source) }; } catch (failure) { error = failure; }
      }
      return { image: number, url: sources[0] ?? null, error: String(error?.message ?? 'Image has no source') };
    })),
  };
}

/* ───── Threads ───── */

async function getThreadPage(threadId, page, maxChars, perPage) {
  const { doc, url } = await fetchPage(forumUrl(`showthread.php?t=${threadId}${page > 1 ? `&page=${page}` : ''}`));
  return {
    url,
    title: txt(doc.querySelector('h1, .threadtitle, [class*="threadtitle"]')),
    totalPages: lastPage(doc, threadId),
    posts: threadPosts(doc, (page - 1) * perPage, maxChars),
  };
}

async function summarizeThread({ threadId, mode, page, maxPosts, firstReplies = 30, latestReplies = 100, maxChars }) {
  const m = mode ?? 'first+last';
  const cap = maxPosts ?? (m === 'first+last' || m === 'tldr' ? 1 + firstReplies + latestReplies : 10);
  const cache = new Map();
  let perPage = 0;
  const fetchPage = async (p) => {
    if (!cache.has(p)) cache.set(p, await getThreadPage(threadId, p, maxChars, perPage));
    return cache.get(p);
  };
  const first = await fetchPage(1);
  perPage = first.posts.length;
  const totalPages = first.totalPages;
  const out = { id: threadId, title: first.title, url: first.url, total_pages: totalPages };
  const finish = (posts, extra = {}) => {
    linkQuotes([...cache.values()].flatMap((p) => p.posts));
    return { ...out, ...extra, pages_read: [...cache.keys()].sort((a, b) => a - b), posts };
  };
  if (!perPage) return { ...out, hint: 'No readable posts returned; the thread may be private, moved or deleted.', posts: [] };
  if (m === 'first') return finish(first.posts.slice(0, cap));
  if ((m === 'first+last' || m === 'tldr') && page === undefined) {
    const head = [...first.posts], tail = [];
    for (let p = 2; p <= totalPages && head.length < 1 + firstReplies; p++) head.push(...(await fetchPage(p)).posts);
    for (let p = totalPages; p >= 1 && tail.length < latestReplies; p--) tail.unshift(...(await fetchPage(p)).posts);
    const selected = [...head.slice(0, 1 + firstReplies), ...(latestReplies ? tail.filter((post) => post.post_number !== first.posts[0]?.post_number).slice(-latestReplies) : [])];
    const posts = [...new Map(selected.map((post) => [post.post_number, post])).values()].sort((a, b) => a.post_number - b.post_number).slice(0, cap);
    return finish(posts, { selection: `original post, first ${firstReplies} replies and latest ${latestReplies} replies` });
  }
  if (m === 'full') {
    const all = [...first.posts];
    for (let p = 2; p <= totalPages && all.length < cap; p++) all.push(...(await fetchPage(p)).posts);
    return finish(all.slice(0, cap));
  }
  const targetPage = typeof page === 'number' ? (page < 0 ? Math.max(1, totalPages + page + 1) : Math.min(page, totalPages)) : totalPages;
  return finish((await fetchPage(targetPage)).posts.slice(-cap), { page: targetPage });
}

export default defineSkill({
  searchPosts: fn({
    summary: 'Full-text search across forum posts. ★ primary entry.',
    input: z.object(SearchInput),
    examples: [{ args: { query: 'amex platinum 175k' } }],
    handler: (p) => search({ ...p, type: 'post' }, postHits),
  }),

  searchThreads: fn({
    summary: 'Search forum threads by title (titleOnly) or content.',
    input: z.object({
      ...SearchInput,
      starterOnly: z.boolean().optional(),
      titleOnly: z.boolean().optional(),
    }),
    handler: (p) => search({ ...p, type: 'thread' }, threadRows),
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
    handler: summarizeThread,
  }),

  readPostImages: fn({
    summary: 'Attach up to three pictures from one post so you can see them. Post text marks them as [image N].',
    input: z.object({
      postId: z.number().int().positive().describe('The post id shown as (id N) on post lines.'),
      images: z.array(z.number().int().min(1)).min(1).max(3).optional().describe('[image N] numbers from the post text. Default: the first three.'),
    }).strict(),
    examples: [{ args: { postId: 37461448, images: [1] } }],
    handler: readPostImages,
  }),

  getRecentThreads: fn({
    summary: 'Recent threads (RSS) in the given forums, or site-wide without forumIds. With full=true also returns each first post as text.',
    input: z.object({
      forumIds: z.array(z.number().int().positive()).optional(),
      full: z.boolean().optional(),
    }),
    handler: async ({ forumIds, full }) => {
      const r = await fetch(forumUrl(`external.php?type=RSS2${forumIds?.length ? `&forumids=${forumIds.join(',')}` : ''}`), { credentials: 'include', headers: { Accept: 'application/rss+xml' } });
      if (!r.ok) throw new Error(`getRecentThreads → HTTP ${r.status}`);
      const doc = new DOMParser().parseFromString(await decodedText(r), 'application/xml');
      return [...doc.querySelectorAll('item')].map((item) => {
        const link = item.querySelector('link')?.textContent ?? '';
        const description = item.querySelector('encoded, description')?.textContent ?? '';
        return compact({
          id: parseThreadIdFromHref(link),
          title: item.querySelector('title')?.textContent ?? '',
          url: link,
          author: item.querySelector('creator, author')?.textContent,
          date: siteDay(item.querySelector('pubDate')?.textContent),
          text: full ? postText(parseHtml(description).body) : undefined,
        });
      });
    },
  }),

  getForum: fn({
    summary: 'A forum listing page: title, slug and threads with starter, replies, views, pages and last post.',
    input: z.object({
      id: z.number().int().positive(),
      page: z.number().int().min(1).optional(),
      sort: z.enum(['lastpost', 'dateline', 'replies', 'views']).optional().describe('Descending order. Default lastpost (recent activity); dateline = newest threads.'),
    }),
    handler: async ({ id, page, sort }) => {
      const { doc, url } = await fetchPage(forumUrl(`forumdisplay.php?f=${id}${page > 1 ? `&page=${page}` : ''}${sort ? `&sort=${sort}&order=desc` : ''}`));
      return compact({
        id,
        slug: url.match(/\/forum\/([^/?#]+)-\d+/)?.[1],
        title: txt(doc.querySelector('h1, .forumtitle')),
        url,
        page: page ?? 1,
        threads: threadRows(doc, url),
        hasMore: hasNextPage(doc, page ?? 1),
      });
    },
  }),
}, {
  instructions: `Search to locate threads, then read them with summarizeThread before answering; snippets are not enough for claims.
- Return thread results as they are. They reach you as one line per post with floor, post id, author, day, likes and inline quotes ([quote @user #floor: text], or post <id> when the quoted post was not part of the read).
- Post text marks pictures as [image N]. When a screenshot, chart or photo matters to the answer, call readPostImages({postId, images:[N]}) to see it; skip decorative ones.
- Search results include searchId; pass it with page to read further result pages instead of searching again.
- Summarize outcomes, dates, amounts and circumstances with author, likes and post links. Follow the user's scope and language.`,
});
