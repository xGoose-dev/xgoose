// ==XGooseSkill==
// @name        xiaohongshu
// @namespace   xhs
// @version     0.2.1
// @description 小红书搜索与排序、笔记正文和图片、评论加载、用户主页；使用当前浏览器页面会话。
// @match       *://www.xiaohongshu.com/*
// @match       *://xiaohongshu.com/*
// @detect      location.hostname.endsWith('xiaohongshu.com')
// @run-at      document_idle
// @connect     <self>
// @connect     edith.xiaohongshu.com
// @primary     readNote
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

// Page-state access follows xpzouying/xiaohongshu-mcp (Apache-2.0):
// https://github.com/xpzouying/xiaohongshu-mcp/tree/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu
// Navigation is returned as a continuation so a full document change cannot lose a skill call.

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const ME_URL = "https://edith.xiaohongshu.com/api/sns/web/v2/user/me";
function unwrap(v) {
  if (v == null) return v;
  if (typeof v !== "object") return v;
  if (v.__v_isRef || "_value" in v) return v.value ?? v._value ?? v._rawValue;
  if ("value" in v && Object.keys(v).length === 1) return v.value;
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
function getCurrentNote(params = {}) {
  ensureHost("getCurrentNote");
  const s = getState();
  const noteState = s?.note;
  if (!noteState) {
    throw new Error("xhs.getCurrentNote: page has no note state \u2014 must be called from /explore/{noteId}");
  }
  const map = unwrap(noteState.noteDetailMap);
  const currentId = params.noteId ?? location.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1] ?? unwrap(noteState.currentNoteId);
  if (!currentId || !map || !map[currentId]) {
    throw new Error(
      "xhs.getCurrentNote: no current note. Navigate the tab to https://www.xiaohongshu.com/explore/{noteId}?xsec_token=... first."
    );
  }
  const detail = unwrap(map[currentId]);
  const note = unwrap(detail?.note);
  if (!note) {
    throw new Error(`xhs.getCurrentNote: note ${currentId} missing in noteDetailMap (load failed?)`);
  }
  const pageImages = [...document.querySelectorAll(".note-container .swiper-slide img, #noteContainer .swiper-slide img")];
  const imgs = (note.imageList ?? []).map((img, index) => {
    const pageImage = pageImages[index];
    const url = bestImageUrl(img.infoList) || String(img.urlDefault ?? img.url ?? img.urlPre ?? pageImage?.currentSrc ?? pageImage?.src ?? "");
    return { image: 0, url, width: Number(img.width ?? 0), height: Number(img.height ?? 0) };
  });
  imgs.forEach((img, i) => img.image = i + 1);
  const token = note.xsecToken || new URL(location.href).searchParams.get("xsec_token") || "";
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
    xsecToken: String(token),
    url: buildNoteUrl(String(note.noteId ?? currentId), String(token)),
    type: String(note.type ?? "normal"),
    title: String(note.title ?? ""),
    desc: String(note.desc ?? ""),
    tags: (note.tagList ?? []).map((t) => String(t.name ?? "")).filter(Boolean),
    text: [note.desc || "", ...imgs.map(img => `[image ${img.image}]`)].join("\n"),
    images: imgs,
    readImages: imgs.length ? `readNoteImages({noteId:"${currentId}",images:[N]})` : undefined,
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
  const currentId = params.noteId ?? location.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1] ?? (noteState ? unwrap(noteState.currentNoteId) : null);
  if (!currentId || !map?.[currentId]) {
    throw new Error("xhs.getNoteComments: no current note. Navigate to /explore/{noteId} first.");
  }
  const cs = unwrap(map[currentId].comments) ?? {};
  const listRaw = unwrap(cs.list);
  const hasMore = !!unwrap(cs.hasMore);
  const cursor = String(unwrap(cs.cursor) ?? "");
  const limit = Math.max(1, params.limit ?? 10);
  const offset = params.offset ?? 0;
  const list = (Array.isArray(listRaw) ? listRaw : []).slice(offset, offset + limit).map((c) => {
    const base = toComment(c);
    const replies = (c.subComments ?? []).map((rc) => toComment(rc));
    return { ...base, replies };
  });
  return { noteId: currentId, comments: list, hasMore, cursor, loaded: listRaw?.length ?? 0, nextOffset: offset + list.length };
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
  const activeTab = unwrap(us.activeTab) ?? {index: 0, query: "note"};
  const activeNotes = Array.isArray(notesObj?.[activeTab.index ?? 0]) ? notesObj[activeTab.index ?? 0] : [];
  const flatNotes = activeNotes.map(toFeedCard);
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
    tab: activeTab.query || "note",
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
function searchUrl(params) {
  return `https://www.xiaohongshu.com/search_result?${new URLSearchParams({keyword: params.keyword, source: "web_explore_feed", type: "51"})}`;
}
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = read();
    if (value) return value;
    await sleep(200);
  } while (Date.now() < deadline);
  return null;
}
function visible(el) { return el.getClientRects().length > 0; }
function navigation(url, fn, args) {
  return {status: "navigation_required", url, next: {skill: "xiaohongshu", function: fn, args}};
}
function pageError() {
  return document.querySelector('.access-wrapper, .error-wrapper, .not-found-wrapper, .blocked-wrapper')?.innerText?.trim();
}
async function readNote(params = {}) {
  const id = params.noteId ?? (params.url ? new URL(params.url).pathname.split('/').pop() : null);
  if (id && !location.pathname.includes(`/${id}`)) {
    return navigation(params.url || noteUrl(params), "readNote", {...params, noteId: id});
  }
  const ready = await waitFor(() => {
    const state = window.__INITIAL_STATE__?.note;
    const current = id || location.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1] || unwrap(state?.currentNoteId);
    return unwrap(unwrap(state?.noteDetailMap)?.[current]?.note) || pageError();
  }, params.timeoutMs);
  if (pageError()) return {status: "unavailable", message: pageError(), url: location.href};
  if (!ready) return {status: "loading", noteId: id, url: location.href};
  return {...getCurrentNote({noteId: id || undefined}), comments: getNoteComments({noteId: id || undefined, limit: params.commentLimit ?? 10}).comments};
}
async function readNoteImages(params = {}) {
  const note = getCurrentNote(params);
  const selected = params.images ?? note.images.map(img => img.image);
  return {imageContext: {requested: true, delivery: "urls_only_until_host_attaches",
    images: selected.map(n => { const img = note.images[n - 1]; return {image: n, url: img.url}; })}};
}
const filterGroups = {sortBy: "排序依据", noteType: "笔记类型", publishTime: "发布时间", searchScope: "搜索范围", distance: "位置距离"};
const defaultFilters = {sortBy: "综合", noteType: "不限", publishTime: "不限", searchScope: "不限", distance: "不限"};
async function searchNotes(params) {
  const keyword = new URL(location.href).searchParams.get("keyword");
  if (location.pathname !== "/search_result" || keyword !== params.keyword) {
    return navigation(searchUrl(params), "searchNotes", params);
  }
  const ready = await waitFor(() => (window.__INITIAL_STATE__ && getCurrentSearch().keyword === params.keyword && unwrap(window.__INITIAL_STATE__?.search?.feeds)?.length) || pageError(), params.timeoutMs);
  if (!ready) return {status: "loading", url: location.href};
  if (pageError()) return {status: "unavailable", message: pageError(), url: location.href};
  const applied = {};
  const deadline = Date.now() + (params.timeoutMs ?? 8000);
  for (const [key, groupName] of Object.entries(filterGroups)) {
    const value = params[key] ?? defaultFilters[key];
    const button = document.querySelector('div.filter');
    if (button) {
      button.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
      button.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    }
    const panel = await waitFor(() => document.querySelector('div.filter-panel'), 1500);
    if (!panel) {
      if (value === defaultFilters[key]) continue;
      throw new Error(`搜索筛选面板未出现：${groupName}`);
    }
    const group = [...panel.querySelectorAll('div.filters')].find(el => el.querySelector(':scope > span')?.textContent.trim() === groupName);
    const option = [...(group?.querySelectorAll('div.tags') ?? [])].find(el => el.textContent.trim() === value && visible(el));
    if (!option) throw new Error(`搜索筛选项未出现：${groupName} / ${value}`);
    const before = getCurrentSearch().hits.map(hit => hit.noteId).join(',');
    const selected = option.classList.contains('active') || option.classList.contains('selected') || option.getAttribute('aria-selected') === 'true';
    if (!selected) {
      option.click();
      const changed = await waitFor(() => {
        const ids = getCurrentSearch().hits.map(hit => hit.noteId).join(',');
        return ids && ids !== before;
      }, Math.max(0, deadline - Date.now()));
      if (!changed) return {...getCurrentSearch(), status: "loading", pendingFilter: {group: groupName, value}};
    }
    applied[key] = value;
  }
  const offset = params.offset ?? 0, limit = params.limit ?? 20;
  await loadSearchResults({limit: offset + limit, timeoutMs: Math.max(0, deadline - Date.now())});
  const result = getCurrentSearch();
  return {...result, filters: applied, hits: result.hits.slice(offset, offset + limit), loaded: result.hits.length, nextOffset: offset + Math.min(limit, Math.max(0, result.hits.length - offset))};
}
async function loadSearchResults(params = {}) {
  const deadline = Date.now() + (params.timeoutMs ?? 8000), limit = params.limit ?? 40;
  let result = getCurrentSearch();
  while (result.hasMore && result.hits.length < limit && Date.now() < deadline) {
    const before = result.hits.map(hit => hit.noteId).join(',');
    const container = document.querySelector('.main-content') || document.scrollingElement;
    container.scrollTop += Math.max(container.clientHeight * .8, 500);
    container.dispatchEvent(new Event('scroll', {bubbles: true}));
    const changed = await waitFor(() => {
      const next = getCurrentSearch();
      return next.hits.map(hit => hit.noteId).join(',') !== before || !next.hasMore;
    }, Math.min(1500, Math.max(0, deadline - Date.now())));
    result = getCurrentSearch();
    if (!changed) break;
  }
  return {...result, hits: result.hits.slice(0, limit), loaded: result.hits.length};
}
async function loadComments(params = {}) {
  const noteId = getCurrentNote(params).noteId;
  const limit = params.limit ?? 20, deadline = Date.now() + (params.timeoutMs ?? 8000);
  let result = getNoteComments({noteId, limit});
  const expanded = new Set();
  while (Date.now() < deadline) {
    if (params.expandReplies) {
      for (const button of document.querySelectorAll('.comments-container .show-more')) {
        if (visible(button) && !expanded.has(button) && /展开.*回复|展开更多回复/.test(button.textContent)) {
          const before = JSON.stringify(getNoteComments({noteId, limit}).comments);
          expanded.add(button); button.click();
          await waitFor(() => JSON.stringify(getNoteComments({noteId, limit}).comments) !== before, Math.min(1500, Math.max(0, deadline - Date.now())));
        }
      }
    }
    if (result.comments.length >= limit || !result.hasMore) break;
    const container = document.querySelector('.note-scroller, .comments-container');
    if (!container) break;
    const before = JSON.stringify(result.comments);
    container.scrollTop += Math.max(container.clientHeight * .8, 500);
    container.dispatchEvent(new Event('scroll', {bubbles: true}));
    await waitFor(() => {
      const next = getNoteComments({noteId, limit});
      return JSON.stringify(next.comments) !== before || !next.hasMore;
    }, Math.min(1500, Math.max(0, deadline - Date.now())));
    result = getNoteComments({noteId, limit});
  }
  return getNoteComments({noteId, limit});
}
async function getUserProfile(params) {
  const url = params.url || userUrl(params);
  const userId = params.userId || new URL(url).pathname.split('/').pop();
  const tab = params.tab ?? "note";
  if (location.pathname !== `/user/profile/${userId}`) return navigation(url, "getUserProfile", {...params, userId});
  const readyProfile = await waitFor(() => {
    const basic = unwrap(window.__INITIAL_STATE__?.user?.userPageData)?.basicInfo;
    return (basic && (!basic.userId || basic.userId === userId)) || pageError();
  }, params.timeoutMs);
  if (!readyProfile) return {status: "loading", userId, tab};
  if (pageError()) return {status: "unavailable", message: pageError(), url: location.href};
  const current = () => unwrap(window.__INITIAL_STATE__?.user?.activeTab) ?? {index: 0, query: "note"};
  if ((current().query || "note") !== tab) {
    const labels = {note: "笔记", fav: "收藏", liked: "点赞"};
    const button = [...document.querySelectorAll('.reds-tab-item.sub-tab-list')].find(el => el.textContent.trim() === labels[tab]);
    if (!button) return {status: "tab_unavailable", userId, tab};
    button.click();
    const ready = await waitFor(() => {
      const active = current(), notes = unwrap(window.__INITIAL_STATE__?.user?.notes);
      return active.query === tab && Array.isArray(notes?.[active.index]);
    }, params.timeoutMs);
    if (!ready) return {status: "loading", userId, tab};
  }
  return getCurrentUserProfile();
}
const empty = z.object({});
const timeout = z.number().int().positive().max(20000).optional();
const noteInput = z.object({noteId: z.string().optional(), url: z.string().optional(), xsecToken: z.string().optional(), timeoutMs: timeout, commentLimit: z.number().int().positive().optional()});
const searchInput = z.object({keyword: z.string(), sortBy: z.enum(["综合", "最新", "最多点赞", "最多评论", "最多收藏"]).optional(), noteType: z.enum(["不限", "视频", "图文"]).optional(), publishTime: z.enum(["不限", "一天内", "一周内", "半年内"]).optional(), searchScope: z.enum(["不限", "已看过", "未看过", "已关注"]).optional(), distance: z.enum(["不限", "同城", "附近"]).optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional(), timeoutMs: timeout});
const entry = (summary, input, handler, args = {}) => fn({summary, input, handler, examples: [{args}]});
export default defineSkill({
  readNote: entry("读取指定或当前笔记，含正文、真实图片地址和首批评论；跨页返回 url 与 next。", noteInput, readNote),
  getCurrentNote: entry("当前笔记正文、图片与 readImages 提示。", z.object({noteId: z.string().optional()}), getCurrentNote),
  readNoteImages: entry("把所选图片交给扩展后台读图；images 是从 1 开始的编号。", z.object({noteId: z.string().optional(), images: z.array(z.number().int().positive()).optional()}), readNoteImages, {images: [1]}),
  searchNotes: entry("关键词搜索并应用页面排序筛选，返回 hits、filters、hasMore。", searchInput, searchNotes, {keyword: "重庆旅游", sortBy: "最多收藏"}),
  loadSearchResults: entry("滚动加载更多搜索结果，保留每条笔记的完整 token 链接。", z.object({limit: z.number().int().positive().optional(), timeoutMs: timeout}), loadSearchResults, {limit: 40}),
  getCurrentSearch: entry("读取当前搜索页已加载的笔记。", empty, getCurrentSearch),
  getCurrentUser: entry("当前登录用户。", empty, getCurrentUser),
  getUserProfile: entry("用户资料和指定 tab 的笔记列表：note / fav / liked。", z.object({userId: z.string().optional(), url: z.string().optional(), xsecToken: z.string().optional(), tab: z.enum(["note", "fav", "liked"]).optional(), timeoutMs: timeout}), getUserProfile),
  getCurrentUserProfile: entry("当前主页资料和当前 tab 的列表。", empty, getCurrentUserProfile),
  getHomeFeed: entry("首页已加载的推荐笔记，保留完整笔记链接。", empty, getHomeFeed),
  getNoteComments: entry("读取已加载评论；offset 分段、hasMore 表示网页还有未加载评论。", z.object({noteId: z.string().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional()}), getNoteComments),
  loadComments: entry("滚动加载指定数量评论，可展开楼中楼；返回实际 loaded 与 hasMore。", z.object({noteId: z.string().optional(), limit: z.number().int().positive().optional(), expandReplies: z.boolean().optional(), timeoutMs: timeout}), loadComments, {limit: 20, expandReplies: true}),
  noteUrl: entry("保留 xsecToken 构造笔记链接。", z.object({noteId: z.string(), xsecToken: z.string().optional(), source: z.string().optional()}), noteUrl, {noteId: "笔记ID"}),
  searchUrl: entry("构造关键词搜索页链接；排序通过 searchNotes 应用页面筛选。", z.object({keyword: z.string()}), searchUrl, {keyword: "重庆旅游"}),
  userUrl: entry("保留 xsecToken 构造用户主页链接。", z.object({userId: z.string(), xsecToken: z.string().optional(), source: z.string().optional()}), userUrl, {userId: "用户ID"}),
}, {instructions: "通过 skill_call 调用。返回 navigation_required 时，在浏览器打开返回的 url，然后执行 next；完整页面导航分两次调用。笔记 text 中 [image N] 对应 images 编号，旁边的 readImages 可调用后台读图。搜索排序通过页面筛选生效，评论通过滚动加载。"});
