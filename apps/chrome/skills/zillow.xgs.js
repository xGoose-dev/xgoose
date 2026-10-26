// ==XGooseSkill==
// @name        zillow
// @namespace   zillow
// @version     0.1.0
// @description Zillow search-results scraper. Reads listings, region info, filters, and pagination from the page's hydrated `__NEXT_DATA__` blob. Anonymous, same-origin, no GraphQL — bypasses PerimeterX entirely on already-loaded pages.
// @match       *://www.zillow.com/*
// @match       *://zillow.com/*
// @detect      location.hostname.endsWith('zillow.com')
// @run-at      document_idle
// @connect     <self>
// @primary     getCurrentSearchResults
// @keyword     zillow
// @keyword     rental
// @keyword     rentals
// @keyword     for rent
// @keyword     apartments
// @keyword     real estate
// @keyword     house
// @keyword     homes
// @keyword     for sale
// @keyword     property
// @keyword     zpid
// @keyword     zestimate
// @keyword     mls
// ==/XGooseSkill==

/**
 * Zillow search-results scraper. Reads listings, region info, filters, and pagination from the page's hydrated `__NEXT_DATA__` blob. Anonymous, same-origin, no GraphQL — bypasses PerimeterX entirely on already-loaded pages.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # Zillow — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object (or none). The skill activates on `*.zillow.com`. **It does not call Zillow's GraphQL or `/async-create-search-page-state` endpoints** — both are gated by aggressive PerimeterX bot protection that 403s any unblessed `fetch()`. Instead the skill reads the **hydrated `__NEXT_DATA__` JSON blob** that Zillow ships in every SRP/HDP/BDP HTML response. That blob carries the same listing objects the SPA renders, so the agent gets all 41 results per page (plus filters, region info, pagination, total count) without poking the network at all.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const DEFAULT_LIMIT = {
  maxConcurrent: 1,
  minGapMs: 1e3,
  jitterMs: 300
};
const RETRY_429_DELAYS_MS = [2e3, 5e3, 15e3];
const sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
function clampInt(v, lo, hi, dflt) {
  const n = Number.isFinite(v) ? Math.floor(v) : dflt;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
__name(clampInt, "clampInt");
function mergeConfig(base, patch) {
  if (!patch) return base;
  return {
    maxConcurrent: clampInt(patch.maxConcurrent ?? base.maxConcurrent, 1, 16, base.maxConcurrent),
    minGapMs: clampInt(patch.minGapMs ?? base.minGapMs, 0, 6e4, base.minGapMs),
    jitterMs: clampInt(patch.jitterMs ?? base.jitterMs, 0, 3e4, base.jitterMs)
  };
}
__name(mergeConfig, "mergeConfig");
const _Limiter = class _Limiter {
  constructor() {
    __publicField(this, "cfg", { ...DEFAULT_LIMIT });
    __publicField(this, "inFlight", 0);
    __publicField(this, "lastStart", 0);
    __publicField(this, "waiters", []);
  }
  setConfig(patch) {
    this.cfg = mergeConfig(this.cfg, patch);
  }
  getConfig() {
    return { ...this.cfg };
  }
  async acquire(override) {
    const cfg = mergeConfig(this.cfg, override);
    while (this.inFlight >= cfg.maxConcurrent) {
      await new Promise((r) => this.waiters.push(r));
    }
    this.inFlight++;
    const now = Date.now();
    const wait = this.lastStart + cfg.minGapMs - now;
    if (wait > 0) {
      const jitter = cfg.jitterMs > 0 ? Math.floor(Math.random() * cfg.jitterMs) : 0;
      await sleep(wait + jitter);
    } else if (cfg.jitterMs > 0 && cfg.minGapMs > 0) {
      const jitter = Math.floor(Math.random() * cfg.jitterMs);
      if (jitter > 0) await sleep(jitter);
    }
    this.lastStart = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
};
__name(_Limiter, "Limiter");
let Limiter = _Limiter;
const __root = typeof window !== "undefined" ? window : globalThis;
__root.webagent = __root.webagent || { skills: {} };
__root.webagent.skills = __root.webagent.skills || {};
__root.webagent.skills.zillow = __root.webagent.skills.zillow || {};
const LIMITER = __root.webagent.skills.zillow.__limiter ?? new Limiter();
__root.webagent.skills.zillow.__limiter = LIMITER;
const NEXT_DATA_RE = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const PX_DENY_RE = /Access to this page has been denied|px-captcha/i;
const STATUS_TYPES = /* @__PURE__ */ new Set(["FOR_RENT", "FOR_SALE", "SOLD", "PENDING"]);
function parseNextDataFromHtml(html) {
  const m = html.match(NEXT_DATA_RE);
  if (!m) return null;
  return JSON.parse(m[1]);
}
__name(parseNextDataFromHtml, "parseNextDataFromHtml");
function readNextDataFromDom() {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el) return null;
  const txt = el.textContent ?? "";
  if (!txt) return null;
  return JSON.parse(txt);
}
__name(readNextDataFromDom, "readNextDataFromDom");
function flattenFilters(raw) {
  if (!raw) return {};
  const out = {};
  for (const k of Object.keys(raw)) {
    const cell = raw[k];
    if (cell && typeof cell === "object" && "value" in cell) {
      out[k] = cell.value;
    }
  }
  return out;
}
__name(flattenFilters, "flattenFilters");
function inflateFilters(filters) {
  const out = {};
  for (const k of Object.keys(filters)) {
    const v = filters[k];
    if (v === void 0) continue;
    out[k] = { value: v };
  }
  return out;
}
__name(inflateFilters, "inflateFilters");
function statusOf(s) {
  if (s && STATUS_TYPES.has(s)) return s;
  return "OTHER";
}
__name(statusOf, "statusOf");
function normalizeListing(r) {
  const photos = Array.isArray(r.carouselPhotosComposable?.photoData) ? r.carouselPhotosComposable.photoData.length : 0;
  const units = Array.isArray(r.units) ? r.units.map((u) => ({
    price: String(u.price ?? ""),
    beds: String(u.beds ?? ""),
    roomForRent: !!u.roomForRent
  })) : [];
  const id = r.id != null ? String(r.id) : r.zpid != null ? String(r.zpid) : "";
  const zpid = r.zpid != null ? String(r.zpid) : id;
  const out = {
    id,
    zpid,
    isBuilding: !!r.isBuilding,
    buildingName: r.buildingName ?? null,
    detailUrl: r.detailUrl ?? "",
    statusType: statusOf(r.statusType),
    statusText: r.statusText ?? "",
    address: r.address ?? "",
    addressStreet: r.addressStreet ?? "",
    addressCity: r.addressCity ?? "",
    addressState: r.addressState ?? "",
    addressZipcode: r.addressZipcode ?? "",
    latLong: r.latLong ?? null,
    imgSrc: r.imgSrc ?? null,
    hasImage: !!r.hasImage,
    photoCount: photos,
    units,
    isFeaturedListing: !!r.isFeaturedListing,
    isShowcaseListing: !!r.isShowcaseListing
  };
  if (typeof r.price === "number") out.price = r.price;
  if (typeof r.priceText === "string") out.priceText = r.priceText;
  if (typeof r.beds === "number") out.beds = r.beds;
  if (typeof r.baths === "number") out.baths = r.baths;
  if (typeof r.area === "number") out.area = r.area;
  if (typeof r.availabilityCount === "number") out.availabilityCount = r.availabilityCount;
  return out;
}
__name(normalizeListing, "normalizeListing");
function currentPageFromUrl(url, fallback) {
  const m = url.match(/\/(\d+)_p\/?(?:\?|$)/);
  if (m) return Number(m[1]);
  if (fallback && fallback > 0) return fallback;
  return 1;
}
__name(currentPageFromUrl, "currentPageFromUrl");
function buildResult(url, sps) {
  if (!sps) {
    return {
      status: "no_search_state",
      url,
      region: [],
      filters: {},
      rawQueryState: null,
      mapBounds: null,
      listings: [],
      totalResultCount: 0,
      resultsPerPage: 0,
      totalPages: 0,
      currentPage: 0,
      nextUrl: null,
      seo: { windowTitle: "", metaDescription: "", baseUrl: "" }
    };
  }
  const list = sps.cat1?.searchResults?.listResults ?? [];
  const slist = sps.cat1?.searchList ?? {};
  const region = sps.regionState?.regionInfo ?? [];
  const filters = flattenFilters(sps.queryState?.filterState);
  const seo = sps.searchPageSeoObject ?? {};
  const currentPage = currentPageFromUrl(url, sps.queryState?.pagination?.currentPage);
  return {
    status: "ok",
    url,
    region,
    filters,
    rawQueryState: sps.queryState ?? null,
    mapBounds: sps.queryState?.mapBounds ?? null,
    listings: list.map(normalizeListing),
    totalResultCount: slist.totalResultCount ?? 0,
    resultsPerPage: slist.resultsPerPage ?? list.length,
    totalPages: slist.totalPages ?? 0,
    currentPage,
    nextUrl: slist.pagination?.nextUrl ?? null,
    seo: {
      windowTitle: seo.windowTitle ?? "",
      metaDescription: seo.metaDescription ?? "",
      baseUrl: seo.baseUrl ?? ""
    }
  };
}
__name(buildResult, "buildResult");
function pxBlockedResult(url) {
  return {
    status: "perimeterx_blocked",
    url,
    region: [],
    filters: {},
    rawQueryState: null,
    mapBounds: null,
    listings: [],
    totalResultCount: 0,
    resultsPerPage: 0,
    totalPages: 0,
    currentPage: 0,
    nextUrl: null,
    seo: { windowTitle: "", metaDescription: "", baseUrl: "" }
  };
}
__name(pxBlockedResult, "pxBlockedResult");
function noNextDataResult(url) {
  return {
    status: "no_next_data",
    url,
    region: [],
    filters: {},
    rawQueryState: null,
    mapBounds: null,
    listings: [],
    totalResultCount: 0,
    resultsPerPage: 0,
    totalPages: 0,
    currentPage: 0,
    nextUrl: null,
    seo: { windowTitle: "", metaDescription: "", baseUrl: "" }
  };
}
__name(noNextDataResult, "noNextDataResult");
function rateLimitedResult(url) {
  return {
    status: "rate_limited",
    url,
    region: [],
    filters: {},
    rawQueryState: null,
    mapBounds: null,
    listings: [],
    totalResultCount: 0,
    resultsPerPage: 0,
    totalPages: 0,
    currentPage: 0,
    nextUrl: null,
    seo: { windowTitle: "", metaDescription: "", baseUrl: "" }
  };
}
__name(rateLimitedResult, "rateLimitedResult");
function injectPageSegment(urlPath, page) {
  if (!page || page < 2) return urlPath;
  const q = urlPath.indexOf("?");
  const path = q >= 0 ? urlPath.slice(0, q) : urlPath;
  const tail = q >= 0 ? urlPath.slice(q) : "";
  if (/\/\d+_p\/?$/.test(path)) {
    return path.replace(/\/\d+_p\/?$/, `/${page}_p/`) + tail;
  }
  if (path.endsWith("/")) {
    return `${path}${page}_p/${tail}`;
  }
  return `${path}/${page}_p/${tail}`;
}
__name(injectPageSegment, "injectPageSegment");
function absolutize(urlPath) {
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  return `https://www.zillow.com${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;
}
__name(absolutize, "absolutize");
function getCurrentSearchResults() {
  const url = location.href;
  const data = readNextDataFromDom();
  if (!data) return noNextDataResult(url);
  const sps = data.props?.pageProps?.searchPageState;
  return buildResult(url, sps);
}
__name(getCurrentSearchResults, "getCurrentSearchResults");
function getCurrentPageData() {
  const data = readNextDataFromDom();
  if (!data) {
    return { url: location.href, pageType: "", pageProps: null };
  }
  return {
    url: location.href,
    pageType: data.page ?? "",
    pageProps: data.props?.pageProps ?? null
  };
}
__name(getCurrentPageData, "getCurrentPageData");
async function searchByText(params) {
  if (!params || typeof params !== "object") {
    throw new Error("zillow.searchByText: pass {query, page?, rateLimit?}");
  }
  if (typeof params.query !== "string" || !params.query.trim()) {
    throw new Error('zillow.searchByText: `query` is required (e.g. "Chicago, IL", "90210")');
  }
  const encoded = encodeURIComponent(params.query.trim());
  return searchByPath({
    urlPath: `/homes/${encoded}_rb/`,
    page: params.page,
    rateLimit: params.rateLimit
  });
}
__name(searchByText, "searchByText");
async function searchByPath(params) {
  if (!params || typeof params !== "object") {
    throw new Error("zillow.searchByPath: pass {urlPath, page?, rateLimit?}");
  }
  if (typeof params.urlPath !== "string" || !params.urlPath) {
    throw new Error('zillow.searchByPath: `urlPath` is required (e.g. "/chicago-il/rentals/")');
  }
  const target = injectPageSegment(params.urlPath, params.page);
  const url = absolutize(target);
  for (let attempt = 0; ; attempt++) {
    const release = await LIMITER.acquire(params.rateLimit);
    let r;
    let text;
    try {
      r = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      text = await r.text();
    } finally {
      release();
    }
    if (r.status === 429) {
      if (attempt >= RETRY_429_DELAYS_MS.length) return rateLimitedResult(url);
      await sleep(RETRY_429_DELAYS_MS[attempt]);
      continue;
    }
    if (r.status === 403 || PX_DENY_RE.test(text)) {
      return pxBlockedResult(url);
    }
    if (!r.ok) {
      throw new Error(`zillow.searchByPath: GET ${url} \u2192 HTTP ${r.status}`);
    }
    const data = parseNextDataFromHtml(text);
    if (!data) return noNextDataResult(url);
    return buildResult(url, data.props?.pageProps?.searchPageState);
  }
}
__name(searchByPath, "searchByPath");
function setRateLimit(config) {
  LIMITER.setConfig(config);
}
__name(setRateLimit, "setRateLimit");
function getRateLimit() {
  return LIMITER.getConfig();
}
__name(getRateLimit, "getRateLimit");
function buildSearchUrl(params) {
  if (!params || typeof params !== "object") {
    throw new Error("zillow.buildSearchUrl: pass {filters, regionId?, regionType?, mapBounds?, sortSelection?, page?}");
  }
  const filterState = inflateFilters(params.filters ?? {});
  if (params.sortSelection) {
    filterState.sortSelection = { value: params.sortSelection };
  }
  const queryState = {
    pagination: params.page && params.page > 1 ? { currentPage: params.page } : {},
    isMapVisible: false,
    isListVisible: true,
    filterState
  };
  if (params.regionId != null) {
    queryState.regionSelection = [
      { regionId: params.regionId, regionType: params.regionType ?? 6 }
    ];
  }
  if (params.mapBounds) {
    queryState.mapBounds = params.mapBounds;
  }
  const sp = new URLSearchParams({
    category: "SEMANTIC",
    searchQueryState: JSON.stringify(queryState)
  });
  return `https://www.zillow.com/homes/?${sp.toString()}`;
}
__name(buildSearchUrl, "buildSearchUrl");

export default defineSkill({
  buildSearchUrl: fn({
    summary: "build the canonical /homes/?searchQueryState=… URL from a partial query state.",
    input: z.any().optional(),
    handler: async (params) => buildSearchUrl(params),
  }),
  getCurrentPageData: fn({
    summary: "raw __NEXT_DATA__.props.pageProps for any page (SRP, HDP, BDP). Use when the page isn't a search result page.",
    input: z.any().optional(),
    handler: async (params) => getCurrentPageData(params),
  }),
  getCurrentSearchResults: fn({
    summary: "★ main entry — reads __NEXT_DATA__ on the currently loaded SRP.",
    input: z.any().optional(),
    handler: async (params) => getCurrentSearchResults(params),
  }),
  getRateLimit: fn({
    summary: "read current limiter config.",
    input: z.any().optional(),
    handler: async (params) => getRateLimit(params),
  }),
  searchByPath: fn({
    summary: "fetch any zillow URL path (e.g. /seattle-wa/2_p/) and parse.",
    input: z.any().optional(),
    handler: async (params) => searchByPath(params),
  }),
  searchByText: fn({
    summary: "search by free-text query (city, ZIP, neighborhood). Hits /homes/{query}_rb/.",
    input: z.any().optional(),
    handler: async (params) => searchByText(params),
  }),
  setRateLimit: fn({
    summary: "tune the tab-scoped fetch limiter (default 1 req every ~1s).",
    input: z.any().optional(),
    handler: async (params) => setRateLimit(params),
  }),
});

