// ==XGooseSkill==
// @name        zhihu
// @namespace   zhihu
// @version     0.1.0
// @description 知乎 (zhihu.com) Q&A + article reader. Pure JSON API + SSR-HTML parsing — search, read questions/answers/articles/comments/热榜/users. No DOM scraping, no clicks. Reply to the user in Chinese (中文).
// @match       *://www.zhihu.com/*
// @match       *://zhuanlan.zhihu.com/*
// @detect      location.hostname.endsWith('zhihu.com')
// @run-at      document_idle
// @connect     <self>
// @primary     search
// @keyword     zhihu
// @keyword     知乎
// @keyword     Chinese Quora
// @keyword     中文问答
// @keyword     zhuanlan
// @keyword     专栏
// @keyword     回答
// @keyword     提问
// @keyword     热榜
// @keyword     想法
// ==/XGooseSkill==

/**
 * 知乎 (zhihu.com) Q&A + article reader. Pure JSON API + SSR-HTML parsing — search, read questions/answers/articles/comments/热榜/users. No DOM scraping, no clicks. Reply to the user in Chinese (中文).
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # 知乎 (Zhihu) — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object. The skill activates on `www.zhihu.com` and `zhuanlan.zhihu.com`; it reads same-origin REST endpoints plus the page's SSR'd `#js-initialData` blob. **No login required for any of the read paths** — guest sessions return the same data the logged-in UI sees. Zhihu's signed `x-zse-96` header is _not_ used; the few endpoints that enforce it (e.g. `/api/v4/questions/{id}`) are avoided in favour of the SSR fallback.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const ANSWER_INCLUDE = "content,excerpt,voteup_count,comment_count,created_time,updated_time,is_collapsed,is_sticky,is_normal,author,question";
const MEMBER_INCLUDE = "headline,description,answer_count,question_count,articles_count,follower_count,following_count,voteup_count,gender";
const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "\u2026",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D"
};
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&[a-zA-Z]+;/g, (m) => ENTITY_MAP[m] ?? m);
}
__name(decodeEntities, "decodeEntities");
function stripHtml(html) {
  if (!html) return "";
  return decodeEntities(
    String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
__name(stripHtml, "stripHtml");
async function fetchJson(url) {
  const r = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-cache",
    headers: { Accept: "application/json, text/plain, */*" }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`zhihu: GET ${url} \u2192 HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  return await r.json();
}
__name(fetchJson, "fetchJson");
async function fetchHtml(url) {
  const r = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-cache",
    headers: { Accept: "text/html,application/xhtml+xml" }
  });
  if (!r.ok) {
    throw new Error(`zhihu: GET ${url} \u2192 HTTP ${r.status}`);
  }
  return await r.text();
}
__name(fetchHtml, "fetchHtml");
function extractInitialData(html) {
  const m = html.match(/<script[^>]+id=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("zhihu: js-initialData script tag not found in HTML response");
  return JSON.parse(m[1]);
}
__name(extractInitialData, "extractInitialData");
function toAuthor(a) {
  if (!a) return { id: "", urlToken: "", name: "" };
  return {
    id: String(a.id ?? ""),
    urlToken: String(a.url_token ?? a.urlToken ?? ""),
    name: String(a.name ?? ""),
    headline: a.headline ? String(a.headline) : void 0,
    avatarUrl: a.avatar_url ?? a.avatarUrl ?? void 0
  };
}
__name(toAuthor, "toAuthor");
function answerUrl(qid, aid) {
  return `https://www.zhihu.com/question/${qid}/answer/${aid}`;
}
__name(answerUrl, "answerUrl");
function questionUrl(qid) {
  return `https://www.zhihu.com/question/${qid}`;
}
__name(questionUrl, "questionUrl");
function articleUrl(id) {
  return `https://zhuanlan.zhihu.com/p/${id}`;
}
__name(articleUrl, "articleUrl");
function toAnswerFromApi(r) {
  const qid = String(r.question?.id ?? "");
  const aid = String(r.id);
  const html = r.content ?? "";
  return {
    id: aid,
    questionId: qid,
    url: qid ? answerUrl(qid, aid) : "",
    excerpt: stripHtml(r.excerpt ?? ""),
    voteupCount: Number(r.voteup_count ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    createdTime: Number(r.created_time ?? 0),
    updatedTime: Number(r.updated_time ?? 0),
    author: toAuthor(r.author),
    contentHtml: html,
    contentText: stripHtml(html)
  };
}
__name(toAnswerFromApi, "toAnswerFromApi");
function toAnswerFromInitialData(r) {
  const qid = String(r.question?.id ?? "");
  const aid = String(r.id);
  const html = r.content ?? "";
  return {
    id: aid,
    questionId: qid,
    url: qid ? answerUrl(qid, aid) : "",
    excerpt: stripHtml(r.excerpt ?? ""),
    voteupCount: Number(r.voteupCount ?? 0),
    commentCount: Number(r.commentCount ?? 0),
    createdTime: Number(r.createdTime ?? 0),
    updatedTime: Number(r.updatedTime ?? 0),
    author: toAuthor(r.author),
    contentHtml: html,
    contentText: stripHtml(html)
  };
}
__name(toAnswerFromInitialData, "toAnswerFromInitialData");
async function search(params) {
  if (!params || typeof params.query !== "string") {
    throw new Error("zhihu.search: pass { query: string, type?, offset?, limit? }");
  }
  const type = params.type ?? "general";
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(20, Math.max(1, params.limit ?? 10));
  const sp = new URLSearchParams({
    t: type,
    q: params.query,
    correction: "1",
    offset: String(offset),
    limit: String(limit)
  });
  const url = `https://www.zhihu.com/api/v4/search_v3?${sp}`;
  const json = await fetchJson(url);
  const out = [];
  for (const row of json.data ?? []) {
    const o = row?.object;
    if (!o || !o.type) continue;
    out.push(toSearchHit(o));
  }
  return out;
}
__name(search, "search");
function toSearchHit(o) {
  const type = String(o.type);
  const id = String(o.id ?? o.original_id ?? "");
  switch (type) {
    case "answer": {
      const qid = String(o.question?.id ?? "");
      return {
        type: "answer",
        id,
        questionId: qid,
        title: stripHtml(o.question?.name ?? o.title ?? ""),
        excerpt: stripHtml(o.excerpt ?? o.content ?? ""),
        url: qid ? answerUrl(qid, id) : "",
        voteupCount: Number(o.voteup_count ?? 0),
        commentCount: Number(o.comment_count ?? 0),
        createdTime: Number(o.created_time ?? 0),
        author: toAuthor(o.author)
      };
    }
    case "article": {
      return {
        type: "article",
        id,
        title: stripHtml(o.title ?? ""),
        excerpt: stripHtml(o.excerpt ?? ""),
        url: articleUrl(id),
        voteupCount: Number(o.voteup_count ?? 0),
        commentCount: Number(o.comment_count ?? 0),
        createdTime: Number(o.created ?? o.created_time ?? 0),
        author: toAuthor(o.author)
      };
    }
    case "question": {
      return {
        type: "question",
        id,
        title: stripHtml(o.title ?? o.name ?? ""),
        excerpt: stripHtml(o.excerpt ?? ""),
        url: questionUrl(id),
        commentCount: Number(o.comment_count ?? 0),
        createdTime: Number(o.created ?? 0),
        author: toAuthor(o.author)
      };
    }
    case "people": {
      return {
        type: "people",
        id,
        title: stripHtml(o.name ?? ""),
        excerpt: stripHtml(o.headline ?? o.description ?? ""),
        url: `https://www.zhihu.com/people/${o.url_token ?? ""}`,
        author: toAuthor(o)
      };
    }
    case "topic": {
      return {
        type: "topic",
        id,
        title: stripHtml(o.name ?? ""),
        excerpt: stripHtml(o.introduction ?? ""),
        url: `https://www.zhihu.com/topic/${id}`
      };
    }
    case "column": {
      return {
        type: "column",
        id,
        title: stripHtml(o.title ?? ""),
        excerpt: stripHtml(o.description ?? o.intro ?? ""),
        url: `https://zhuanlan.zhihu.com/${id}`
      };
    }
    default:
      return {
        type,
        id,
        title: stripHtml(o.title ?? o.name ?? ""),
        url: o.url ?? ""
      };
  }
}
__name(toSearchHit, "toSearchHit");
async function getHotList(params = {}) {
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const url = `https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=${limit}&desktop=true`;
  const json = await fetchJson(url);
  const out = [];
  for (const row of json.data ?? []) {
    const t = row?.target;
    if (!t || t.type !== "question") continue;
    const qid = String(t.id);
    out.push({
      questionId: qid,
      title: stripHtml(t.title ?? t.title_area?.text ?? ""),
      excerpt: stripHtml(t.excerpt ?? ""),
      url: questionUrl(qid),
      heatText: String(row.detail_text ?? ""),
      answerCount: Number(t.answer_count ?? 0),
      followerCount: Number(t.follower_count ?? 0)
    });
  }
  return out;
}
__name(getHotList, "getHotList");
async function getQuestion(params) {
  if (!params || params.questionId == null) {
    throw new Error("zhihu.getQuestion: pass { questionId }");
  }
  const qid = String(params.questionId);
  if (typeof location !== "undefined" && !location.hostname.endsWith("zhihu.com")) {
    throw new Error("zhihu.getQuestion: must be called from a zhihu.com tab");
  }
  const html = await fetchHtml(`https://www.zhihu.com/question/${qid}`);
  const data = extractInitialData(html);
  const entities = data?.initialState?.entities;
  const rawQ = entities?.questions?.[qid];
  if (!rawQ) {
    throw new Error(`zhihu.getQuestion: question ${qid} not found in initial data (404 / removed?)`);
  }
  const question = {
    id: qid,
    title: stripHtml(rawQ.title ?? ""),
    detail: stripHtml(rawQ.detail ?? ""),
    url: questionUrl(qid),
    createdTime: Number(rawQ.created ?? 0),
    updatedTime: Number(rawQ.updatedTime ?? 0),
    answerCount: Number(rawQ.answerCount ?? 0),
    followerCount: Number(rawQ.followerCount ?? 0),
    commentCount: Number(rawQ.commentCount ?? 0),
    voteupCount: Number(rawQ.voteupCount ?? 0),
    visitCount: Number(rawQ.visitCount ?? 0),
    topics: (rawQ.topics ?? []).map((t) => ({ id: String(t.id), name: stripHtml(t.name) })),
    author: toAuthor(rawQ.author)
  };
  const answers = Object.values(entities?.answers ?? {}).map((a) => toAnswerFromInitialData(a)).filter((a) => a.questionId === qid).sort((a, b) => b.voteupCount - a.voteupCount);
  return {
    question,
    answers,
    hasMore: answers.length < question.answerCount
  };
}
__name(getQuestion, "getQuestion");
async function getAnswers(params) {
  if (!params || params.questionId == null) {
    throw new Error("zhihu.getAnswers: pass { questionId, offset?, limit?, sortBy? }");
  }
  const qid = String(params.questionId);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(20, Math.max(1, params.limit ?? 5));
  const sortBy = params.sortBy ?? "default";
  const sp = new URLSearchParams({
    include: ANSWER_INCLUDE,
    offset: String(offset),
    limit: String(limit),
    platform: "desktop",
    sort_by: sortBy
  });
  const url = `https://www.zhihu.com/api/v4/questions/${qid}/answers?${sp}`;
  const json = await fetchJson(url);
  const answers = (json.data ?? []).map(toAnswerFromApi);
  const paging = {
    isEnd: !!json.paging?.is_end,
    totals: Number(json.paging?.totals ?? 0) || void 0,
    nextOffset: json.paging?.is_end ? null : offset + answers.length
  };
  return { answers, paging };
}
__name(getAnswers, "getAnswers");
async function getAnswer(params) {
  if (!params || params.answerId == null) {
    throw new Error("zhihu.getAnswer: pass { answerId }");
  }
  const aid = String(params.answerId);
  const sp = new URLSearchParams({ include: ANSWER_INCLUDE });
  const url = `https://www.zhihu.com/api/v4/answers/${aid}?${sp}`;
  const raw = await fetchJson(url);
  return toAnswerFromApi(raw);
}
__name(getAnswer, "getAnswer");
async function getArticle(params) {
  if (!params || params.articleId == null) {
    throw new Error("zhihu.getArticle: pass { articleId }");
  }
  const id = String(params.articleId);
  if (typeof location !== "undefined" && location.hostname !== "zhuanlan.zhihu.com") {
    throw new Error(
      `zhihu.getArticle: article HTML lives at ${articleUrl(id)}, which is CORS-blocked from ${location.origin}. Three ways to recover without losing the user's context: (1) call js_exec with \`tab_id: <a zhuanlan tab id>\` \u2014 list_tabs() will show them; (2) accept the search excerpt as the answer (search returns a 100\u2013500 char preview per article); (3) navigate THIS tab: \`location.href = ` + JSON.stringify(articleUrl(id)) + '` then call getArticle again. See SKILL.md \xA7"Reading articles without navigating".'
    );
  }
  const html = await fetchHtml(`https://zhuanlan.zhihu.com/p/${id}`);
  const data = extractInitialData(html);
  const entities = data?.initialState?.entities;
  const rawA = entities?.articles?.[id];
  if (!rawA) {
    throw new Error(`zhihu.getArticle: article ${id} not found in initial data (404 / removed?)`);
  }
  const content = rawA.content ?? "";
  return {
    id,
    title: stripHtml(rawA.title ?? ""),
    url: articleUrl(id),
    contentHtml: content,
    contentText: stripHtml(content),
    excerpt: stripHtml(rawA.excerpt ?? ""),
    createdTime: Number(rawA.created ?? 0),
    updatedTime: Number(rawA.updated ?? 0),
    voteupCount: Number(rawA.voteupCount ?? 0),
    commentCount: Number(rawA.commentCount ?? 0),
    author: toAuthor(rawA.author),
    column: rawA.column ? {
      id: String(rawA.column.id),
      title: stripHtml(rawA.column.title ?? ""),
      url: String(rawA.column.url ?? "")
    } : null
  };
}
__name(getArticle, "getArticle");
const TARGET_TYPE_NORMALIZE = {
  answer: "answers",
  answers: "answers",
  article: "articles",
  articles: "articles",
  question: "questions",
  questions: "questions"
};
async function getComments(params) {
  if (!params || !params.targetType || params.targetId == null) {
    throw new Error('zhihu.getComments: pass { targetType: "answer(s)"|"article(s)"|"question(s)", targetId, offset?, limit?, orderBy? }');
  }
  const normalized = TARGET_TYPE_NORMALIZE[params.targetType];
  if (!normalized) {
    throw new Error(
      `zhihu.getComments: targetType must be one of answer|answers|article|articles|question|questions (got ${JSON.stringify(params.targetType)})`
    );
  }
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(20, Math.max(1, params.limit ?? 10));
  const orderBy = params.orderBy ?? "score";
  const sp = new URLSearchParams({
    order_by: orderBy,
    limit: String(limit),
    offset: String(offset)
  });
  const url = `https://www.zhihu.com/api/v4/comment_v5/${normalized}/${params.targetId}/root_comment?${sp}`;
  const json = await fetchJson(url);
  const comments = (json.data ?? []).map((c) => ({
    id: String(c.id),
    authorName: String(c.author?.name ?? ""),
    authorUrlToken: String(c.author?.url_token ?? ""),
    contentText: stripHtml(c.content ?? ""),
    voteupCount: Number(c.like_count ?? c.vote_count ?? 0),
    createdTime: Number(c.created_time ?? 0)
  }));
  const paging = {
    isEnd: !!json.paging?.is_end,
    totals: Number(json.paging?.totals ?? 0) || void 0,
    nextOffset: json.paging?.is_end ? null : offset + comments.length
  };
  return { comments, paging };
}
__name(getComments, "getComments");
async function getMember(params) {
  if (!params || !params.urlToken) {
    throw new Error("zhihu.getMember: pass { urlToken }");
  }
  const sp = new URLSearchParams({ include: MEMBER_INCLUDE });
  const url = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(params.urlToken)}?${sp}`;
  const r = await fetchJson(url);
  return {
    id: String(r.id ?? ""),
    urlToken: String(r.url_token ?? params.urlToken),
    name: String(r.name ?? ""),
    headline: String(r.headline ?? ""),
    description: stripHtml(r.description ?? ""),
    avatarUrl: String(r.avatar_url ?? ""),
    followerCount: Number(r.follower_count ?? 0),
    followingCount: Number(r.following_count ?? 0),
    answerCount: Number(r.answer_count ?? 0),
    articlesCount: Number(r.articles_count ?? 0),
    questionCount: Number(r.question_count ?? 0),
    voteupCount: Number(r.voteup_count ?? 0),
    url: `https://www.zhihu.com/people/${r.url_token ?? params.urlToken}`
  };
}
__name(getMember, "getMember");

export default defineSkill({
  getAnswer: fn({
    summary: "single answer by id, full content.",
    input: z.any().optional(),
    handler: async (params) => getAnswer(params),
  }),
  getAnswers: fn({
    summary: "paginate ALL answers for a question (server-side sorted).",
    input: z.any().optional(),
    handler: async (params) => getAnswers(params),
  }),
  getArticle: fn({
    summary: "full 专栏 article body — caller must be on zhuanlan.zhihu.com (CORS).",
    input: z.any().optional(),
    handler: async (params) => getArticle(params),
  }),
  getComments: fn({
    summary: "root-level comments on an answer / article / question.",
    input: z.any().optional(),
    handler: async (params) => getComments(params),
  }),
  getHotList: fn({
    summary: "知乎热榜 (front-page hot questions).",
    input: z.any().optional(),
    handler: async (params) => getHotList(params),
  }),
  getMember: fn({
    summary: "user profile by url_token (the slug in /people/{token}).",
    input: z.any().optional(),
    handler: async (params) => getMember(params),
  }),
  getQuestion: fn({
    summary: "full question metadata + top ~5 answers (from SSR'd HTML).",
    input: z.any().optional(),
    handler: async (params) => getQuestion(params),
  }),
  search: fn({
    summary: "★ main entry — universal search across answers/articles/questions/users/topics/columns.",
    input: z.any().optional(),
    handler: async (params) => search(params),
  }),
});

