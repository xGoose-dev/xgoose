// ==XGooseSkill==
// @name         uscardforum
// @namespace    uscf
// @version      0.2.15
// @description  美卡论坛：搜索信用卡、积分与旅行讨论，汇总社区共识和实测 DP。
// @match        *://www.uscardforum.com/*
// @match        *://uscardforum.com/*
// @detect       location.hostname.endsWith('uscardforum.com')
// @run-at       document_idle
// @require      discourse-forum@0.2.19
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

export default defineSkill({
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
- 查玩法时，用英文卡名、商户名配合「撸」「叠加」「改 payment」等论坛用语找实测 DP，沿相关长帖追最新回帖和结果更新。
- 主动寻找与初步判断不一致的近期亲历报告，特别留意意外成功和意外失败的案例。论坛经验与公开指南有出入时，用这些报告讲清楚实际步骤、适用条件和结果。
- 写清每种玩法的步骤、收益、日期、金额和适用条件，附作者、楼层链接及可用的点赞数。
- 补读时可在同一轮并行调用 discourse.readTopicPosts 读取不同主题。遇到超时后，逐个发出剩余的读帖调用。同一主题按 next_cursor 顺序逐页读。
- 比较信用卡时，结合社区反馈说明开卡奖励与要求、年费、权益、积分价值、适合人群及申请策略。
- 总结长帖内容，读取与分页遵循 discourse-forum。`,
});
