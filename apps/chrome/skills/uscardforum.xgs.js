// ==XGooseSkill==
// @name         uscardforum
// @namespace    uscf
// @version      0.2.3
// @description  美卡论坛 (uscardforum.com) helpers — categorised search + DP shortcuts on top of discourse-forum.
// @match        *://www.uscardforum.com/*
// @match        *://uscardforum.com/*
// @detect       location.hostname.endsWith('uscardforum.com')
// @run-at       document_idle
// @require      discourse-forum@0.2.2
// @primary      searchInCategory
// @keyword      uscardforum
// @keyword      美卡论坛
// @keyword      DP
// @keyword      data point
// ==/XGooseSkill==

/**
 * Site-specific layer over the generic Discourse skill. Provides:
 *
 *   - getCategoryMap()       : Chinese name → numeric id (e.g. "玩卡" → 12)
 *   - getCategorySlugs()     : Chinese name → URL slug (e.g. "玩卡" → "wanka")
 *   - currentRoute()         : parsed route from location.pathname
 *   - searchCards(name)      : latest-ordered search for "{name}"
 *   - searchInCategory(q, slug): qualified search "{q} category:{slug}"
 *   - getRecentDPs(keyword)  : last 60 days "DP" search ordered by latest
 *   - getMyBookmarks()       : my saved bookmarks via Discourse REST
 *
 * Relies on `xgoose.skills.discourse` being injected first (see @require).
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const CATEGORY_MAP = {
  玩卡: 12,
  信用卡: 5,
  银行: 9,
  旅行: 15,
  航空: 38,
  酒店: 7,
  败家: 20,
  闲聊: 1,
  搬砖: 33,
  生活: 51,
  情感: 28,
  吵架: 42,
  '白金 Lounge': 68,
};

const CATEGORY_SLUGS = {
  玩卡: 'wanka',
  信用卡: 'xinyongka',
  银行: 'yinhang',
  旅行: 'lvxing',
  航空: 'hangkong',
  酒店: 'jiudian',
  败家: 'baijia',
  闲聊: 'xianliao',
  搬砖: 'banzhuan',
  生活: 'shenghuo',
  情感: 'qinggan',
  吵架: 'chaojia',
  '白金 Lounge': 'baijin',
};

function discourse() {
  const d = window.xgoose?.skills?.discourse;
  if (!d) throw new Error('uscardforum requires discourse-forum (was it loaded first?)');
  return d;
}

function currentRouteImpl() {
  const p = location.pathname;
  let m = p.match(/^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?\/?$/);
  if (m)
    return { type: 'topic', slug: m[1], topicId: Number(m[2]), postNumber: m[3] ? Number(m[3]) : undefined };
  m = p.match(/^\/c\/([^/]+)\/?$/);
  if (m) return { type: 'category', slug: m[1] };
  m = p.match(/^\/u\/([^/]+)\/?$/);
  if (m) return { type: 'user', username: m[1] };
  if (p === '/latest' || p === '/latest/') return { type: 'latest' };
  if (p === '/top' || p === '/top/') return { type: 'top' };
  if (p === '/hot' || p === '/hot/') return { type: 'hot' };
  if (p === '/new' || p === '/new/') return { type: 'new' };
  return { type: 'unknown' };
}


async function recentDeals() {
  const results = await Promise.allSettled(['羊毛','offer','优惠'].map(query=>discourse().searchTopics({query,order:'latest'})));
  const found=results.flatMap(r=>r.status==='fulfilled' ? r.value.topics || [] : []);
  const candidates=[...new Map(found.filter(t=>!t.pinned && t.archetype!=='private_message').map(t=>[t.id,t])).values()];
  if (!candidates.length) throw new Error('未获取到最新羊毛搜索结果，请稍后重试；不要编造优惠。');
  candidates.sort((a,b)=>Date.parse(b.last_posted_at || b.created_at)-Date.parse(a.last_posted_at || a.created_at));
  const topics=[];
  for(const item of candidates.slice(0,8)) {
    try {
      const detail=await discourse().getTopic({id:item.id,maxChars:2500});
      topics.push({id:item.id,title:item.title,url:`${location.origin}/t/${item.id}`,created_at:item.created_at,last_posted_at:item.last_posted_at,posts:detail.posts || [],read_error:detail.httpStatus ? detail.message : undefined});
    } catch(error) { topics.push({id:item.id,title:item.title,url:`${location.origin}/t/${item.id}`,read_error:String(error)}); }
  }
  return {kind:'deals',topics,hint:'只根据实际读到的正文总结优惠，附 Markdown 原帖链接，明确读取错误及尚未核实的条件。'};
}

export default defineSkill({
  getRecentDeals: fn({
    summary: 'Read recent credit-card deals and offers from 美卡论坛, with original topic links.',
    input: z.object({}),
    handler: async () => recentDeals(),
  }),
  searchInCategory: fn({
    summary: 'Search topics within a specific 美卡论坛 category. ★ primary entry.',
    input: z.object({
      query: z.string(),
      categorySlug: z
        .string()
        .describe('URL slug, e.g. "wanka". Get from getCategorySlugs() if you only know the Chinese name.'),
    }),
    examples: [{ args: { query: 'amex platinum 175k', categorySlug: 'xinyongka' } }],
    handler: async ({ query, categorySlug }) => {
      return discourse().searchTopics({
        query: `${query} category:${categorySlug}`,
      });
    },
  }),

  searchCards: fn({
    summary: 'Latest-ordered search for a card / topic name.',
    input: z.object({ name: z.string() }),
    handler: async ({ name }) =>
      discourse().searchTopics({ query: name, order: 'latest' }),
  }),

  getRecentDPs: fn({
    summary: 'Search for recent (last 60 days) data points (DPs) about a keyword.',
    input: z.object({ keyword: z.string() }),
    handler: async ({ keyword }) => {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return discourse().searchTopics({
        query: `${keyword} DP after:${since}`,
        order: 'latest',
      });
    },
  }),

  getMyBookmarks: fn({
    summary: 'List the current user\'s bookmarks (login required).',
    input: z.object({}),
    handler: async () => {
      const user = await discourse().getCurrentUser({});
      const username = user?.current_user?.username;
      if (!username) throw new Error('not logged in');
      const r = await fetch(`/u/${encodeURIComponent(username)}/bookmarks.json`, {
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`GET bookmarks -> HTTP ${r.status}`);
      return await r.json();
    },
  }),

  getCategoryMap: fn({
    summary: 'Static map: Chinese category name → numeric Discourse category id.',
    input: z.object({}),
    handler: async () => CATEGORY_MAP,
  }),

  getCategorySlugs: fn({
    summary: 'Static map: Chinese category name → URL slug (for use with searchInCategory).',
    input: z.object({}),
    handler: async () => CATEGORY_SLUGS,
  }),

  currentRoute: fn({
    summary: 'Parse the current page URL into a structured Route descriptor.',
    input: z.object({}),
    handler: async () => currentRouteImpl(),
  }),
}, {
  instructions: `美卡论坛 (uscardforum.com) research discipline — follow this for any forum-grounded credit-card / travel / DP question.

- **快捷操作优先使用已提取的 action-result。** 最近新帖、最近羊毛、当前帖子概括和随机推荐已经读取了正文，不要再强制执行三组泛化搜索。只有正文不足或截断影响结论时才定向补读。
- **Call tools first, talk later.** Never answer from memory, even for "simple" questions — search the forum first. For current-page asks (\`/t/...\` topic, \`/c/...\` category), \`read_page\` the page first.
- **Fan out ≥3 searches in parallel, varied keywords.** Forum search is keyword-based, so one query misses a lot. In ONE \`js_exec\`, \`Promise.allSettled\` over 3+ variations so one failed search cannot hide other results: Chinese slang + formal name + English abbreviation, synonyms / alternate spellings, and different category scopes. E.g. for "CSR": \`Promise.all([ xgoose.skills.uscf.searchCards({name:'CSR 申卡'}), xgoose.skills.uscf.searchCards({name:'Chase Sapphire Reserve'}), xgoose.skills.uscf.getRecentDPs({keyword:'CSR 批卡'}), xgoose.skills.uscf.searchInCategory({query:'chase sapphire 被拒', categorySlug:'xinyongka'}) ])\`. Use \`getCategorySlugs()\` to scope by category.
- **Result shape.** Discourse helpers return their data directly: topic.posts[].text, with topic.url and per-post URLs. There is no result.post_stream wrapper. text_truncated marks incomplete bodies; increase maxChars and return a narrow projection to recover the relevant passage. Preserve rate-limit/login errors and successful results separately.
- **Read posts, not titles.** Search returns only titles/snippets (often misleading) — never answer from them. In ONE follow-up \`js_exec\`, read the top 2–3 unique topics in full *together* via \`Promise.all\` over \`xgoose.skills.discourse.getTopic({id})\` / \`getTopicPosts({topicId, postNumber})\`. Batch the reads into that single call — don't read one thread per turn (each extra turn is a slow model round-trip). Answer from what you *read*.
- **Go wide, then deep.** Broad parallel searches → read the top hits in one batch → only do a second targeted round if the first batch is clearly insufficient (it usually isn't). Continue until the necessary evidence is read; do not stop merely to meet a tool-step target.
- **Prefer recent DPs.** Card policies change constantly — use \`getRecentDPs(keyword)\` (last 60 days) or add \`after:YYYY-MM-DD\` to a query. Recent DPs are useful context, but do not override contractual terms. Date the evidence and say when current terms are unverified.
- **Paginate deliberately.** Topics with 100+ posts bury valuable DPs deep. Deleted posts leave gaps in post numbers, so page with \`getTopicPosts({ topicId, postNumber: lastReceivedPostNumber + 1 })\` (last was #148 → request 149). Never reread overlapping ranges, and never refetch a topic_id + post_number range you already pulled this turn.
- **Cross-reference + follow leads.** Compare DPs across users and threads, note contradictions, search "DP汇总" / "dp" aggregation threads, and immediately look up any card / strategy / user a post mentions with another call.
- If a search is empty or rate-limited, reword broader or fall back to latest / hot lists, then state the limitation plainly.`,
  actions: [
    {label:'最近羊毛', prompt:'根据 action-result 读到的最新羊毛、offer 和优惠内容，总结优惠、适用条件、有效期与 DP，标明尚未核实或可能过期的信息，每项附可点击的 Markdown 原帖链接。',js:'return await xgoose.skills.uscf.getRecentDeals({});'},
  ],
});
