// ==XGooseSkill==
// @name        xiaohongshu
// @namespace   xhs
// @version     0.3.0
// @description 小红书搜索与排序、笔记正文和图片、评论加载、用户主页；复用网页原生接口，保留当前页面。
// @match       *://www.xiaohongshu.com/*
// @match       *://xiaohongshu.com/*
// @detect      location.hostname.endsWith('xiaohongshu.com')
// @run-at      document_idle
// @connect     <self>
// @connect     edith.xiaohongshu.com
// @connect     so.xiaohongshu.com
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
// Requests reuse the website's own initialized API wrappers and signing interceptors.
// The current document, route and UI stay available throughout a skill call.

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const nativeFunctions = new Map();
const remoteNotes = new Map();
let nativeRequire;
let lastSearch;
function nativeApi(endpoint) {
  if (nativeFunctions.has(endpoint)) return nativeFunctions.get(endpoint);
  if (!nativeRequire) {
    window.webpackChunkxhs_pc_web.push([[`xgoose-xhs-${Date.now()}`], {}, runtime => { nativeRequire = runtime; }]);
  }
  // Resolve by the endpoint used in the site's API wrapper, never a build-specific module ID.
  const marker = endpoint === "/api/sns/web/v2/search/notes" ? "WEB_AI_SEARCH_NOTES_V2" : endpoint;
  const callsEndpoint = source => ["get", "post"].some(method =>
    [JSON.stringify(marker), "'" + marker + "'"].some(literal => source.includes(`.${method}(${literal}`)));
  for (const [id, factory] of Object.entries(nativeRequire.m)) {
    if (!callsEndpoint(Function.prototype.toString.call(factory))) continue;
    const exports = nativeRequire(id);
    const call = Object.values(exports).find(value => typeof value === "function" &&
      callsEndpoint(Function.prototype.toString.call(value)));
    if (call) { nativeFunctions.set(endpoint, call); return call; }
  }
  throw new Error(`xhs: webpage API wrapper not found: ${endpoint}`);
}
function request(endpoint, params = {}, method = "get", timeoutMs = 8000) {
  ensureHost("request");
  const call = nativeApi(endpoint);
  return method === "post" ? call(params, {timeout: timeoutMs}) : call({params, timeout: timeoutMs});
}
function noteIdFromUrl(url) {
  return new URL(url, location.href).pathname.match(/^\/(?:explore|discovery\/item|search_result)\/([^/]+)\/?$/)?.[1];
}
function noteTarget(params = {}) {
  const url = new URL(params.url || location.href);
  const noteId = params.noteId || noteIdFromUrl(url.href) || unwrap(window.__INITIAL_STATE__?.note?.currentNoteId);
  const ownUrl = noteIdFromUrl(url.href) === noteId;
  const cached = remoteNotes.get(noteId);
  return {noteId, xsecToken: params.xsecToken ?? (ownUrl ? url.searchParams.get("xsec_token") : null) ?? cached?.note.xsecToken ?? "",
    xsecSource: params.source ?? (ownUrl ? url.searchParams.get("xsec_source") : null) ?? cached?.source ?? "pc_feed"};
}
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
  return { ...base, url: buildNoteUrl(base.noteId, base.xsecToken, "pc_search"), imageUrls };
}
__name(toSearchHit, "toSearchHit");
async function getCurrentUser() {
  ensureHost("getCurrentUser");
  const d = await request("/api/sns/web/v2/user/me");
  return {
    loggedIn: d?.guest === false,
    userId: String(d.userId ?? d.user_id ?? ""),
    redId: String(d.redId ?? d.red_id ?? ""),
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
  if (!noteState && !remoteNotes.has(params.noteId)) {
    throw new Error("xhs.getCurrentNote: page has no loaded note; use readNote({noteId, xsecToken})");
  }
  const map = unwrap(noteState?.noteDetailMap);
  const currentId = params.noteId ?? noteIdFromUrl(location.href) ?? unwrap(noteState?.currentNoteId);
  if (!currentId || !(remoteNotes.has(currentId) || map?.[currentId])) {
    throw new Error(
      "xhs.getCurrentNote: note is not loaded; use readNote({noteId, xsecToken}) to fetch it in this page."
    );
  }
  const remote = remoteNotes.get(currentId);
  const detail = remote || unwrap(map[currentId]);
  const note = unwrap(detail?.note);
  if (!note) {
    throw new Error(`xhs.getCurrentNote: note ${currentId} missing in noteDetailMap (load failed?)`);
  }
  const pageImages = remote ? [] : [...document.querySelectorAll(".note-container .swiper-slide img, #noteContainer .swiper-slide img")];
  const imgs = (note.imageList ?? []).map((img, index) => {
    const pageImage = pageImages[index];
    const url = bestImageUrl(img.infoList) || String(img.urlDefault ?? img.url ?? img.urlPre ?? pageImage?.currentSrc ?? pageImage?.src ?? "");
    return { image: 0, url, width: Number(img.width ?? 0), height: Number(img.height ?? 0) };
  });
  imgs.forEach((img, i) => img.image = i + 1);
  const token = note.xsecToken || (noteIdFromUrl(location.href) === currentId ? new URL(location.href).searchParams.get("xsec_token") : "") || "";
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
    url: buildNoteUrl(String(note.noteId ?? currentId), String(token), remote?.source ?? "pc_feed"),
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
  const currentId = params.noteId ?? noteIdFromUrl(location.href) ?? (noteState ? unwrap(noteState.currentNoteId) : null);
  const detail = remoteNotes.get(currentId) || unwrap(map?.[currentId]);
  if (!detail) throw new Error("xhs.getNoteComments: note is not loaded; use readNote({noteId, xsecToken}).");
  const cs = unwrap(detail.comments) ?? {};
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
  const notes = unwrap(us.notes);
  const active = unwrap(us.activeTab) ?? {index: 0, query: "note"};
  return profileOutput(upd, notes?.[active.index] ?? [], userIdFromUrl, active.query || "note", location.href);
}
__name(getCurrentUserProfile, "getCurrentUserProfile");
function profileOutput(upd, notes, userId, tab, url) {
  const b = upd.basicInfo;
  const ia = Array.isArray(upd.interactions) ? upd.interactions : [];
  const pick = /* @__PURE__ */ __name((type) => ia.find((x) => x.type === type) ?? null, "pick");
  const follows = pick("follows");
  const fans = pick("fans");
  const inter = pick("interaction");
  return {
    userId: String(b.userId ?? userId),
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
    tab,
    notes: notes.map(item => toFeedCard(item.noteCard ? item : {id: item.noteId, xsecToken: item.xsecToken, noteCard: item})).filter(n => n.noteId),
    url,
    status: "ok"
  };
}
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
function pageError() {
  return document.querySelector('.access-wrapper, .error-wrapper, .not-found-wrapper, .blocked-wrapper')?.innerText?.trim();
}
async function readNote(params = {}) {
  const target = noteTarget(params), id = target.noteId;
  const pageId = noteIdFromUrl(location.href) || unwrap(window.__INITIAL_STATE__?.note?.currentNoteId);
  if (id && id !== pageId) {
    const result = await request("/api/sns/web/v1/feed", {sourceNoteId: id, imageFormats: ["jpg", "webp", "avif"],
      extra: {needBodyTopic: "1"}, xsecToken: target.xsecToken, xsecSource: target.xsecSource}, "post", params.timeoutMs);
    const note = result.items?.find(item => (item.id || item.noteCard?.noteId) === id)?.noteCard;
    if (!note) throw new Error(`xhs.readNote: response did not contain note ${id}`);
    remoteNotes.set(id, {note: {...note, xsecToken: target.xsecToken}, source: target.xsecSource, comments: {list: [], cursor: "", hasMore: true}});
    const comments = await loadRemoteComments({noteId: id, limit: params.commentLimit ?? 10, timeoutMs: params.timeoutMs});
    return {...getCurrentNote({noteId: id}), comments: comments.comments};
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
  const searchId = params.searchId || crypto.randomUUID().replace(/-/g, "");
  const selected = {...defaultFilters, ...Object.fromEntries(Object.keys(defaultFilters).filter(key => params[key] !== undefined).map(key => [key, params[key]]))};
  const result = await request("/api/sns/web/v1/search/filter", {keyword: params.keyword, searchId}, "get", params.timeoutMs);
  const groups = (result.filters ?? []).filter(group => group.groupShowType === 0);
  const filters = groups.map(group => ({type: group.id, tags: [group.filterTags[0].id]}));
  for (const [key, name] of Object.entries(filterGroups)) {
    const index = groups.findIndex(group => group.name === name || group.originText === name);
    const tag = groups[index]?.filterTags.find(tag => tag.name === selected[key] || tag.originText === selected[key]);
    if (!tag) {
      if (selected[key] === defaultFilters[key]) continue;
      throw new Error(`xhs.searchNotes: filter not returned by website: ${name} / ${selected[key]}`);
    }
    filters[index].tags = [tag.id];
  }
  const session = {keyword: params.keyword, searchId, page: 1, hits: [], hasMore: true, filters: selected,
    request: {keyword: params.keyword, pageSize: 20, searchId, sort: "general", noteType: 0, extFlags: [], geo: "", filters, imageFormats: ["jpg", "webp", "avif"]}};
  const offset = params.offset ?? 0, limit = params.limit ?? 20;
  await fetchSearchPages(session, offset + limit, params.timeoutMs);
  lastSearch = session;
  return {...searchOutput(session), hits: session.hits.slice(offset, offset + limit), nextOffset: offset + Math.min(limit, Math.max(0, session.hits.length - offset))};
}
function searchOutput(session) {
  return {status: "ok", url: searchUrl(session), keyword: session.keyword, searchId: session.searchId,
    filters: session.filters, hits: session.hits, hasMore: session.hasMore, loaded: session.hits.length, nextPage: session.page};
}
async function fetchSearchPages(session, limit, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (session.hasMore && session.hits.length < limit && Date.now() < deadline) {
    const result = await request("/api/sns/web/v2/search/notes", {...session.request, page: session.page}, "post", Math.max(1, deadline - Date.now()));
    const hits = (result.items ?? []).filter(item => item.noteCard && item.id).map(toSearchHit);
    const ids = new Set(session.hits.map(hit => hit.noteId));
    session.hits.push(...hits.filter(hit => !ids.has(hit.noteId)));
    session.hasMore = Boolean(result.hasMore); session.page++;
  }
}
async function loadSearchResults(params = {}) {
  if (lastSearch) {
    await fetchSearchPages(lastSearch, params.limit ?? 40, params.timeoutMs);
    return {...searchOutput(lastSearch), hits: lastSearch.hits.slice(0, params.limit ?? 40)};
  }
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
  if (remoteNotes.has(params.noteId)) return loadRemoteComments(params);
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
async function loadRemoteComments(params) {
  const {note, comments} = remoteNotes.get(params.noteId);
  const limit = params.limit ?? 20, deadline = Date.now() + (params.timeoutMs ?? 8000);
  while (comments.hasMore && comments.list.length < limit && Date.now() < deadline) {
    const result = await request("/api/sns/web/v2/comment/page", {noteId: params.noteId, cursor: comments.cursor,
      topCommentId: "", imageFormats: "jpg,webp,avif", xsecToken: note.xsecToken}, "get", Math.max(1, deadline - Date.now()));
    comments.list.push(...(result.comments ?? []));
    comments.hasMore = Boolean(result.hasMore); comments.cursor = result.cursor ?? "";
  }
  if (params.expandReplies) for (const comment of comments.list.slice(0, limit)) {
    while (comment.subCommentHasMore && Date.now() < deadline) {
      const result = await request("/api/sns/web/v2/comment/sub/page", {noteId: params.noteId, rootCommentId: comment.id,
        cursor: comment.subCommentCursor ?? "", num: 10, topCommentId: "", imageFormats: "jpg,webp,avif", xsecToken: note.xsecToken}, "get", Math.max(1, deadline - Date.now()));
      (comment.subComments ??= []).push(...(result.comments ?? []));
      comment.subCommentHasMore = Boolean(result.hasMore); comment.subCommentCursor = result.cursor ?? "";
    }
  }
  return getNoteComments({noteId: params.noteId, limit});
}
async function getUserProfile(params = {}) {
  const url = params.url || (params.userId ? userUrl(params) : location.href);
  const userId = params.userId || new URL(url).pathname.match(/^\/user\/profile\/([^/]+)/)?.[1];
  if (!userId) throw new Error("xhs.getUserProfile: pass userId or a profile URL");
  const tab = params.tab ?? "note";
  const target = new URL(url);
  const query = {userId, xsecToken: params.xsecToken ?? target.searchParams.get("xsec_token") ?? "", xsecSource: target.searchParams.get("xsec_source") ?? "pc_feed"};
  const info = await request("/api/sns/web/v1/user/otherinfo", {targetUserId: userId, xsecToken: query.xsecToken, xsecSource: query.xsecSource}, "get", params.timeoutMs);
  const endpoint = {note: "/api/sns/web/v1/user_posted", fav: "/api/sns/web/v2/note/collect/page", liked: "/api/sns/web/v1/note/like/page"}[tab];
  const notes = await request(endpoint, {...query, num: params.limit ?? 30, cursor: params.cursor ?? "", imageFormats: "jpg,webp,avif"}, "get", params.timeoutMs);
  return {...profileOutput(info, notes.notes ?? [], userId, tab, url), cursor: notes.cursor ?? "", hasMore: Boolean(notes.hasMore)};
}
const empty = z.object({});
const timeout = z.number().int().positive().max(20000).optional();
const noteInput = z.object({noteId: z.string().optional(), url: z.string().optional(), xsecToken: z.string().optional(), source: z.string().optional(), timeoutMs: timeout, commentLimit: z.number().int().positive().optional()});
const searchInput = z.object({keyword: z.string(), searchId: z.string().optional(), sortBy: z.enum(["综合", "最新", "最多点赞", "最多评论", "最多收藏"]).optional(), noteType: z.enum(["不限", "视频", "图文"]).optional(), publishTime: z.enum(["不限", "一天内", "一周内", "半年内"]).optional(), searchScope: z.enum(["不限", "已看过", "未看过", "已关注"]).optional(), distance: z.enum(["不限", "同城", "附近"]).optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional(), timeoutMs: timeout});
const entry = (summary, input, handler, args = {}) => fn({summary, input, handler, examples: [{args}]});
export default defineSkill({
  readNote: entry("读取指定或当前笔记，含正文、图片和首批评论；原生 API 后台请求，当前页面保持不变。", noteInput, readNote),
  getCurrentNote: entry("当前笔记正文、图片与 readImages 提示。", z.object({noteId: z.string().optional()}), getCurrentNote),
  readNoteImages: entry("把所选图片交给扩展后台读图；images 是从 1 开始的编号。", z.object({noteId: z.string().optional(), images: z.array(z.number().int().positive()).optional()}), readNoteImages, {images: [1]}),
  searchNotes: entry("原生 API 关键词搜索与排序筛选，返回 hits、filters、hasMore、searchId；不切换当前页面。", searchInput, searchNotes, {keyword: "重庆旅游", sortBy: "最多收藏"}),
  loadSearchResults: entry("加载上次 searchNotes 的后续结果；未调用搜索时读取并滚动当前搜索页。", z.object({limit: z.number().int().positive().optional(), timeoutMs: timeout}), loadSearchResults, {limit: 40}),
  getCurrentSearch: entry("读取当前搜索页已加载的笔记。", empty, getCurrentSearch),
  getCurrentUser: entry("当前登录用户。", empty, getCurrentUser),
  getUserProfile: entry("后台获取用户资料和 note / fav / liked 列表，不切换当前页面；cursor 分页。", z.object({userId: z.string().optional(), url: z.string().optional(), xsecToken: z.string().optional(), tab: z.enum(["note", "fav", "liked"]).optional(), limit: z.number().int().positive().max(30).optional(), cursor: z.string().optional(), timeoutMs: timeout}), getUserProfile),
  getCurrentUserProfile: entry("当前主页资料和当前 tab 的列表。", empty, getCurrentUserProfile),
  getHomeFeed: entry("首页已加载的推荐笔记，保留完整笔记链接。", empty, getHomeFeed),
  getNoteComments: entry("读取已加载评论；offset 分段、hasMore 表示网页还有未加载评论。", z.object({noteId: z.string().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional()}), getNoteComments),
  loadComments: entry("加载指定数量评论，可展开楼中楼；后台读取的笔记使用 API，当前笔记使用页面已加载状态和滚动。", z.object({noteId: z.string().optional(), limit: z.number().int().positive().optional(), expandReplies: z.boolean().optional(), timeoutMs: timeout}), loadComments, {limit: 20, expandReplies: true}),
  noteUrl: entry("保留 xsecToken 构造笔记链接。", z.object({noteId: z.string(), xsecToken: z.string().optional(), source: z.string().optional()}), noteUrl, {noteId: "笔记ID"}),
  searchUrl: entry("构造关键词搜索引用链接；搜索数据通过 searchNotes 后台获取。", z.object({keyword: z.string()}), searchUrl, {keyword: "重庆旅游"}),
  userUrl: entry("保留 xsecToken 构造用户主页链接。", z.object({userId: z.string(), xsecToken: z.string().optional(), source: z.string().optional()}), userUrl, {userId: "用户ID"}),
}, {instructions: "通过 skill_call 调用。搜索、指定笔记和用户资料通过当前页面的原生 API 获取，不导航、不切换路由；返回的 URL 用于引用。readNote 接受搜索结果的 noteId 和 xsecToken 或完整链接；后续图片、评论调用传同一 noteId。笔记 text 中 [image N] 对应 images 编号，readNoteImages 可调用后台读图。loadSearchResults 延续上次 searchNotes 的分页；getCurrent* 读取当前页面。网站 API 的错误原样返回。"});
