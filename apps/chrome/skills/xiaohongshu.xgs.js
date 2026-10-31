// ==XGooseSkill==
// @name        xiaohongshu
// @namespace   xhs
// @version     0.1.1
// @description 小红书 (xiaohongshu.com / RedNote) read-only reader. Pulls home feed / note detail (full body + tags + images + ≤10 root comments + sub-replies) / search results / user profile out of the page's hydrated `__INITIAL_STATE__`. Avoids the signed `/api/sns/web/v1/*` chain entirely (anti-bot `x-s-common` is obfuscated). Reply to the user in Chinese (中文).
// @match       *://www.xiaohongshu.com/*
// @match       *://xiaohongshu.com/*
// @match       *://www.rednote.com/*
// @detect      location.hostname.endsWith('xiaohongshu.com') || location.hostname.endsWith('rednote.com')
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
/** Xiaohongshu epoch milliseconds as ISO time; null when absent. */
function isoTime(ms) {
  const n = Number(ms);
  return n > 0 ? new Date(n).toISOString() : null;
}
__name(isoTime, "isoTime");
/** Drops absent and empty fields; zero counts and explicit false stay. */
function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
}
__name(compact, "compact");
function getState() {
  if (typeof window === "undefined") throw new Error("xhs: no window object");
  const s = window.__INITIAL_STATE__;
  if (!s) throw new Error("xhs: __INITIAL_STATE__ not present \u2014 page may have failed to hydrate (refresh the tab)");
  return s;
}
__name(getState, "getState");
function ensureHost(fn) {
  if (typeof location === "undefined") return;
  if (!/(^|\.)(xiaohongshu|rednote)\.com$/.test(location.hostname)) {
    throw new Error(`xhs.${fn}: must be called from a xiaohongshu.com or rednote.com tab (got ${location.hostname})`);
  }
}
__name(ensureHost, "ensureHost");
/** Page state lists CDN pictures as http://, which an https page may not load. */
function https(url) {
  return String(url ?? "").replace(/^http:\/\//, "https://");
}
__name(https, "https");
function bestImageUrl(infoList) {
  if (!Array.isArray(infoList) || !infoList.length) return "";
  const dft = infoList.find((i) => i?.imageScene === "WB_DFT")?.url;
  if (dft) return https(dft);
  const prv = infoList.find((i) => i?.imageScene === "WB_PRV")?.url;
  return https(prv ?? infoList[0]?.url ?? "");
}
__name(bestImageUrl, "bestImageUrl");
function toAuthor(u) {
  if (!u) return { userId: "", nickname: "" };
  return compact({
    userId: String(u.userId ?? u.user_id ?? u.id ?? ""),
    nickname: String(u.nickname ?? u.nickName ?? u.name ?? ""),
    xsecToken: String(u.xsecToken ?? u.xsec_token ?? "")
  });
}
__name(toAuthor, "toAuthor");
function siteOrigin() {
  return typeof location !== "undefined" && location.hostname.endsWith("rednote.com") ? "https://www.rednote.com" : "https://www.xiaohongshu.com";
}
__name(siteOrigin, "siteOrigin");
function buildNoteUrl(noteId, xsecToken, source = "pc_feed") {
  if (!noteId) return "";
  const qs = new URLSearchParams();
  if (xsecToken) qs.set("xsec_token", xsecToken);
  if (source) qs.set("xsec_source", source);
  return `${siteOrigin()}/explore/${noteId}?${qs.toString()}`;
}
__name(buildNoteUrl, "buildNoteUrl");
function buildUserUrl(userId, xsecToken, source = "pc_feed") {
  if (!userId) return "";
  const qs = new URLSearchParams();
  if (xsecToken) qs.set("xsec_token", xsecToken);
  if (source) qs.set("xsec_source", source);
  return `${siteOrigin()}/user/profile/${userId}?${qs.toString()}`;
}
__name(buildUserUrl, "buildUserUrl");
function toFeedCard(raw) {
  const nc = raw?.noteCard ?? {};
  const interact = nc.interactInfo ?? {};
  const url = buildNoteUrl(raw?.id ?? raw?.noteId ?? "", raw?.xsecToken ?? nc.xsecToken ?? "");
  const modelType = String(raw?.modelType ?? "note");
  return compact({
    noteId: String(raw?.id ?? raw?.noteId ?? nc.noteId ?? ""),
    modelType: modelType !== "note" ? modelType : void 0,
    noteType: String(nc.type ?? "normal"),
    displayTitle: String(nc.displayTitle ?? nc.title ?? ""),
    url,
    likedCount: parseCount(interact.likedCount),
    commentCount: interact.commentCount != null ? parseCount(interact.commentCount) : void 0,
    collectedCount: interact.collectedCount != null ? parseCount(interact.collectedCount) : void 0,
    author: toAuthor(nc.user)
  });
}
__name(toFeedCard, "toFeedCard");
/** Pictures stay on the note: open its url, then readNoteImages. */
function toSearchHit(raw) {
  return compact({ ...toFeedCard(raw), imageCount: (raw?.noteCard?.imageList ?? []).length || void 0 });
}
__name(toSearchHit, "toSearchHit");
async function getCurrentUser() {
  ensureHost("getCurrentUser");
  const user = window.__INITIAL_STATE__?.user, info = unwrap(user?.userInfo);
  if (info && (info.user_id || info.userId || info.guest != null)) {
    return {
      loggedIn: unwrap(user.loggedIn) === true && info.guest !== true,
      userId: String(info.user_id ?? info.userId ?? ""),
      redId: String(info.red_id ?? info.redId ?? ""),
      nickname: String(info.nickname ?? ""),
      description: String(info.desc ?? ""),
      gender: Number(info.gender ?? 0)
    };
  }
  const r = await fetch(ME_URL, { credentials: "include", headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`xhs.getCurrentUser: GET ${ME_URL} \u2192 HTTP ${r.status}`);
  const j = await r.json();
  const d = j?.data ?? {};
  return {
    loggedIn: j?.success === true && d?.guest === false,
    userId: String(d.user_id ?? ""),
    redId: String(d.red_id ?? ""),
    nickname: String(d.nickname ?? ""),
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
function currentNote(fn) {
  ensureHost(fn);
  const s = getState();
  const noteState = s?.note;
  if (!noteState) {
    throw new Error(`xhs.${fn}: page has no note state \u2014 must be called from /explore/{noteId}`);
  }
  const map = unwrap(noteState.noteDetailMap);
  const currentId = unwrap(noteState.currentNoteId);
  if (!currentId || !map || !map[currentId]) {
    throw new Error(
      `xhs.${fn}: no current note. Navigate the tab to https://www.xiaohongshu.com/explore/{noteId}?xsec_token=... first.`
    );
  }
  const detail = map[currentId];
  const note = detail?.note;
  if (!note) {
    throw new Error(`xhs.${fn}: note ${currentId} missing in noteDetailMap (load failed?)`);
  }
  return { note, currentId };
}
__name(currentNote, "currentNote");
function noteImageUrl(img) {
  return bestImageUrl(img?.infoList) || https(img?.urlDefault ?? img?.url ?? "");
}
__name(noteImageUrl, "noteImageUrl");
function getCurrentNote() {
  const { note, currentId } = currentNote("getCurrentNote");
  let video = null;
  if (note.video) {
    const v = note.video;
    const url = v?.media?.stream?.h264?.[0]?.masterUrl ?? v?.media?.stream?.h265?.[0]?.masterUrl ?? v?.media?.stream?.h266?.[0]?.masterUrl ?? v?.media?.stream?.av1?.[0]?.masterUrl ?? "";
    if (url) {
      video = {
        url: https(url),
        width: Number(v.capa?.width ?? 0),
        height: Number(v.capa?.height ?? 0),
        durationSec: Number(v.capa?.duration ?? 0)
      };
    }
  }
  const interact = note.interactInfo ?? {};
  const createdAt = isoTime(note.time), updatedAt = isoTime(note.lastUpdateTime);
  return compact({
    noteId: String(note.noteId ?? currentId),
    xsecToken: String(note.xsecToken ?? ""),
    url: buildNoteUrl(String(note.noteId ?? currentId), String(note.xsecToken ?? "")),
    type: String(note.type ?? "normal"),
    title: String(note.title ?? ""),
    desc: String(note.desc ?? ""),
    tags: (note.tagList ?? []).map((t) => String(t.name ?? "")).filter(Boolean),
    imageCount: (note.imageList ?? []).length || void 0,
    video,
    ipLocation: String(note.ipLocation ?? ""),
    createdAt,
    updatedAt: updatedAt !== createdAt ? updatedAt : null,
    likedCount: parseCount(interact.likedCount),
    commentCount: parseCount(interact.commentCount),
    collectedCount: parseCount(interact.collectedCount),
    sharedCount: parseCount(interact.shareCount ?? interact.sharedCount ?? "0"),
    author: toAuthor(note.user)
  });
}
__name(getCurrentNote, "getCurrentNote");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024, MAX_IMAGE_DATA_CHARS = 500_000;
/** Downscaled JPEG in the image shape hosts attach to the model; the CDN allows page reads. */
async function modelImage(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("Image exceeds 10 MB");
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif|avif|heic)$/.test(blob.type)) throw new Error(`Unsupported image type ${blob.type || "unknown"}`);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 10 MB");
  const bitmap = await createImageBitmap(blob);
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", attempt ? 0.75 : 0.85).split(",")[1];
      if (data.length <= MAX_IMAGE_DATA_CHARS) return { type: "image", mimeType: "image/jpeg", data, width: canvas.width, height: canvas.height };
    }
    throw new Error("Image is too detailed for the model context");
  } finally { bitmap.close(); }
}
__name(modelImage, "modelImage");
async function readNoteImages(params = {}) {
  const { note, currentId } = currentNote("readNoteImages");
  const list = note.imageList ?? [];
  const chosen = params.images ? [...new Set(params.images)] : list.slice(0, 3).map((_, index) => index + 1);
  return {
    noteId: String(note.noteId ?? currentId),
    totalImages: list.length,
    images: await Promise.all(chosen.map(async (number) => {
      const url = noteImageUrl(list[number - 1]);
      if (!url) return { image: number, error: `The note has ${list.length} images.` };
      try { return { image: number, url, ...await modelImage(url) }; }
      catch (failure) { return { image: number, url, error: String(failure?.message ?? failure) }; }
    }))
  };
}
__name(readNoteImages, "readNoteImages");
function toComment(c) {
  return compact({
    id: String(c.id ?? ""),
    content: String(c.content ?? ""),
    ipLocation: String(c.ipLocation ?? ""),
    createdAt: isoTime(c.createTime),
    likeCount: parseCount(c.likeCount),
    subCommentCount: parseCount(c.subCommentCount ?? c.subCommentsCount ?? "0") || void 0,
    isAuthor: c.atUserAuthor || c.isAuthor ? true : void 0,
    author: compact({ ...toAuthor(c.userInfo), xsecToken: void 0 })
  });
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
    return compact({ ...base, replies });
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
    gender: Number(b.gender ?? 0),
    ipLocation: String(b.ipLocation ?? ""),
    followsCount: parseCount(follows?.count),
    fansCount: parseCount(fans?.count),
    interactionCount: parseCount(inter?.count),
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
    gender: 0,
    ipLocation: "",
    followsCount: 0,
    fansCount: 0,
    interactionCount: 0,
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
  return `${siteOrigin()}/search_result?${qs.toString()}`;
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
    summary: "full body + tags + imageCount + counts from /explore/{noteId}. readNoteImages shows the pictures.",
    input: z.any().optional(),
    handler: async (params) => getCurrentNote(params),
  }),
  readNoteImages: fn({
    summary: "attach up to three pictures of the open note so you can see them; getCurrentNote reports imageCount.",
    input: z.object({
      images: z.array(z.number().int().min(1)).min(1).max(3).optional().describe("1-based picture numbers. Default: the first three.")
    }).strict().optional(),
    examples: [{ args: { images: [1, 2] } }],
    handler: async (params) => readNoteImages(params ?? {}),
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
    summary: "build /explore/{id}?xsec_token=... URL (cards and hits already carry url).",
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

