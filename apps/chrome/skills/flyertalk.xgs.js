// ==XGooseSkill==
// @name         flyertalk
// @namespace    ft
// @version      0.2.0
// @description  FlyerTalk site-specific helpers — WordPress article search (anonymous /wp-json), URL parsing for the vBulletin SEO routes, a curated forum-slug-to-id map (airlines, hotels, credit cards), and a parallel searchAll fan-out across articles + forum posts + threads.
// @match        *://www.flyertalk.com/*
// @match        *://flyertalk.com/*
// @detect       location.hostname.endsWith('flyertalk.com')
// @run-at       document_idle
// @require      vbulletin-forum
// @connect      <self>
// @primary      searchAll
// @keyword      flyertalk
// @keyword      miles
// @keyword      points
// @keyword      FF
// @keyword      MileagePlus
// @keyword      AAdvantage
// @keyword      SkyMiles
// @keyword      Atmos Rewards
// @keyword      Membership Rewards
// @keyword      Ultimate Rewards
// @keyword      Marriott Bonvoy
// @keyword      World of Hyatt
// @keyword      Hilton Honors
// @keyword      IHG One Rewards
// @keyword      Polaris
// @keyword      Flagship
// @keyword      Mint
// @keyword      DP
// @keyword      data point
// @keyword      trip report
// ==/XGooseSkill==

/**
 * Hybrid site: homepage + `/articles/*` is WordPress (REST `/wp-json/wp/v2/*`);
 * `/forum/*` is vBulletin 3.9.3.9 (use `xgoose.skills.vbulletin.*`). This skill
 * adds the FlyerTalk-specific URL parsing, forum-id catalog, and WordPress
 * article reader on top.
 *
 * Operating rules (silent — do not echo to the user):
 *  - NEVER invent thread/post/user IDs from memory; only use IDs that appear
 *    in a previous tool result.
 *  - Don't re-sort merged search results; relevance is what you want.
 *  - Default to unscoped `vbulletin.searchPosts` (no `forumIds`).
 *  - English queries only; vBulletin's index doesn't tokenize CJK.
 *  - Don't answer from snippets — follow up with
 *    `vbulletin.summarizeThread({ threadId, mode: 'latest' })` on the top 2-3
 *    hits before composing.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

/* ───── WordPress (`/wp-json`) ───── */

const SUMMARY_FIELDS = 'id,slug,title,excerpt,date,link,categories';
const FULL_FIELDS = 'id,slug,title,excerpt,content,date,modified,link,categories,author';

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&ndash;': '–',
  '&mdash;': '—',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
};

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITY_MAP[m] ?? m);
}

function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(s);
}

function dropReadMore(excerpt) {
  return String(excerpt ?? '')
    .replace(/<a[^>]*class="[^"]*read-more-button[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/&hellip;\s*$/, '…');
}

function toSummary(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: stripHtml(r.title?.rendered ?? ''),
    excerpt: stripHtml(dropReadMore(r.excerpt?.rendered ?? '')),
    date: normalizeDate(r.date),
    link: r.link ?? '',
    categories: r.categories ?? [],
  };
}

function toFull(r) {
  const html = r.content?.rendered ?? '';
  return {
    ...toSummary(r),
    contentHtml: html,
    contentText: stripHtml(html),
    modified: normalizeDate(r.modified),
    author: r.author ?? 0,
  };
}

async function fetchJson(url) {
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-cache',
    headers: { Accept: 'application/json' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`flyertalk: GET ${url} → HTTP ${r.status}`);
  return await r.json();
}

/* ───── Forum map (baked-in catalog) ───── */

const FORUM_MAP_RAW = [
  [1, 'miles-points', 'Miles & Points'],
  [161, 'travel-dining', 'Travel & Dining'],
  [176, 'travelbuzz', 'TravelBuzz'],
  [177, 'trip-reports', 'Trip Reports'],
  [178, 'travel-news', 'Travel News'],
  [366, 'omni', 'OMNI'],
  [367, 'community', 'Community'],
  [370, 'milesbuzz', 'MilesBuzz'],
  [372, 'mileage-run-deals', 'Mileage Run Deals'],
  [374, 'airlines-mileage-programs', 'Airlines & Mileage Programs'],
  [389, 'hotels-loyalty-programs', 'Hotels & Loyalty Programs'],
  [438, 'americas', 'Americas'],
  [599, 'credit-card-programs', 'Credit Card Programs'],
  [702, 'europe', 'Europe'],
  [704, 'destinations', 'Destinations'],
  [705, 'asia', 'Asia'],
  // Airlines
  [375, 'air-canada-aeroplan', 'Air Canada | Aeroplan'],
  [440, 'air-new-zealand-koru', 'Air New Zealand | Koru'],
  [442, 'alaska-airlines-atmos-rewards', 'Alaska Airlines | Atmos Rewards'],
  [443, 'all-nippon-airways-ana-mileage-club', 'All Nippon Airways | ANA Mileage Club'],
  [446, 'british-airways-british-airways-club', 'British Airways | The British Airways Club'],
  [487, 'cathay-pacific-cathay', 'Cathay Pacific | Cathay'],
  [490, 'emirates-skywards', 'Emirates | Skywards'],
  [492, 'jetblue-trueblue', 'JetBlue | TrueBlue'],
  [495, 'lufthansa-austrian-swiss-brussels-lot-ita-other-partners-miles-more', 'Lufthansa Miles & More'],
  [498, 'qantas-frequent-flyer', 'Qantas | Frequent Flyer'],
  [500, 'singapore-airlines-krisflyer', 'Singapore Airlines | KrisFlyer'],
  [501, 'southwest-airlines-rapid-rewards', 'Southwest Airlines | Rapid Rewards'],
  [506, 'virgin-atlantic-airways-flying-club', 'Virgin Atlantic Airways | Flying Club'],
  [594, 'air-france-klm-other-partners-flying-blue', 'Air France/KLM Flying Blue'],
  [641, 'turkish-airlines-miles-smiles', 'Turkish Airlines | Miles&Smiles'],
  [644, 'qatar-airways-privilege-club', 'Qatar Airways | Privilege Club'],
  [665, 'delta-air-lines-skymiles', 'Delta Air Lines | SkyMiles'],
  [668, 'frontier-airlines-frontier-miles-program', 'Frontier Airlines | Frontier Miles'],
  [681, 'united-airlines-mileageplus', 'United Airlines | MileagePlus'],
  [692, 'etihad-airways-etihad-guest', 'Etihad Airways | Etihad Guest'],
  [716, 'avianca-lifemiles-amigo', 'Avianca | LifeMiles'],
  [718, 'aer-lingus-aerclub', 'Aer Lingus | AerClub'],
  [733, 'american-airlines-aadvantage', 'American Airlines | AAdvantage'],
  [774, 'spirit-airlines-free-spirit', 'Spirit Airlines | Free Spirit'],
  // Hotels
  [416, 'best-western-best-western-rewards', 'Best Western | Best Western Rewards'],
  [417, 'hilton-hilton-honors', 'Hilton | Hilton Honors'],
  [418, 'hyatt-world-hyatt', 'Hyatt | World of Hyatt'],
  [426, 'intercontinental-hotels-ihg-one-rewards-intercontinental-ambassador', 'InterContinental Hotels | IHG One Rewards'],
  [428, 'radisson-international-radisson-rewards', 'Radisson International | Radisson Rewards'],
  [430, 'wyndham-wyndham-rewards', 'Wyndham | Wyndham Rewards'],
  [640, 'choice-choice-privileges', 'Choice | Choice Privileges'],
  [667, 'accor-all-accor-live-limitless', 'Accor | ALL (Accor Live Limitless)'],
  [766, 'marriott-marriott-bonvoy', 'Marriott | Marriott Bonvoy'],
  // Credit cards
  [410, 'american-express-membership-rewards', 'American Express | Membership Rewards'],
  [722, 'chase-ultimate-rewards', 'Chase | Ultimate Rewards'],
  [739, 'citi-thankyou-rewards', 'Citi | ThankYou Rewards'],
  [778, 'capital-one-discover-diners-club-rewards-miles', 'Capital One, Discover, and Diners Club'],
  [719, 'manufactured-spending', 'Manufactured Spending'],
];

let _forumMapCache = null;

function getForumMapImpl() {
  if (_forumMapCache) return _forumMapCache;
  const byName = {};
  const byId = {};
  const popular = FORUM_MAP_RAW.map(([id, slug, name]) => ({ id, slug, name }));
  for (const { id, slug } of popular) {
    byName[slug] = id;
    byId[id] = slug;
  }
  _forumMapCache = { byName, byId, popular };
  return _forumMapCache;
}

/* ───── URL parsers ───── */

function parseThreadUrlImpl(href) {
  if (!href) return null;
  const m = href.match(/\/forum\/([^/]+)\/(\d+)-([^?#]*?)\.html(?:\?.*)?$/i);
  if (!m) return null;
  const pageMatch = href.match(/-(\d+)-printerfriendly\.html/) || href.match(/&page=(\d+)/);
  return {
    forumSlug: m[1],
    threadId: Number(m[2]),
    threadSlug: m[3],
    page: pageMatch ? Number(pageMatch[1]) : undefined,
  };
}

function parseForumUrlImpl(href) {
  if (!href) return null;
  const m = href.match(/\/forum\/([^/]+)-(\d+)\/?(?:\?.*)?$/i);
  if (!m) return null;
  const pageMatch = href.match(/[?&]page=(\d+)/);
  return { forumSlug: m[1], forumId: Number(m[2]), page: pageMatch ? Number(pageMatch[1]) : undefined };
}

function parseArticleUrl(href) {
  if (!href) return null;
  const m = href.match(/\/articles\/([^/]+?)\.html(?:\?.*)?$/i);
  return m ? { slug: m[1] } : null;
}

function parseMemberUrl(href) {
  if (!href) return null;
  const idMatch = href.match(/member\.php\?u=(\d+)/);
  if (idMatch) return { userId: Number(idMatch[1]) };
  const slugMatch = href.match(/\/forum\/members\/([^/?#]+?)(?:\.html)?$/);
  if (slugMatch) return { username: slugMatch[1] };
  return null;
}

function currentRouteImpl() {
  const href = location.href;
  const pathname = location.pathname;
  const thread = parseThreadUrlImpl(href);
  if (thread) return { type: 'thread', threadId: thread.threadId, page: thread.page };
  const forum = parseForumUrlImpl(href);
  if (forum) return { type: 'forum', forumId: forum.forumId, page: forum.page };
  const member = parseMemberUrl(href);
  if (member) return { type: 'member', userId: member.userId, username: member.username };
  const article = parseArticleUrl(href);
  if (article) return { type: 'article', articleSlug: article.slug };
  if (pathname === '/' || pathname === '') return { type: 'home' };
  if (pathname.startsWith('/forum/search.php')) return { type: 'search' };
  if (pathname === '/forum/' || pathname === '/forum') return { type: 'forum' };
  return { type: 'unknown' };
}

/* ───── searchAll fan-out ───── */

async function getVbulletin() {
  const w = window;
  for (let i = 0; i < 20; i++) {
    const ns = w.xgoose?.skills?.vbulletin;
    if (ns && typeof ns.searchPosts === 'function') return ns;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    'flyertalk.searchAll: vbulletin-forum skill is not loaded. ' +
      'On flyertalk.com root pages, both skills must be active — verify the extension is enabled and reload the page.',
  );
}

export default defineSkill({
  searchAll: fn({
    summary:
      'Parallel fan-out across articles + forum posts + forum threads. ★ primary entry — start here for any FlyerTalk research question.',
    input: z.object({
      query: z.string(),
      author: z.string().optional().describe('Restrict forum-side search to posts by this user (exact-name).'),
      perAngle: z.number().int().min(1).max(50).optional().describe('Results per source. Default 10.'),
    }),
    examples: [
      { args: { query: 'amex platinum 175k SUB' } },
      { args: { query: 'IHG ghost reservation', perAngle: 5 } },
    ],
    handler: async ({ query, author, perAngle }) => {
      const cap = Math.max(1, perAngle ?? 10);
      const ns = await getVbulletin();

      const articlesPromise = author
        ? Promise.resolve([])
        : (async () => {
            const sp = new URLSearchParams({
              per_page: String(Math.min(100, cap)),
              page: '1',
              _fields: SUMMARY_FIELDS,
              search: query,
            });
            const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
            return Array.isArray(arr) ? arr.map(toSummary) : [];
          })().catch(() => []);

      const postsParams = { query, page: 1 };
      if (author) {
        postsParams.author = author;
        postsParams.exactName = true;
      }
      const postsPromise = ns
        .searchPosts(postsParams)
        .then((r) => r.results.slice(0, cap))
        .catch(() => []);

      const threadsParams = { query, page: 1 };
      if (author) {
        threadsParams.author = author;
        threadsParams.exactName = true;
        threadsParams.starterOnly = true;
      }
      const threadsPromise = ns
        .searchThreads(threadsParams)
        .then((r) => r.results.slice(0, cap))
        .catch(() => []);

      const [articles, posts, threads] = await Promise.all([articlesPromise, postsPromise, threadsPromise]);
      const out = { articles, posts, threads, query };
      if (author) out.author = author;
      return out;
    },
  }),

  searchArticles: fn({
    summary: 'WordPress full-text search across /articles/* (anonymous /wp-json).',
    input: z.object({
      query: z.string(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
      categoryId: z.number().int().positive().optional(),
    }),
    handler: async ({ query, perPage, page, categoryId }) => {
      const sp = new URLSearchParams({
        per_page: String(Math.min(100, Math.max(1, perPage ?? 10))),
        page: String(Math.max(1, page ?? 1)),
        _fields: SUMMARY_FIELDS,
      });
      if (query) sp.set('search', query);
      if (categoryId != null) sp.set('categories', String(categoryId));
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
      return Array.isArray(arr) ? arr.map(toSummary) : [];
    },
  }),

  getArticle: fn({
    summary: 'Fetch a WordPress article by id or slug.',
    input: z
      .object({ id: z.number().int().positive().optional(), slug: z.string().optional() })
      .refine((v) => v.id != null || !!v.slug, { message: 'pass id or slug' }),
    handler: async ({ id, slug }) => {
      if (id != null) {
        const sp = new URLSearchParams({ _fields: FULL_FIELDS });
        const r = await fetchJson(`/wp-json/wp/v2/posts/${id}?${sp}`);
        return r ? toFull(r) : null;
      }
      const sp = new URLSearchParams({ slug, _fields: FULL_FIELDS, per_page: '1' });
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
      return arr[0] ? toFull(arr[0]) : null;
    },
  }),

  summarizeArticle: fn({
    summary: 'Fetch an article by slug and return a tldr-style snapshot.',
    input: z.object({ slug: z.string(), maxChars: z.number().int().min(80).max(20000).optional() }),
    handler: async ({ slug, maxChars }) => {
      const sp = new URLSearchParams({ slug, _fields: FULL_FIELDS, per_page: '1' });
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
      const post = arr[0] ? toFull(arr[0]) : null;
      if (!post) throw new Error(`summarizeArticle: no article with slug "${slug}"`);
      const max = Math.max(80, maxChars ?? 1200);
      const tldr =
        post.contentText.length > max
          ? `${post.contentText.slice(0, max - 1).trimEnd()}…`
          : post.contentText;
      return { title: post.title, date: post.date, tldr, link: post.link };
    },
  }),

  listArticleCategories: fn({
    summary: 'List all WP article categories (up to 100, sorted by REST default).',
    input: z.object({}),
    handler: async () => {
      const sp = new URLSearchParams({ per_page: '100', _fields: 'id,name,slug,count' });
      const arr = (await fetchJson(`/wp-json/wp/v2/categories?${sp}`)) ?? [];
      return arr.map((c) => ({ id: c.id, name: stripHtml(c.name), slug: c.slug, count: c.count ?? 0 }));
    },
  }),

  getForumMap: fn({
    summary: 'Curated forum slug ↔ id catalog (top-level, airlines, hotels, credit cards).',
    input: z.object({}),
    handler: async () => getForumMapImpl(),
  }),

  currentRoute: fn({
    summary: 'Parse the current page URL into a structured Route descriptor.',
    input: z.object({}),
    handler: async () => currentRouteImpl(),
  }),

  parseThreadUrl: fn({
    summary: 'Extract { threadId, forumSlug, threadSlug, page? } from a FlyerTalk SEO thread URL. Returns null if not a thread.',
    input: z.object({ href: z.string() }),
    handler: async ({ href }) => parseThreadUrlImpl(href),
  }),

  parseForumUrl: fn({
    summary: 'Extract { forumId, forumSlug, page? } from a FlyerTalk SEO forum URL. Returns null if not a forum.',
    input: z.object({ href: z.string() }),
    handler: async ({ href }) => parseForumUrlImpl(href),
  }),
});
