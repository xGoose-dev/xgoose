// ==XGooseSkill==
// @name        weibo
// @namespace   weibo
// @version      0.2.5
// @description 微博同域 JSON reader — search posts directly on weibo.com without navigation, user search suggestions, hot search, timelines, full status text, comments, reposts and profiles. s.weibo.com also supports its native search-page adapter. Reply in Chinese (中文).
// @match       *://weibo.com/*
// @match       *://*.weibo.com/*
// @detect      location.hostname.endsWith('weibo.com')
// @run-at      document_idle
// @connect     <self>
// @primary     getHotSearch
// @keyword     weibo
// @keyword     微博
// @keyword     热搜
// @keyword     热门微博
// @keyword     Sina Weibo
// @keyword     Chinese Twitter
// @keyword     中国微博
// @keyword     新浪
// @keyword     mblog
// @keyword     mblogid
// @keyword     热搜榜
// @keyword     转发
// @keyword     评论
// @action       概括这条微博 | 使用 weibo.getStatus 读取当前微博及长正文，再用 getComments 读取相关评论。优先从当前 URL 确定微博 ID；按 nextOffset 和评论游标续读，区分作者内容与评论观点并附链接。如果当前不是微博详情页，提示先打开一条微博。
// @action       热门微博 | 使用 weibo.getHotTimeline 获取热门微博，选择值得关注的内容并附原微博链接；必要时用 getStatus 核实长正文。不要把热搜词当作微博正文。
// @action       最新微博 | 使用 weibo skill 读取最新微博：在用户主页用 getUserStatuses 的第一页，在首页用 getFriendsTimeline 的最新关注流。说明当前范围和时间，附原文链接；登录或访问受限就明确说明，不要用热榜冒充最新。
// @action       随便看看 | 使用 weibo.getHotSearch 或 getHotTimeline 发现一个有趣话题，自行选取一个相关原微博并用 getStatus 及必要的评论核实。分享有意思的内容和来源，不要把热搜词本身当作已核实事实。
// ==/XGooseSkill==

/**
 * 微博 (weibo.com) reader — hot search, hot/friends timeline, status detail (with full long-text), comments, reposts, user profile, user statuses, plus s.weibo.com search. Pure JSON `/ajax/*` + HTML SSR parsing. No DOM scraping on the main feed, no clicks. Reply to the user in Chinese (中文).
 *
 * Read-only website adapters. Concrete schemas describe the selectable API
 * parameters; the browser's existing session determines access.
 * # 微博 (Weibo) — Schema Reference
 * Searches run directly on weibo.com via /ajax/statuses/search (atten=0).
 * s.weibo.com retains its same-origin SSR adapter for existing search tabs.
 * Login and access restrictions are determined by Weibo, not this skill.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
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
    String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(stripHtml, "stripHtml");
const pageCache=new Map();
async function fetchJson(url, snapshot=false) {
  const cached=pageCache.get(url);
  if(snapshot && cached?.until>Date.now())return structuredClone(cached.value);
  const r = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-cache",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`weibo: GET ${url} \u2192 HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    const body = await r.text().catch(() => "");
    throw new Error(`weibo: GET ${url} \u2192 expected JSON, got ${ct}: ${body.slice(0, 200)}`);
  }
  const data=await r.json();
  if(data.error || data.ok===0)throw new Error(`weibo: ${data.msg || data.error || 'API rejected this read'}`);
  if(snapshot){if(pageCache.size>=20)pageCache.delete(pageCache.keys().next().value);pageCache.set(url,{until:Date.now()+30000,value:data});}
  return data;
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
    throw new Error(`weibo: GET ${url} \u2192 HTTP ${r.status}`);
  }
  return await r.text();
}
__name(fetchHtml, "fetchHtml");
/** Weibo's `Tue Oct 27 09:00:00 +0800 2026` (or epoch seconds) as ISO time; null when absent. */
function isoTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const t = typeof value === "number" ? value * 1e3 : Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
__name(isoTime, "isoTime");
/** Drops absent and empty fields; zero counts and explicit false stay. */
function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
}
__name(compact, "compact");
function statusUrl(uid, mblogid) {
  return `https://weibo.com/${uid}/${mblogid}`;
}
__name(statusUrl, "statusUrl");
function profileUrl(uid) {
  return `https://weibo.com/u/${uid}`;
}
__name(profileUrl, "profileUrl");
function toAuthor(u) {
  if (!u) return { id: "", screenName: "" };
  const id = String(u.id ?? u.idstr ?? "");
  return compact({
    id,
    screenName: String(u.screen_name ?? u.name ?? ""),
    profileUrl: id ? profileUrl(id) : "",
    verified: u.verified ? true : void 0,
    verifiedReason: u.verified_reason ? String(u.verified_reason) : void 0
  });
}
__name(toAuthor, "toAuthor");
/** Picture renditions in reading order; the 1080px `original` is enough for the model and a fraction of mw2000's bytes. */
function statusPics(raw) {
  const ids = Array.isArray(raw?.pic_ids) ? raw.pic_ids : [];
  return ids.map((id) => raw?.pic_infos?.[id]).filter(Boolean).map((info) =>
    [...new Set([info.original, info.large, info.mw2000, info.largest].map((r) => r?.url).filter(Boolean))]
  ).filter((sources) => sources.length);
}
__name(statusPics, "statusPics");
function toRetweeted(r) {
  if (!r) return null;
  const uid = String(r.user?.id ?? r.user?.idstr ?? "");
  const mblogid = String(r.mblogid ?? "");
  return compact({
    id: String(r.idstr ?? r.id ?? ""),
    mblogid,
    url: uid && mblogid ? statusUrl(uid, mblogid) : "",
    text: stripHtml(r.text ?? r.text_raw ?? ""),
    isLongText: r.isLongText ? true : void 0,
    picNum: Number(r.pic_num ?? 0) || void 0,
    author: r.user ? toAuthor(r.user) : null,
    // retweeted_status with no user means original was deleted
    deleted: r.user ? void 0 : true
  });
}
__name(toRetweeted, "toRetweeted");
function toStatusSummary(raw) {
  const uid = String(raw.user?.id ?? raw.user?.idstr ?? "");
  const mblogid = String(raw.mblogid ?? "");
  return compact({
    id: String(raw.idstr ?? raw.id ?? ""),
    mblogid,
    url: uid && mblogid ? statusUrl(uid, mblogid) : "",
    createdAt: isoTime(raw.created_at),
    text: stripHtml(raw.text ?? raw.text_raw ?? ""),
    isLongText: raw.isLongText ? true : void 0,
    source: stripHtml(raw.source ?? ""),
    regionName: String(raw.region_name ?? "").replace(/^发布于\s*/, ""),
    repostsCount: Number(raw.reposts_count ?? 0),
    commentsCount: Number(raw.comments_count ?? 0),
    attitudesCount: Number(raw.attitudes_count ?? 0),
    picNum: Math.max(Number(raw.pic_num ?? 0), statusPics(raw).length) || void 0,
    author: toAuthor(raw.user),
    retweeted: toRetweeted(raw.retweeted_status)
  });
}
__name(toStatusSummary, "toStatusSummary");
function toStatusFull(raw) {
  const base = toStatusSummary(raw);
  const topics = (raw.topic_struct ?? []).map((t) => String(t?.topic_title ?? "").trim()).filter(Boolean);
  const full=raw.longText?.longTextContent ?? raw.longText?.content ?? raw.longTextContent;
  const longText=full ? stripHtml(full) : null;
  return compact({
    ...base,
    ...(longText ? {text:longText} : {}),
    textComplete:!raw.isLongText || !!longText,
    topics
  });
}
__name(toStatusFull, "toStatusFull");
function resolveStatusId(p, fn) {
  const id = p.mblogid ?? (p.id != null ? String(p.id) : "");
  if (!id) throw new Error(`weibo.${fn}: pass { mblogid } (preferred, base62) or { id } (numeric mid)`);
  return String(id);
}
__name(resolveStatusId, "resolveStatusId");
function ensureWeiboHost(fn) {
  if (typeof location === "undefined") return;
  const h = location.hostname;
  if (h === "weibo.com" || h === "www.weibo.com") return;
  throw new Error(
    `weibo.${fn}: this JSON read requires a weibo.com page; current host is ${h}. Do not navigate or replace the user's current page automatically.`
  );
}
__name(ensureWeiboHost, "ensureWeiboHost");
function ensureSearchHost(fn) {
  if (typeof location === "undefined") return;
  if (location.hostname !== "s.weibo.com") {
    throw new Error(
      `weibo.${fn}: the SSR adapter requires s.weibo.com. On weibo.com use the built-in same-origin JSON search. Do not navigate the current tab automatically.`
    );
  }
}
__name(ensureSearchHost, "ensureSearchHost");
async function getHotSearch(params = {}) {
  ensureWeiboHost("getHotSearch");
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const json = await fetchJson("https://weibo.com/ajax/statuses/hot_band");
  const list = json?.data?.band_list ?? [];
  const out = [];
  for (const row of list.slice(0, limit)) {
    if (!row) continue;
    const word = String(row.word ?? row.note ?? "");
    if (!word) continue;
    const wordScheme = String(row.word_scheme ?? word);
    const queryWord = row.topic_flag === 1 ? wordScheme : word;
    out.push({
      rank: Number(row.realpos ?? out.length + 1),
      word,
      wordScheme: wordScheme !== word && wordScheme !== `#${word}#` ? wordScheme : void 0,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(queryWord)}`,
      heat: Number(row.num ?? row.raw_hot ?? 0),
      isTopic: row.topic_flag === 1,
      category: row.category ? String(row.category) : void 0,
      labelName: row.label_name ? String(row.label_name) : void 0,
      fieldTag: row.field_tag ? String(row.field_tag) : void 0,
      onboardTime: isoTime(row.onboard_time ? Number(row.onboard_time) : null) ?? void 0
    });
  }
  return out;
}
__name(getHotSearch, "getHotSearch");
async function getHotTimeline(params = {}) {
  ensureWeiboHost("getHotTimeline");
  const groupId = String(params.groupId ?? "102803");
  const count = Math.min(20, Math.max(1, params.count ?? 20));
  const sinceId = String(params.sinceId ?? 0);
  const maxId = String(params.maxId ?? 0);
  const sp = new URLSearchParams({
    since_id: sinceId,
    refresh: "0",
    group_id: groupId,
    containerid: groupId,
    extparam: "discover|new_feed",
    max_id: maxId,
    count: String(count)
  });
  const json = await fetchJson(`https://weibo.com/ajax/feed/hottimeline?${sp}`);
  const statuses = (json.statuses ?? []).map(toStatusSummary);
  return {
    statuses,
    sinceId: String(json.since_id_str ?? json.since_id ?? ""),
    maxId: String(json.max_id_str ?? json.max_id ?? "")
  };
}
__name(getHotTimeline, "getHotTimeline");
async function getFriendsTimeline(params = {}) {
  ensureWeiboHost("getFriendsTimeline");
  const count = Math.min(50, Math.max(1, params.count ?? 20));
  const maxId = String(params.maxId ?? 0);
  const listId = String(params.listId ?? "");
  const sp = new URLSearchParams({
    list_id: listId,
    max_id: maxId,
    count: String(count),
    refresh: "4",
    fast_refresh: "1"
  });
  const json = await fetchJson(`https://weibo.com/ajax/feed/friendstimeline?${sp}`);
  const statuses = (json.statuses ?? []).map(toStatusSummary);
  return {
    statuses,
    sinceId: String(json.since_id_str ?? json.since_id ?? ""),
    maxId: String(json.max_id_str ?? json.max_id ?? "")
  };
}
__name(getFriendsTimeline, "getFriendsTimeline");
async function getStatus(params) {
  ensureWeiboHost("getStatus");
  const id = resolveStatusId(params, "getStatus");
  const sp = new URLSearchParams({ id, locale: "zh-CN", isGetLongText: "true" });
  const raw = await fetchJson(`https://weibo.com/ajax/statuses/show?${sp}`);
  if (!raw || raw.ok != null && raw.ok !== 1 && !raw.id) {
    throw new Error(`weibo.getStatus: weibo ${id} not found (404 / removed?)`);
  }
  if(params.includeLongText!==false && raw.isLongText && !(raw.longText?.longTextContent || raw.longText?.content || raw.longTextContent)){
    const full=await fetchJson(`https://weibo.com/ajax/statuses/longtext?${new URLSearchParams({id:String(raw.idstr??raw.id??id)})}`);
    if(full.data?.longTextContent)raw.longText=full.data;
  }
  return toStatusFull(raw);
}
__name(getStatus, "getStatus");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024, MAX_IMAGE_DATA_CHARS = 500_000;
/** Downscaled JPEG in the image shape hosts attach to the model; sinaimg allows weibo.com page reads. */
async function modelImage(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("Image exceeds 10 MB");
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(blob.type)) throw new Error(`Unsupported image type ${blob.type || "unknown"}`);
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
async function readStatusImages(params) {
  ensureWeiboHost("readStatusImages");
  const id = resolveStatusId(params, "readStatusImages");
  const raw = await fetchJson(`https://weibo.com/ajax/statuses/show?${new URLSearchParams({ id, locale: "zh-CN" })}`);
  const pics = statusPics(raw);
  const uid = String(raw.user?.idstr ?? raw.user?.id ?? "");
  const chosen = params.images ? [...new Set(params.images)] : pics.slice(0, 3).map((_, index) => index + 1);
  return {
    id: String(raw.idstr ?? raw.id ?? id),
    url: uid && raw.mblogid ? statusUrl(uid, raw.mblogid) : "",
    totalImages: pics.length,
    images: await Promise.all(chosen.map(async (number) => {
      const sources = pics[number - 1];
      if (!sources) return { image: number, error: `The status has ${pics.length} pictures.` };
      let error;
      for (const source of sources) {
        try { return { image: number, url: source, ...await modelImage(source) }; } catch (failure) { error = failure; }
      }
      return { image: number, url: sources[0], error: String(error?.message ?? error) };
    }))
  };
}
__name(readStatusImages, "readStatusImages");
async function getComments(params) {
  ensureWeiboHost("getComments");
  const mblogid = params.mblogid ?? (params.id != null ? String(params.id) : "");
  if (!mblogid) {
    throw new Error("weibo.getComments: pass { mblogid } (preferred) or { id } (numeric mid)");
  }
  let numericId;
  let parentUid;
  if (/^\d+$/.test(String(mblogid)) && params.uid) {
    numericId=String(mblogid);parentUid=String(params.uid);
  } else if (/^\d+$/.test(String(mblogid))) {
    numericId = String(mblogid);
    const parent = await getStatus({ id: numericId,includeLongText:false });
    parentUid = parent.author.id;
  } else {
    const parent = await getStatus({ mblogid: String(mblogid),includeLongText:false });
    numericId = parent.id;
    parentUid = parent.author.id;
  }
  if (!numericId || !parentUid) {
    throw new Error(`weibo.getComments: could not resolve parent uid for ${mblogid}`);
  }
  const count = Math.min(20, Math.max(1, params.count ?? 10));
  const orderByText = params.orderBy === "time" ? "0" : "1";
  const sp = new URLSearchParams({
    is_reload: "1",
    id: numericId,
    is_show_bulletin: "2",
    is_mix: "0",
    count: String(count),
    type: "feed",
    uid: parentUid,
    fetch_level: "0",
    locale: "zh-CN"
  });
  if (params.maxId) sp.set("max_id", String(params.maxId));
  if (params.orderBy === "time") sp.set("flow", orderByText);
  const json = await fetchJson(`https://weibo.com/ajax/statuses/buildComments?${sp}`,true);
  const offset=params.offset??0;
  const comments = (json.data ?? []).slice(offset,offset+count).map((c) => {
    const id = String(c.idstr ?? c.id ?? ""), rootid = String(c.rootidstr ?? c.rootid ?? id);
    return compact({
      id,
      rootid: rootid !== id ? rootid : void 0,
      text: stripHtml(c.text ?? c.text_raw ?? ""),
      createdAt: isoTime(c.created_at),
      likeCount: Number(c.like_counts ?? 0),
      totalReplyNumber: Number(c.total_number ?? 0) || void 0,
      source: String(c.source ?? ""),
      isAuthor: c.is_mblog_author ? true : void 0,
      author: toAuthor(c.user)
    });
  });
  return {
    comments,
    nextOffset:offset+comments.length<(json.data?.length??0)?offset+comments.length:null,
    maxId:offset+comments.length<(json.data?.length??0)?null:String(json.max_id_str ?? json.max_id ?? 0),
    total: Number(json.total_number ?? comments.length)
  };
}
__name(getComments, "getComments");
async function getReposts(params) {
  ensureWeiboHost("getReposts");
  const mblogid = params.mblogid ?? (params.id != null ? String(params.id) : "");
  if (!mblogid) {
    throw new Error("weibo.getReposts: pass { mblogid } (preferred) or { id } (numeric mid)");
  }
  let numericId;
  if (/^\d+$/.test(String(mblogid))) {
    numericId = String(mblogid);
  } else {
    const parent = await getStatus({ mblogid: String(mblogid),includeLongText:false });
    numericId = parent.id;
  }
  const page = Math.max(1, params.page ?? 1);
  const count = Math.min(20, Math.max(1, params.count ?? 10));
  const sp = new URLSearchParams({
    id: numericId,
    page: String(page),
    count: String(count)
  });
  const json = await fetchJson(`https://weibo.com/ajax/statuses/repostTimeline?${sp}`,true);
  const offset=params.offset??0;
  const reposts = (json.data ?? []).slice(offset,offset+count).map(toStatusSummary);
  return {
    reposts,
    totalNumber: Number(json.total_number ?? 0),
    maxPage: Number(json.max_page ?? 0),
    nextOffset:offset+reposts.length<(json.data?.length??0)?offset+reposts.length:null,
    nextPage:offset+reposts.length>=(json.data?.length??0)&&page<Number(json.max_page??0)?page+1:null
  };
}
__name(getReposts, "getReposts");
async function getUser(params) {
  ensureWeiboHost("getUser");
  const uidParam = params.uid != null ? String(params.uid) : "";
  const customParam = params.custom ? String(params.custom).trim() : "";
  if (!uidParam && !customParam) {
    throw new Error("weibo.getUser: pass { uid: numeric } or { custom: domain-slug }");
  }
  const sp = new URLSearchParams();
  if (uidParam) sp.set("uid", uidParam);
  else sp.set("custom", customParam);
  const json = await fetchJson(`https://weibo.com/ajax/profile/info?${sp}`);
  const u = json?.data?.user;
  if (!u) {
    throw new Error(`weibo.getUser: user not found (${uidParam || customParam})`);
  }
  const id = String(u.id ?? u.idstr ?? "");
  return compact({
    id,
    screenName: String(u.screen_name ?? ""),
    url: profileUrl(id),
    description: stripHtml(u.description ?? ""),
    verified: !!u.verified,
    verifiedReason: String(u.verified_reason ?? ""),
    followersCount: Number(u.followers_count ?? 0),
    friendsCount: Number(u.friends_count ?? 0),
    statusesCount: Number(u.statuses_count ?? 0),
    gender: u.gender === "m" || u.gender === "f" ? u.gender : "",
    location: String(u.location ?? ""),
    domain: String(u.domain ?? ""),
    weihao: String(u.weihao ?? ""),
    following: !!u.following
  });
}
__name(getUser, "getUser");
async function getUserStatuses(params) {
  ensureWeiboHost("getUserStatuses");
  if (params.uid == null) throw new Error("weibo.getUserStatuses: pass { uid, page?, feature? }");
  const sp = new URLSearchParams({
    uid: String(params.uid),
    page: String(Math.max(1, params.page ?? 1)),
    feature: String(params.feature ?? 0)
  });
  const json = await fetchJson(`https://weibo.com/ajax/statuses/mymblog?${sp}`);
  const rows=json?.data?.list??[];const offset=params.offset??0;const limit=params.limit??20;
  const statuses = rows.slice(offset,offset+limit).map(toStatusSummary);
  return { statuses, total: Number(json?.data?.total ?? 0),nextOffset:offset+statuses.length<rows.length?offset+statuses.length:null };
}
__name(getUserStatuses, "getUserStatuses");
async function getUserHotStatuses(params) {
  ensureWeiboHost("getUserHotStatuses");
  if (params.uid == null) throw new Error("weibo.getUserHotStatuses: pass { uid }");
  const sp = new URLSearchParams({
    uid: String(params.uid),
    page: String(params.page??1),
    feature: "2"
  });
  const json = await fetchJson(`https://weibo.com/ajax/profile/myhot?${sp}`);
  return (json?.data?.list ?? []).slice(params.offset??0,(params.offset??0)+(params.limit??20)).map(toStatusSummary);
}
__name(getUserHotStatuses, "getUserHotStatuses");
function parseSearchStatuses(doc) {
  const out = [];
  const cards = doc.querySelectorAll("#pl_feedlist_index .card-wrap[mid]");
  for (const card of Array.from(cards)) {
    const mid = card.getAttribute("mid") || "";
    if (!mid) continue;
    const userLink = card.querySelector(".info .name");
    const userHref = userLink?.getAttribute("href") || "";
    const uidMatch = userHref.match(/weibo\.com\/(?:u\/)?(\d+)/);
    const uid = uidMatch?.[1] || "";
    const screenName = userLink?.textContent?.trim() || "";
    const contentNode = card.querySelector('p[node-type="feed_list_content_full"]') || card.querySelector('p[node-type="feed_list_content"]');
    let text = contentNode?.textContent ?? "";
    text = text.replace(/\s*收起\s*d?\s*$/, "").replace(/\s+/g, " ").trim();
    const timeLink = card.querySelector(".from a");
    const createdAtText = timeLink?.textContent?.replace(/\s+/g, " ").trim() || "";
    const statusHref = timeLink?.getAttribute("href") || "";
    const mblogidMatch = statusHref.match(/\/(\d+)\/([A-Za-z0-9]+)/);
    const mblogid = mblogidMatch?.[2] || "";
    const sourceA = card.querySelectorAll(".from a")[1];
    const source = sourceA?.textContent?.trim() || "";
    const acts = Array.from(card.querySelectorAll(".card-act li")).map(
      (li) => (li.textContent || "").replace(/\s+/g, " ").trim()
    );
    const parseAct = /* @__PURE__ */ __name((i) => {
      const t = acts[i] || "";
      if (!t || /转发|评论|赞/.test(t.replace(/[\d\s]/g, ""))) {
      }
      const n = parseInt(t.replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    }, "parseAct");
    const repostsCount = parseAct(0);
    const commentsCount = parseAct(1);
    const attitudesCount = parseAct(2);
    const picUrls = [];
    card.querySelectorAll(".media-piclist img, .m3img img, .thumbnail img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !picUrls.includes(src)) picUrls.push(src);
    });
    out.push(compact({
      id: mid,
      mblogid,
      url: uid && mblogid ? `https://weibo.com/${uid}/${mblogid}` : statusHref,
      text,
      createdAt: createdAtText,
      source,
      repostsCount,
      commentsCount,
      attitudesCount,
      picUrls,
      author: compact({ id: uid, screenName, profileUrl: uid ? profileUrl(uid) : "" })
    }));
  }
  return out;
}
__name(parseSearchStatuses, "parseSearchStatuses");
async function searchStatuses(params) {
  if (!params || typeof params.query !== "string" || !params.query.trim()) {
    throw new Error("weibo.searchStatuses: pass { query: string, page?, sortBy? }");
  }
  const page = Math.max(1, params.page ?? 1);
  const sortBy = params.sortBy ?? "time";
  if(location.hostname!=="s.weibo.com"){
    ensureWeiboHost("searchStatuses");
    if(sortBy==="hot")throw new Error('weibo.searchStatuses: the weibo.com native search returns chronological results. Use sortBy:"time" or "default" here; hot sorting is only supported by the s.weibo.com adapter. Do not navigate automatically.');
    const sp=new URLSearchParams({q:params.query,page:String(page),count:String(params.count??20),atten:"0"});
    const json=await fetchJson(`${location.origin}/ajax/statuses/search?${sp}`);
    if(!Array.isArray(json.statuses))throw new Error('weibo.searchStatuses: native API returned no statuses array; this is not an empty successful search.');
    return json.statuses.slice(0,params.count??20).map(toStatusSummary);
  }
  ensureSearchHost("searchStatuses");
  const sp = new URLSearchParams({ q: params.query });
  if (sortBy === "time") sp.set("xsort", "time");
  else if (sortBy === "hot") sp.set("xsort", "hot");
  sp.set("page", String(page));
  const url = `https://s.weibo.com/weibo?${sp}`;
  const html = await fetchHtml(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if(!assertSearchPage(doc))return [];
  return parseSearchStatuses(doc);
}
__name(searchStatuses, "searchStatuses");
function parseSearchUsers(doc) {
  const out = [];
  const cards = doc.querySelectorAll("#pl_user_feedList .card.card-user-b");
  for (const card of Array.from(cards)) {
    const nameLink = card.querySelector("a.name");
    const href = nameLink?.getAttribute("href") || "";
    const uid = href.match(/weibo\.com\/u\/(\d+)/)?.[1] || href.match(/weibo\.com\/(\d+)/)?.[1] || "";
    const screenName = nameLink?.textContent?.trim() || "";
    const ps = card.querySelectorAll(".info p");
    const description = ps[0]?.textContent?.replace(/\s+/g, " ").trim() || "";
    const followersText = ps[1]?.textContent?.replace(/\s+/g, " ").trim() || "";
    const verified = !!card.querySelector(".user_vip_icon_container, .woo-avatar-icon");
    if (!uid && !screenName) continue;
    out.push({
      uid,
      screenName,
      url: uid ? profileUrl(uid) : "",
      description,
      followersText,
      verified
    });
  }
  return out;
}
__name(parseSearchUsers, "parseSearchUsers");
async function searchUsers(params) {
  if (!params || typeof params.query !== "string" || !params.query.trim()) {
    throw new Error("weibo.searchUsers: pass { query: string, page? }");
  }
  const page = Math.max(1, params.page ?? 1);
  if(location.hostname!=="s.weibo.com"){
    ensureWeiboHost("searchUsers");
    if(page!==1)throw new Error('weibo.searchUsers: weibo.com provides a first-page user suggestion list, not a paginated user directory.');
    const json=await fetchJson(`${location.origin}/ajax/side/search?${new URLSearchParams({q:params.query})}`);
    if(!Array.isArray(json.data?.users))throw new Error('weibo.searchUsers: native API returned no users array; this is not an empty successful search.');
    return json.data.users.map(u=>({uid:String(u.idstr??u.id??u.uid??''),screenName:String(u.screen_name??u.name??''),url:profileUrl(u.idstr??u.id??u.uid),description:stripHtml(u.description??''),verified:!!u.verified,scope:'user_suggestions'}));
  }
  ensureSearchHost("searchUsers");
  const sp = new URLSearchParams({ q: params.query, page: String(page) });
  const html = await fetchHtml(`https://s.weibo.com/user?${sp}`);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if(!assertSearchPage(doc))return [];
  return parseSearchUsers(doc);
}
__name(searchUsers, "searchUsers");

function assertSearchPage(doc){
  const empty=doc.querySelector('.card-no-result, .no-result');
  if(empty){
    // Weibo can append unrelated hot recommendations after "no results".
    return false;
  }
  if(!doc.querySelector('#pl_feedlist_index, #pl_user_feedList'))throw new Error('weibo: search returned an unrecognized/login page, not search results.');
  return true;
}

const identifier=z.union([z.string().regex(/^[a-zA-Z0-9]+$/),z.number().int().positive()]);
const cursor=z.union([z.string().regex(/^[a-zA-Z0-9]+$/),z.number().int().min(0)]);
const page=z.number().int().min(1).max(10000).default(1);
const count=(n=10,max=20)=>z.number().int().min(1).max(max).default(n);
const offset=z.number().int().min(0).max(10000).default(0);
const statusArgs={id:identifier.optional(),mblogid:z.string().regex(/^[a-zA-Z0-9]+$/).optional()};
const userArgs={uid:z.union([z.string().regex(/^\d+$/),z.number().int().positive()])};
function reader(summary,input,handler){return fn({summary,input,handler:raw=>handler(input.parse(raw??{}))});}
export default defineSkill({
  getHotSearch:reader('GET /ajax/statuses/hot_band: hot search words.',z.object({limit:count(20,50)}),getHotSearch),
  getHotTimeline:reader('GET /ajax/feed/hottimeline: discover feed, native group and cursor options.',z.object({groupId:identifier.optional(),count:count(20),sinceId:cursor.optional(),maxId:cursor.optional()}),getHotTimeline),
  getFriendsTimeline:reader('GET /ajax/feed/friendstimeline: signed-in following feed. Native listId/maxId choose a group or continuation.',z.object({count:count(20,50),listId:z.string().optional(),maxId:cursor.optional()}),getFriendsTimeline),
  getStatus:reader('GET /ajax/statuses/show: mblogid (base62) or numeric id. includeLongText (default true) uses the native /statuses/longtext endpoint when needed; false reads only the preview. textComplete reports actual coverage.',z.object({...statusArgs,includeLongText:z.boolean().default(true)}),getStatus),
  readStatusImages:reader('Attach up to three pictures of one status so you can see them; statuses report picNum. A repost\'s pictures belong to retweeted.id.',z.object({...statusArgs,images:z.array(z.number().int().min(1)).min(1).max(3).optional().describe('1-based picture numbers. Default: the first three.')}),readStatusImages),
  getComments:reader('GET /ajax/statuses/buildComments. Pass numeric id + author uid to avoid an extra status lookup, or mblogid/id alone. Consume nextOffset with the SAME input maxId before following returned maxId; 30-second page snapshot.',z.object({...statusArgs,uid:userArgs.uid.optional(),count:count(),offset,maxId:cursor.optional(),orderBy:z.enum(['hot','time']).default('hot')}),getComments),
  getReposts:reader('GET /ajax/statuses/repostTimeline: page and count; consume nextOffset on this server page before nextPage. 30-second page snapshot.',z.object({...statusArgs,page,count:count(),offset}),getReposts),
  getUser:reader('GET /ajax/profile/info: numeric uid or custom vanity domain.',z.object({uid:userArgs.uid.optional(),custom:z.string().min(1).max(100).optional()}),getUser),
  getUserStatuses:reader('GET /ajax/statuses/mymblog: uid/page/feature (0 all, 1 original, 2 images, 3 video). Local limit/offset bound output; consume nextOffset on this server page.',z.object({...userArgs,page,feature:z.number().int().min(0).max(3).default(0),offset,limit:count(20,50)}),getUserStatuses),
  getUserHotStatuses:reader('GET /ajax/profile/myhot: popular posts for a user by page. Local offset/limit slice that server page; a partial array is not full history.',z.object({...userArgs,page,offset,limit:count(20,50)}),getUserHotStatuses),
  searchStatuses:reader('Search directly on weibo.com with GET /ajax/statuses/search: q, page, count, atten=0 (all users, not just followed accounts). No navigation. Native order is chronological (time/default); hot is only available when already on s.weibo.com. Returns status summaries; use getStatus for complete long text.',z.object({query:z.string().trim().min(1).max(200),page,count:count(20,50),sortBy:z.enum(['hot','time','default']).default('time')}),searchStatuses),
  searchUsers:reader('weibo.com: GET /ajax/side/search user suggestions, page 1 only (not a complete directory). An existing s.weibo.com tab uses its paginated SSR user search.',z.object({query:z.string().trim().min(1).max(200),page}),searchUsers),
},{instructions:"For discussion summaries, default to the original post plus roughly the first 30 and latest 100 replies, deduplicating overlaps; follow user-specified ranges. On weibo.com, use searchStatuses({query,sortBy:\"time\"}) for direct same-origin search. Search keyword variations, then use getStatus/getComments for details. Existing s.weibo.com tabs use the SSR adapter. Consume nextOffset on the same page/cursor before advancing. Statuses report picNum; when the pictures matter, readStatusImages attaches them. Cite original URLs."});
