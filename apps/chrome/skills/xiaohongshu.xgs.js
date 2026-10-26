// ==XGooseSkill==
// @name        xiaohongshu
// @namespace   xhs
// @version     0.1.0
// @description 小红书 (xiaohongshu.com / RedNote) read-only reader. Pulls home feed / note detail (full body + tags + images + ≤10 root comments + sub-replies) / search results / user profile out of the page's hydrated `__INITIAL_STATE__`. Avoids the signed `/api/sns/web/v1/*` chain entirely (anti-bot `x-s-common` is obfuscated). Reply to the user in Chinese (中文).
// @match       *://www.xiaohongshu.com/*
// @match       *://xiaohongshu.com/*
// @detect      location.hostname.endsWith('xiaohongshu.com')
// @run-at      document_idle
// @connect     <self>
// @connect     edith.xiaohongshu.com
// @primary     getCurrentUser
// @keyword     xiaohongshu
// @keyword     小红书
// @keyword     RedNote
// @keyword     Red
// @keyword     小红薯
// @keyword     种草
// @keyword     笔记
// @keyword     图文
// @keyword     feed
// @keyword     xsec_token
// ==/XGooseSkill==

/**
 * 小红书 (xiaohongshu.com / RedNote) read-only reader. Pulls home feed / note detail (full body + tags + images + ≤10 root comments + sub-replies) / search results / user profile out of the page's hydrated `__INITIAL_STATE__`. Avoids the signed `/api/sns/web/v1/*` chain entirely (anti-bot `x-s-common` is obfuscated). Reply to the user in Chinese (中文).
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # 小红书 (Xiaohongshu / RedNote) — Schema Reference
 * > **Read this BEFORE calling any function.** The skill activates on `*.xiaohongshu.com`. It is **read-only and page-state driven**: every entrypoint either reads from `window.__INITIAL_STATE__` of the currently-loaded page, or — for the single login probe — hits `edith.xiaohongshu.com/api/sns/web/v2/user/me`, the one canonical endpoint that 200s without xhs's signed-header chain. **Do not** try to call `/api/sns/web/v1/homefeed`, `/api/sns/web/v1/search/notes`, `/api/sns/web/v1/feed` or anything else from the `signIncludesUrl` list — they 403 with `code: 300011 "Account abnormal"` unless you reproduce both `x-s` (which `window._webmsxyw` produces) **and** `x-s-common` (the device-fingerprint signature, buried inside an obfuscated webpack module and not safe to re-implement). The page itself does the signing; we ride along on the data it already paints.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const ME_URL = "https://edith.xiaohongshu.com/api/sns/web/v2/user/me";
function unwrap(v) {
  if (v == null) return v;
  if (typeof v !== "object") return v;
  if ("_value" in v && "_rawValue" in v) {
    return v._value ?? v._rawValue;
  }
  return v;
}
__name(unwrap, "unwrap");
function parseCount(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  const plain = Number(str.replace(/[\s,]/g, ""));
  if (Number.isFinite(plain) && /^[\d,]+$/.test(str.replace(/\s/g, ""))) return plain;
  const m = str.match(/^([\d.]+)\s*([万亿KkMm])?/);
  if (!m) return 0;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  const unit = m[2];
  if (unit === "\u4E07") return Math.round(base * 1e4);
  if (unit === "\u4EBF") return Math.round(base * 1e8);
  if (unit === "K" || unit === "k") return Math.round(base * 1e3);
  if (unit === "M" || unit === "m") return Math.round(base * 1e6);
  return Math.round(base);
}
__name(parseCount, "parseCount");
function getState() {
  if (typeof window === "undefined") throw new Error("xhs: no window object");
  const s = window.__INITIAL_STATE__;
  if (!s) throw new Error("xhs: __INITIAL_STATE__ not present \u2014 page may have failed to hydrate (refresh the tab)");
  return s;
}
__name(getState, "getState");
function ensureHost(fn) {
  if (typeof location === "undefined") return;
  if (!/(^|\.)xiaohongshu\.com$/.test(location.hostname)) {
    throw new Error(`xhs.${fn}: must be called from a xiaohongshu.com tab (got ${location.hostname})`);
  }
}
__name(ensureHost, "ensureHost");
function bestImageUrl(infoList) {
  if (!Array.isArray(infoList) || !infoList.length) return "";
  const dft = infoList.find((i) => i?.imageScene === "WB_DFT")?.url;
  if (dft) return String(dft);
  const prv = infoList.find((i) => i?.imageScene === "WB_PRV")?.url;
  return String(prv ?? infoList[0]?.url ?? "");
}
__name(bestImageUrl, "bestImageUrl");
function toAuthor(u) {
  if (!u) return { userId: "", nickname: "", xsecToken: "" };
  return {
    userId: String(u.userId ?? u.user_id ?? u.id ?? ""),
    nickname: String(u.nickname ?? u.nickName ?? u.name ?? ""),
    avatarUrl: u.avatar ?? u.image ?? u.images ?? void 0,
    xsecToken: String(u.xsecToken ?? u.xsec_token ?? "")
  };
}
__name(toAuthor, "toAuthor");
function buildNoteUrl(noteId, xsecToken, source = "pc_feed") {
  if (!noteId) return "";
  const qs = new URLSearchParams();
  if (xsecToken) qs.set("xsec_token", xsecToken);
  if (source) qs.set("xsec_source", source);
  return `https://www.xiaohongshu.com/explore/${noteId}?${qs.toString()}`;
}
__name(buildNoteUrl, "buildNoteUrl");
function buildUserUrl(userId, xsecToken, source = "pc_feed") {
  if (!userId) return "";
  const qs = new URLSearchParams();
  if (xsecToken) qs.set("xsec_token", xsecToken);
  if (source) qs.set("xsec_source", source);
  return `https://www.xiaohongshu.com/user/profile/${userId}?${qs.toString()}`;
}
__name(buildUserUrl, "buildUserUrl");
function toFeedCard(raw) {
  const nc = raw?.noteCard ?? {};
  const interact = nc.interactInfo ?? {};
  const cover = nc.cover ?? {};
  const url = buildNoteUrl(raw?.id ?? raw?.noteId ?? "", raw?.xsecToken ?? nc.xsecToken ?? "");
  const coverUrl = String(cover.urlDefault || cover.url || bestImageUrl(cover.infoList) || cover.urlPre || "");
  return {
    noteId: String(raw?.id ?? raw?.noteId ?? nc.noteId ?? ""),
    xsecToken: String(raw?.xsecToken ?? nc.xsecToken ?? ""),
    modelType: String(raw?.modelType ?? "note"),
    noteType: String(nc.type ?? "normal"),
    displayTitle: String(nc.displayTitle ?? nc.title ?? ""),
    url,
    coverUrl,
    coverWidth: Number(cover.width ?? 0),
    coverHeight: Number(cover.height ?? 0),
    likedCount: parseCount(interact.likedCount),
    likedCountText: String(interact.likedCount ?? "0"),
    commentCount: interact.commentCount != null ? parseCount(interact.commentCount) : void 0,
    collectedCount: interact.collectedCount != null ? parseCount(interact.collectedCount) : void 0,
    liked: !!interact.liked,
    author: toAuthor(nc.user)
  };
}
__name(toFeedCard, "toFeedCard");
function toSearchHit(raw) {
  const base = toFeedCard(raw);
  const nc = raw?.noteCard ?? {};
  const imageUrls = [];
  for (const img of nc.imageList ?? []) {
    const u = bestImageUrl(img?.infoList);
    if (u) imageUrls.push(u);
  }
  if (!imageUrls.length && base.coverUrl) imageUrls.push(base.coverUrl);
  return { ...base, imageUrls };
}
__name(toSearchHit, "toSearchHit");
async function getCurrentUser() {
  ensureHost("getCurrentUser");
  const r = await fetch(ME_URL, { credentials: "include", headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`xhs.getCurrentUser: GET ${ME_URL} \u2192 HTTP ${r.status}`);
  const j = await r.json();
  const d = j?.data ?? {};
  return {
    loggedIn: j?.success === true && d?.guest === false,
    userId: String(d.user_id ?? ""),
    redId: String(d.red_id ?? ""),
    nickname: String(d.nickname ?? ""),
    avatarUrl: String(d.imageb ?? d.images ?? ""),
    description: String(d.desc ?? ""),
    gender: Number(d.gender ?? 0)
  };
}
__name(getCurrentUser, "getCurrentUser");
function getHomeFeed() {
  ensureHost("getHomeFeed");
  const s = getState();
  const feed = s?.feed;
  if (!feed) {
    return { url: location.href, channelId: "", feeds: [], status: "no_state" };
  }
  if (!/^\/(explore|board|home|$)/.test(location.pathname)) {
    return { url: location.href, channelId: "", feeds: [], status: "not_explore_page" };
  }
  const arr = unwrap(feed.feeds);
  const channelId = String(unwrap(feed.currentChannel) ?? unwrap(feed.feedCategory) ?? "homefeed_recommend");
  const feeds = Array.isArray(arr) ? arr.map(toFeedCard).filter((c) => c.noteId) : [];
  return { url: location.href, channelId, feeds, status: "ok" };
}
__name(getHomeFeed, "getHomeFeed");
function getCurrentNote() {
  ensureHost("getCurrentNote");
  const s = getState();
  const noteState = s?.note;
  if (!noteState) {
    throw new Error("xhs.getCurrentNote: page has no note state \u2014 must be called from /explore/{noteId}");
  }
  const map = unwrap(noteState.noteDetailMap);
  const currentId = unwrap(noteState.currentNoteId);
  if (!currentId || !map || !map[currentId]) {
    throw new Error(
      "xhs.getCurrentNote: no current note. Navigate the tab to https://www.xiaohongshu.com/explore/{noteId}?xsec_token=... first."
    );
  }
  const detail = map[currentId];
  const note = detail?.note;
  if (!note) {
    throw new Error(`xhs.getCurrentNote: note ${currentId} missing in noteDetailMap (load failed?)`);
  }
  const imgs = (note.imageList ?? []).map((img) => {
    const url = bestImageUrl(img.infoList) || String(img.urlDefault ?? img.url ?? "");
    return { url, width: Number(img.width ?? 0), height: Number(img.height ?? 0) };
  });
  let video = null;
  if (note.video) {
    const v = note.video;
    const url = v?.media?.stream?.h264?.[0]?.masterUrl ?? v?.media?.stream?.h265?.[0]?.masterUrl ?? v?.media?.stream?.h266?.[0]?.masterUrl ?? v?.media?.stream?.av1?.[0]?.masterUrl ?? "";
    if (url) {
      video = {
        url: String(url),
        width: Number(v.capa?.width ?? 0),
        height: Number(v.capa?.height ?? 0),
        durationSec: Number(v.capa?.duration ?? 0)
      };
    }
  }
  const interact = note.interactInfo ?? {};
  return {
    noteId: String(note.noteId ?? currentId),
    xsecToken: String(note.xsecToken ?? ""),
    url: buildNoteUrl(String(note.noteId ?? currentId), String(note.xsecToken ?? "")),
    type: String(note.type ?? "normal"),
    title: String(note.title ?? ""),
    desc: String(note.desc ?? ""),
    tags: (note.tagList ?? []).map((t) => String(t.name ?? "")).filter(Boolean),
    images: imgs,
    video,
    ipLocation: String(note.ipLocation ?? ""),
    createdAt: Number(note.time ?? 0),
    updatedAt: Number(note.lastUpdateTime ?? note.time ?? 0),
    likedCount: parseCount(interact.likedCount),
    likedCountText: String(interact.likedCount ?? "0"),
    commentCount: parseCount(interact.commentCount),
    collectedCount: parseCount(interact.collectedCount),
    sharedCount: parseCount(interact.shareCount ?? interact.sharedCount ?? "0"),
    liked: !!interact.liked,
    collected: !!interact.collected,
    followed: !!interact.followed,
    author: toAuthor(note.user)
  };
}
__name(getCurrentNote, "getCurrentNote");
function toComment(c) {
  return {
    id: String(c.id ?? ""),
    content: String(c.content ?? ""),
    ipLocation: String(c.ipLocation ?? ""),
    createdAt: Number(c.createTime ?? 0),
    likeCount: parseCount(c.likeCount),
    likeCountText: String(c.likeCount ?? "0"),
    subCommentCount: parseCount(c.subCommentCount ?? c.subCommentsCount ?? "0"),
    liked: !!c.liked,
    isAuthor: !!c.atUserAuthor || !!c.isAuthor,
    author: toAuthor(c.userInfo)
  };
}
__name(toComment, "toComment");
function getNoteComments(params = {}) {
  ensureHost("getNoteComments");
  const s = getState();
  const noteState = s?.note;
  const map = noteState ? unwrap(noteState.noteDetailMap) : null;
  const currentId = noteState ? unwrap(noteState.currentNoteId) : null;
  if (!currentId || !map?.[currentId]) {
    throw new Error("xhs.getNoteComments: no current note. Navigate to /explore/{noteId} first.");
  }
  const cs = map[currentId].comments ?? {};
  const listRaw = unwrap(cs.list);
  const hasMore = !!unwrap(cs.hasMore);
  const cursor = String(unwrap(cs.cursor) ?? "");
  const limit = Math.max(1, params.limit ?? 10);
  const list = (Array.isArray(listRaw) ? listRaw : []).slice(0, limit).map((c) => {
    const base = toComment(c);
    const replies = (c.subComments ?? []).map((rc) => toComment(rc));
    return { ...base, replies };
  });
  return { comments: list, hasMore, cursor };
}
__name(getNoteComments, "getNoteComments");
function getCurrentSearch() {
  ensureHost("getCurrentSearch");
  const s = getState();
  const sr = s?.search;
  if (!sr) {
    return { url: location.href, keyword: "", hits: [], hasMore: false, status: "no_state" };
  }
  if (!/^\/search_result/.test(location.pathname)) {
    return { url: location.href, keyword: "", hits: [], hasMore: false, status: "not_search_page" };
  }
  const keyword = String(
    unwrap(sr.searchValue) ?? unwrap(sr.searchContext?.keyword) ?? new URLSearchParams(location.search).get("keyword") ?? ""
  );
  const feeds = unwrap(sr.feeds);
  const hasMore = !!unwrap(sr.hasMore);
  const hits = Array.isArray(feeds) ? feeds.map(toSearchHit).filter((h) => h.noteId) : [];
  return { url: location.href, keyword, hits, hasMore, status: "ok" };
}
__name(getCurrentSearch, "getCurrentSearch");
function getCurrentUserProfile() {
  ensureHost("getCurrentUserProfile");
  const s = getState();
  const us = s?.user;
  if (!us) {
    return blankProfile("no_state");
  }
  if (!/^\/user\/profile\//.test(location.pathname)) {
    return blankProfile("not_profile_page");
  }
  const userIdFromUrl = location.pathname.match(/^\/user\/profile\/([^\/?#]+)/)?.[1] ?? "";
  const upd = unwrap(us.userPageData);
  if (!upd?.basicInfo) {
    return blankProfile("no_state");
  }
  const b = upd.basicInfo;
  const ia = Array.isArray(upd.interactions) ? upd.interactions : [];
  const pick = /* @__PURE__ */ __name((type) => ia.find((x) => x.type === type) ?? null, "pick");
  const follows = pick("follows");
  const fans = pick("fans");
  const inter = pick("interaction");
  const notesObj = unwrap(us.notes);
  const allColumns = notesObj && typeof notesObj === "object" ? Object.values(notesObj) : [];
  const flatNotes = [];
  for (const col of allColumns) {
    if (Array.isArray(col)) for (const n of col) flatNotes.push(toFeedCard(n));
  }
  flatNotes.sort((a, b2) => 0);
  return {
    userId: String(b.userId ?? userIdFromUrl),
    redId: String(b.redId ?? ""),
    nickname: String(b.nickname ?? ""),
    description: String(b.desc ?? ""),
    avatarUrl: String(b.imageb ?? b.images ?? ""),
    gender: Number(b.gender ?? 0),
    ipLocation: String(b.ipLocation ?? ""),
    followsCount: parseCount(follows?.count),
    fansCount: parseCount(fans?.count),
    interactionCount: parseCount(inter?.count),
    followsCountText: String(follows?.i18nCount ?? follows?.count ?? "0"),
    fansCountText: String(fans?.i18nCount ?? fans?.count ?? "0"),
    interactionCountText: String(inter?.i18nCount ?? inter?.count ?? "0"),
    tags: (upd.tags ?? []).map((t) => ({ name: String(t.name ?? ""), tagType: String(t.tagType ?? "") })),
    notes: flatNotes.filter((n) => n.noteId),
    url: location.href,
    status: "ok"
  };
}
__name(getCurrentUserProfile, "getCurrentUserProfile");
function blankProfile(status) {
  return {
    userId: "",
    redId: "",
    nickname: "",
    description: "",
    avatarUrl: "",
    gender: 0,
    ipLocation: "",
    followsCount: 0,
    fansCount: 0,
    interactionCount: 0,
    followsCountText: "0",
    fansCountText: "0",
    interactionCountText: "0",
    tags: [],
    notes: [],
    url: typeof location !== "undefined" ? location.href : "",
    status
  };
}
__name(blankProfile, "blankProfile");
const SORT_BY_MAP = {
  general: "general",
  time_descending: "time_descending",
  popularity_descending: "popularity_descending"
};
const NOTE_TYPE_MAP = {
  all: "0",
  video: "1",
  image: "2"
};
const PUBLISH_TIME_MAP = {
  all: "all",
  one_day: "one_day",
  one_week: "one_week",
  half_year: "half_year"
};
function searchUrl(params) {
  if (!params || !params.keyword) throw new Error("xhs.searchUrl: pass { keyword, sortBy?, noteType?, publishTime? }");
  const qs = new URLSearchParams({
    keyword: params.keyword,
    source: "web_explore_feed",
    type: "51"
    // 'note' results — the most useful default
  });
  if (params.sortBy && params.sortBy !== "general") qs.set("sort_type_choice", SORT_BY_MAP[params.sortBy]);
  if (params.noteType && params.noteType !== "all") qs.set("filter_note_type", NOTE_TYPE_MAP[params.noteType]);
  if (params.publishTime && params.publishTime !== "all") qs.set("filter_pub_time", PUBLISH_TIME_MAP[params.publishTime]);
  return `https://www.xiaohongshu.com/search_result?${qs.toString()}`;
}
__name(searchUrl, "searchUrl");
function noteUrl(params) {
  if (!params || !params.noteId) throw new Error("xhs.noteUrl: pass { noteId, xsecToken, source? }");
  return buildNoteUrl(params.noteId, params.xsecToken ?? "", params.source ?? "pc_feed");
}
__name(noteUrl, "noteUrl");
function userUrl(params) {
  if (!params || !params.userId) throw new Error("xhs.userUrl: pass { userId, xsecToken, source? }");
  return buildUserUrl(params.userId, params.xsecToken ?? "", params.source ?? "pc_feed");
}
__name(userUrl, "userUrl");

export default defineSkill({
  getCurrentNote: fn({
    summary: "full body + images + tags + interactInfo from /explore/{noteId}.",
    input: z.any().optional(),
    handler: async (params) => getCurrentNote(params),
  }),
  getCurrentSearch: fn({
    summary: "search results from /search_result?keyword=X (≤42 hits).",
    input: z.any().optional(),
    handler: async (params) => getCurrentSearch(params),
  }),
  getCurrentUser: fn({
    summary: "★ login probe (anonymous-OK, returns {loggedIn,...}).",
    input: z.any().optional(),
    handler: async (params) => getCurrentUser(params),
  }),
  getCurrentUserProfile: fn({
    summary: "profile basics + flattened note list from /user/profile/{id}.",
    input: z.any().optional(),
    handler: async (params) => getCurrentUserProfile(params),
  }),
  getHomeFeed: fn({
    summary: "★ main entry — home feed from /explore (≤51 cards).",
    input: z.any().optional(),
    handler: async (params) => getHomeFeed(params),
  }),
  getNoteComments: fn({
    summary: "root comments inlined on the note page (≤10 by default).",
    input: z.any().optional(),
    handler: async (params) => getNoteComments(params),
  }),
  noteUrl: fn({
    summary: "build /explore/{id}?xsec_token=... URL.",
    input: z.any().optional(),
    handler: async (params) => noteUrl(params),
  }),
  searchUrl: fn({
    summary: "build a navigable /search_result URL (keyword + filters).",
    input: z.any().optional(),
    handler: async (params) => searchUrl(params),
  }),
  userUrl: fn({
    summary: "build /user/profile/{id}?xsec_token=... URL.",
    input: z.any().optional(),
    handler: async (params) => userUrl(params),
  }),
});

