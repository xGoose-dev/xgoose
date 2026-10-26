// ==XGooseSkill==
// @name         uscardforum
// @namespace    uscf
// @version      0.2.8
// @description  美卡论坛：搜索信用卡、积分与旅行讨论，汇总社区共识和实测 DP。
// @match        *://www.uscardforum.com/*
// @match        *://uscardforum.com/*
// @detect       location.hostname.endsWith('uscardforum.com')
// @run-at       document_idle
// @require      discourse-forum@0.2.9
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
  if (!candidates.length) throw new Error('未获取到最新羊毛搜索结果。');
  candidates.sort((a,b)=>Date.parse(b.last_posted_at || b.created_at)-Date.parse(a.last_posted_at || a.created_at));
  const topics=[];
  for(const item of candidates.slice(0,8)) {
    try {
      const detail=await discourse().getTopic({id:item.id,maxChars:2500});
      topics.push({id:item.id,title:item.title,url:`${location.origin}/t/${item.id}`,created_at:item.created_at,last_posted_at:item.last_posted_at,posts:detail.posts || [],read_error:detail.httpStatus ? detail.message : undefined});
    } catch(error) { topics.push({id:item.id,title:item.title,url:`${location.origin}/t/${item.id}`,read_error:String(error)}); }
  }
  return {kind:'deals',topics,hint:'每帖仅前五楼预览；按需读取后续 DP，附原帖链接。'};
}

export default defineSkill({
  getRecentDeals: fn({
    summary: 'Find recent deals; returns up to eight topics with five-post previews and source links.',
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
    summary: 'Search a card or topic name, sorted by latest. Returns snippets.',
    input: z.object({ name: z.string() }),
    handler: async ({ name }) =>
      discourse().searchTopics({ query: name, order: 'latest' }),
  }),

  getRecentDPs: fn({
    summary: 'Search keyword + literal DP within the last 60 days. For broader results use discourse.searchTopics.',
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
  instructions: `美卡论坛是美国信用卡、银行、积分、里程与财务优化社区。使用中文回复。
- 搜索相关讨论，优先阅读近期（尽可能近 6 个月）、点赞和回复较多的有用帖子，关注真实用户经历、官方公告及政策变化，汇总社区共识与可操作的 DP。
- 查找 DP 时重点关注近 3–6 个月，提取发生了什么、日期、金额、相关条件和用户情况；附作者、主题 ID、楼层链接及可用的点赞数，展示规律和趋势。
- 比较信用卡时，结合社区反馈说明开卡奖励与要求、年费、权益、积分价值、适合人群及申请策略。
- 总结长帖内容，读取与分页遵循 discourse-forum。`,
  actions: [
    {label:'最近羊毛', prompt:'根据 action-result 总结近期有用的羊毛和 offer，说明适用条件、社区反馈与实测 DP，附日期和原帖链接；关键正文不足时补读。',js:'return await xgoose.skills.uscf.getRecentDeals({});'},
  ],
});
