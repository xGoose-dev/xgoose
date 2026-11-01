// ==XGooseSkill==
// @name        zillow
// @namespace   zillow
// @version     0.2.1
// @description Zillow search-results scraper. Reads listings, region info, filters, and pagination from the page's hydrated `__NEXT_DATA__` blob. Includes session SSR searches and property detail/history reads.
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

// src/real-estate/zillow.xgs.js
import { defineSkill, fn as fn2 } from "@xgoose/skill";
import { z as z2 } from "zod";

// src/real-estate/access.js
import { fn } from "@xgoose/skill";
import { z } from "zod";
var empty = z.object({});
var urlInput = z.object({ url: z.string().optional() });
var queue = Promise.resolve();
var last = 0;
async function request(url) {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin) throw Error("Open this skill on " + target.origin);
  const job = queue.then(async () => {
    await new Promise((r) => setTimeout(r, Math.max(0, 1e3 - (Date.now() - last))));
    last = Date.now();
    const response = await fetch(target.href, { credentials: "include" });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${target.pathname}`);
    return response.text();
  });
  queue = job.catch(() => {
  });
  return job;
}
function json(text2) {
  return JSON.parse(text2.replace(/^\s*\{\}&&/, ""));
}
async function page(url) {
  if (!url || new URL(url, location.href).href === location.href) return document;
  return new DOMParser().parseFromString(await request(url), "text/html");
}
function next(doc) {
  const el = doc.querySelector("script#__NEXT_DATA__");
  if (!el) throw Error("Page did not return __NEXT_DATA__; open the URL in the browser.");
  return JSON.parse(el.textContent).props.pageProps;
}
var text = (doc, selector) => {
  const el = doc.querySelector(selector);
  if (!el) return null;
  const clone = el.cloneNode(true);
  for (const script of clone.querySelectorAll("script,style")) script.remove();
  return clone.textContent.replace(/\s+/g, " ").trim() || null;
};
function schemas(doc) {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((el) => {
    try {
      const v = JSON.parse(el.textContent);
      return Array.isArray(v) ? v : v["@graph"] || [v];
    } catch {
      return [];
    }
  });
}
var photos = /* @__PURE__ */ new Map();
function propertyResult(url, data, images = []) {
  const urls = [...new Set(images.filter(Boolean))];
  photos.set(url, urls);
  return { url, ...data, images: urls.map((url2, i) => ({ image: i + 1, url: url2 })), readImages: urls.length ? `readPropertyImages({url:${JSON.stringify(url)},images:[N]})` : void 0 };
}
function entry(summary, input, handler, args = {}) {
  return fn({ summary, input, examples: [{ args }], handler: (raw = {}) => handler(input.parse(raw)) });
}
function imageFunction() {
  return entry("Return selected original property photos for the extension background to attach pixels.", z.object({ url: z.string(), images: z.array(z.number().int().positive()).default([1]) }), ({ url, images }) => ({ imageContext: { requested: true, delivery: "urls_only_until_host_attaches", images: images.map((image) => ({ image, url: photos.get(url)[image - 1] })) } }));
}
function searchState(p) {
  return p.searchPageState || p.cat1 && p || p.componentProps?.searchPageState;
}
function zillowResults(p, url) {
  const s = searchState(p);
  if (!s?.cat1) throw Error("No Zillow searchPageState in this response");
  return { url, queryState: s.queryState, listings: s.cat1.searchResults?.listResults || [], total: s.cat1.searchList?.totalResultCount ?? s.categoryTotals?.cat1?.totalResultCount, pagination: s.cat1.searchList?.pagination };
}
var zillowFunctions = {
  searchProperties: entry("Search sale/rental/sold listings using Zillow SSR and region-pinned searchQueryState.", z.object({ location: z.string(), status: z.enum(["for_sale", "for_rent", "sold"]).default("for_sale"), minPrice: z.number().optional(), maxPrice: z.number().optional(), beds: z.number().optional(), baths: z.number().optional(), page: z.number().int().positive().default(1), sort: z.enum(["priorityscore", "pricea", "priced", "days"]).default("priorityscore") }), async (a) => {
    const base = "/homes/" + encodeURIComponent(a.location.trim()) + "_rb/";
    const resolved = next(await page(base));
    const state = searchState(resolved);
    if (!state?.queryState?.regionSelection?.length) throw Error("Location was not resolved; open the Zillow search page for this location.");
    const filterState = { sortSelection: { value: a.sort } };
    if (a.status !== "for_sale") {
      for (const key of ["isForSaleByAgent", "isForSaleByOwner", "isNewConstruction", "isComingSoon", "isAuction", "isForSaleForeclosure"]) filterState[key] = { value: false };
      filterState[a.status === "for_rent" ? "isForRent" : "isRecentlySold"] = { value: true };
    }
    if (a.minPrice !== void 0 || a.maxPrice !== void 0) filterState.price = { ...a.minPrice !== void 0 ? { min: a.minPrice } : {}, ...a.maxPrice !== void 0 ? { max: a.maxPrice } : {} };
    if (a.beds !== void 0) filterState.beds = { min: a.beds };
    if (a.baths !== void 0) filterState.baths = { min: a.baths };
    const query = { ...state.queryState, usersSearchTerm: a.location, filterState, pagination: { currentPage: a.page }, isListVisible: true, isMapVisible: false };
    const url = new URL(base, location.origin);
    url.searchParams.set("searchQueryState", JSON.stringify(query));
    return zillowResults(next(await page(url.href)), url.href);
  }, { location: "Chicago, IL", status: "for_rent", maxPrice: 2500 }),
  getProperty: entry("Read property facts, price/tax history and photos from a Zillow homedetails URL.", urlInput, async ({ url = location.href }) => {
    const p = next(await page(url));
    const raw = p.gdpClientCache ?? p.componentProps?.gdpClientCache;
    const cache = typeof raw === "string" ? JSON.parse(raw) : raw;
    const property = Object.values(cache || {}).find((v) => v?.property)?.property;
    if (!property) throw Error("No property record returned for this URL");
    return propertyResult(url, { property }, (property.responsivePhotos || []).map((p2) => p2.url || p2.mixedSources?.jpeg?.at(-1)?.url));
  }),
  readPropertyImages: imageFunction()
};
async function stingray(path) {
  const value = json(await request(path));
  if (value.resultCode !== void 0 && value.resultCode !== 0) throw Error(value.errorMessage || `Redfin resultCode ${value.resultCode}`);
  return value.payload;
}
var redfinFunctions = {
  resolveLocation: entry("Resolve a city, ZIP, neighborhood or address with Redfin autocomplete.", z.object({ query: z.string() }), async ({ query }) => {
    const payload = await stingray("/stingray/do/location-autocomplete?" + new URLSearchParams({ location: query, start: "0", count: "1", v: "2", iss: "false", ooa: "true", mrs: "false" }));
    const types = { neighborhood: 1, zipcode: 2, county: 5, city: 6 };
    return { ...payload, regions: (payload.sections || []).filter((section) => section.name === "Places").flatMap((section) => section.rows || []).map((row) => {
      const [prefix, id] = row.id.split("_");
      const kind = row.url?.match(/^\/(city|zipcode|neighborhood|county)\//)?.[1];
      return { ...row, regionId: Number(id), regionType: types[kind] ?? Number(prefix) };
    }) };
  }, { query: "Chicago, IL" }),
  searchProperties: entry("Search Redfin for-sale listings by an explicit region ID/type from resolveLocation. GIS supports for-sale here.", z.object({ regionId: z.number(), regionType: z.number(), minPrice: z.number().optional(), maxPrice: z.number().optional(), beds: z.number().optional(), baths: z.number().optional(), limit: z.number().int().min(1).max(350).default(40) }), async (a) => {
    const q = new URLSearchParams({ al: "1", num_homes: String(a.limit), region_id: String(a.regionId), region_type: String(a.regionType), sf: "1,2,3,5,6,7", start: "0", status: "9", uipt: "1,2,3,4,5,6,7,8", v: "8" });
    for (const [field, key] of [["minPrice", "min_price"], ["maxPrice", "max_price"], ["beds", "num_beds"], ["baths", "num_baths"]]) if (a[field] !== void 0) q.set(key, String(a[field]));
    return { source: location.origin + "/stingray/api/gis?" + q, payload: await stingray("/stingray/api/gis?" + q) };
  }, { regionId: 29470, regionType: 6 }),
  getProperty: entry("Resolve a canonical Redfin property URL and read above/below-the-fold facts and history.", urlInput, async ({ url = location.href }) => {
    const path = new URL(url, location.origin).pathname;
    const ids = await stingray("/stingray/api/home/details/initialInfo?path=" + encodeURIComponent(path));
    const q = new URLSearchParams({ propertyId: String(ids.propertyId), listingId: String(ids.listingId), accessLevel: "1" });
    return { url, aboveTheFold: await stingray("/stingray/api/home/details/aboveTheFold?" + q), belowTheFold: await stingray("/stingray/api/home/details/belowTheFold?" + q) };
  })
};
var apartmentsFunctions = {
  searchProperties: entry("Read an Apartments.com city/filter/page URL; preserve native next-page links.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const listings = [...doc.querySelectorAll("article.placard[data-listingid]")].map((el) => ({ id: el.getAttribute("data-listingid"), url: el.querySelector("a.property-link")?.href || el.getAttribute("data-url"), name: text(el, ".property-title"), address: text(el, ".property-address"), price: text(el, ".property-pricing") || [...el.querySelectorAll(".priceTextBox")].map((x) => x.textContent.trim()).join(" / ") || null, beds: text(el, ".property-beds") || [...el.querySelectorAll(".bedTextBox")].map((x) => x.textContent.trim()).join(" / ") || null, offers: [...el.querySelectorAll(".bedRentBox")].map((x) => ({ beds: text(x, ".bedTextBox"), price: text(x, ".priceTextBox") })), summary: text(el, ".property-description") }));
    if (!listings.length && !doc.querySelector("#placardContainer")) throw Error("Search page did not contain rental listings; open the URL in the browser.");
    return { url, listings, next: doc.querySelector('a[aria-label="Next"], a[aria-label="Next Page"], .paging a.next')?.getAttribute("href") || null };
  }),
  getProperty: entry("Read rental pricing, floor-plan/unit text, amenities, reviews and structured property data.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const data = schemas(doc);
    const name = text(doc, "#propertyName");
    if (!name && !data.length) throw Error("No apartment property returned");
    return propertyResult(url, { name, address: text(doc, ".propertyAddressContainer"), pricing: text(doc, ".rentInfoDetail"), floorPlans: text(doc, "#pricingView"), amenities: text(doc, "#amenitiesSection"), reviews: text(doc, "#reviewsSection"), rating: text(doc, ".averageRating"), fees: text(doc, "#feesSection"), structuredData: data }, [...doc.querySelectorAll(".aspectRatioImage img")].map((el) => el.getAttribute("src")));
  }),
  readPropertyImages: imageFunction()
};
var realtorFunctions = {
  searchProperties: entry("Read Realtor city/filter/page URL; current search uses React Router loader data, fetched SSR uses Next data.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const live = doc === document ? window.__reactRouterDataRouter?.state?.loaderData?.srp?.search?.value : null;
    const p = live ? null : next(doc);
    const data = live || p.initialReduxState?.searchResults || p.searchResults;
    if (!data) throw Error("No Realtor search payload; open the URL in the browser then call again.");
    return { url, data };
  }),
  getProperty: entry("Read Realtor listing facts, description, fees, history and photos from the detail-page hydration.", urlInput, async ({ url = location.href }) => {
    const p = next(await page(url));
    const property = p.initialReduxState?.propertyDetails;
    if (!property) throw Error("No Realtor propertyDetails in response");
    return { url, property };
  })
};

// src/real-estate/zillow.xgs.js
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var DEFAULT_LIMIT = {
  maxConcurrent: 1,
  minGapMs: 1e3,
  jitterMs: 300
};
var RETRY_429_DELAYS_MS = [2e3, 5e3, 15e3];
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
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
var _Limiter = class _Limiter2 {
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
      const next2 = this.waiters.shift();
      if (next2) next2();
    };
  }
};
__name(_Limiter, "Limiter");
var Limiter = _Limiter;
var __root = typeof window !== "undefined" ? window : globalThis;
__root.webagent = __root.webagent || { skills: {} };
__root.webagent.skills = __root.webagent.skills || {};
__root.webagent.skills.zillow = __root.webagent.skills.zillow || {};
var LIMITER = __root.webagent.skills.zillow.__limiter ?? new Limiter();
__root.webagent.skills.zillow.__limiter = LIMITER;
var NEXT_DATA_RE = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
var PX_DENY_RE = /Access to this page has been denied|px-captcha/i;
var STATUS_TYPES = /* @__PURE__ */ new Set(["FOR_RENT", "FOR_SALE", "SOLD", "PENDING"]);
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
  const photos2 = Array.isArray(r.carouselPhotosComposable?.photoData) ? r.carouselPhotosComposable.photoData.length : 0;
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
    photoCount: photos2,
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
function injectPageSegment(urlPath, page2) {
  if (!page2 || page2 < 2) return urlPath;
  const q = urlPath.indexOf("?");
  const path = q >= 0 ? urlPath.slice(0, q) : urlPath;
  const tail = q >= 0 ? urlPath.slice(q) : "";
  if (/\/\d+_p\/?$/.test(path)) {
    return path.replace(/\/\d+_p\/?$/, `/${page2}_p/`) + tail;
  }
  if (path.endsWith("/")) {
    return `${path}${page2}_p/${tail}`;
  }
  return `${path}/${page2}_p/${tail}`;
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
    let text2;
    try {
      r = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      text2 = await r.text();
    } finally {
      release();
    }
    if (r.status === 429) {
      if (attempt >= RETRY_429_DELAYS_MS.length) return rateLimitedResult(url);
      await sleep(RETRY_429_DELAYS_MS[attempt]);
      continue;
    }
    if (r.status === 403 || PX_DENY_RE.test(text2)) {
      return pxBlockedResult(url);
    }
    if (!r.ok) {
      throw new Error(`zillow.searchByPath: GET ${url} \u2192 HTTP ${r.status}`);
    }
    const data = parseNextDataFromHtml(text2);
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
var zillow_xgs_default = defineSkill({
  ...zillowFunctions,
  buildSearchUrl: fn2({
    summary: "build the canonical /homes/?searchQueryState=\u2026 URL from a partial query state.",
    input: z2.any().optional(),
    handler: async (params) => buildSearchUrl(params)
  }),
  getCurrentPageData: fn2({
    summary: "raw __NEXT_DATA__.props.pageProps for any page (SRP, HDP, BDP). Use when the page isn't a search result page.",
    input: z2.any().optional(),
    handler: async (params) => getCurrentPageData(params)
  }),
  getCurrentSearchResults: fn2({
    summary: "\u2605 main entry \u2014 reads __NEXT_DATA__ on the currently loaded SRP.",
    input: z2.any().optional(),
    handler: async (params) => getCurrentSearchResults(params)
  }),
  getRateLimit: fn2({
    summary: "read current limiter config.",
    input: z2.any().optional(),
    handler: async (params) => getRateLimit(params)
  }),
  searchByPath: fn2({
    summary: "fetch any zillow URL path (e.g. /seattle-wa/2_p/) and parse.",
    input: z2.any().optional(),
    handler: async (params) => searchByPath(params)
  }),
  searchByText: fn2({
    summary: "search by free-text query (city, ZIP, neighborhood). Hits /homes/{query}_rb/.",
    input: z2.any().optional(),
    handler: async (params) => searchByText(params)
  }),
  setRateLimit: fn2({
    summary: "tune the tab-scoped fetch limiter (default 1 req every ~1s).",
    input: z2.any().optional(),
    handler: async (params) => setRateLimit(params)
  })
});
export {
  zillow_xgs_default as default
};
