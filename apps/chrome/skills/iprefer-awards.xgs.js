// ==XGooseSkill==
// @name        iprefer-awards
// @namespace   iprefer
// @version     0.1.1
// @description I Prefer Hotel Rewards property discovery + indicative pricing. Cross-origin scraper for `ptgapis.com/rate-fetch/v2`. NO date-specific availability — iPrefer's public API only returns "from" rates. Run on iprefer.com.
// @match       *://iprefer.com/*
// @match       *://www.iprefer.com/*
// @detect      /(^|\.)iprefer\.com$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @connect     ptgapis.com
// @primary     getRates
// @keyword     iprefer
// @keyword     i prefer
// @keyword     preferred hotels
// @keyword     preferred hotels and resorts
// @keyword     preferred
// @keyword     PHR
// @keyword     preferred legend
// @keyword     preferred lvx
// @keyword     preferred residences
// @keyword     璞富腾
// @keyword     hotel rewards
// ==/XGooseSkill==

/**
 * I Prefer Hotel Rewards property discovery + indicative pricing. Cross-origin scraper for `ptgapis.com/rate-fetch/v2`. NO date-specific availability — iPrefer's public API only returns "from" rates. Run on iprefer.com.
 *
 * Every public function takes a single options object. Rates and the
 * catalog return JSON objects keyed by property code and name respectively.
 * # I Prefer Hotel Rewards — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a **single options object**.
 * The skill loads on `iprefer.com` and calls `ptgapis.com/rate-fetch/v2` cross-origin. **iPrefer is structurally different from the other hotel skills**:
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const PTG_HOST = "https://ptgapis.com";
const RATE_FETCH_URL = `${PTG_HOST}/rate-fetch/v2`;
const POI_SEARCH_URL = `${PTG_HOST}/poi-search/v2`;
const PROPERTY_SEARCH_URL = `${PTG_HOST}/property-search/v1?site=IPrefer`;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label, s) {
  if (typeof s !== "string" || !DATE_RX.test(s)) {
    throw new Error(`iprefer-awards: ${label} must be 'YYYY-MM-DD' (got ${JSON.stringify(s)})`);
  }
}
__name(assertDate, "assertDate");
const sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
async function getJson(url, retries) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-cache"
      });
      const bodyText = await r.text();
      let json = null;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = null;
      }
      if (r.status === 200 && json) return { status: 200, json, bodyText };
      lastErr = { status: r.status, json, bodyText };
    } catch (e) {
      lastErr = { status: 0, json: null, bodyText: e?.message ?? String(e) };
    }
    if (attempt < retries) {
      await sleep([400, 1500][Math.min(attempt, 1)]);
    }
  }
  return lastErr ?? { status: 0, json: null, bodyText: "unknown error" };
}
__name(getJson, "getJson");
async function postJson(url, body, retries) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const bodyText = await r.text();
      let json = null;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = null;
      }
      if (r.status === 200 && json) return { status: 200, json, bodyText };
      lastErr = { status: r.status, json, bodyText };
    } catch (e) {
      lastErr = { status: 0, json: null, bodyText: e?.message ?? String(e) };
    }
    if (attempt < retries) {
      await sleep([400, 1500][Math.min(attempt, 1)]);
    }
  }
  return lastErr ?? { status: 0, json: null, bodyText: "unknown error" };
}
__name(postJson, "postJson");
function nz(v) {
  return typeof v === "number" && v > 0 ? v : null;
}
__name(nz, "nz");
function moneyOrNull(v) {
  return typeof v === "number" && v > 0 ? v : null;
}
__name(moneyOrNull, "moneyOrNull");
function summarizeProperty(rate, code, name = null) {
  if (!rate || typeof rate !== "object") {
    return {
      propertyCode: code.toUpperCase(),
      propertyName: name,
      isAvailable: false,
      cashFromUsd: null,
      cashTaxUsd: null,
      rewardNightPoints: null,
      rewardNightPlus: null,
      currency: "USD"
    };
  }
  const cash = moneyOrNull(rate.lowest_rate);
  const tax = typeof rate.tax === "number" ? rate.tax : null;
  const rn = rate.reward_nights;
  const rnPoints = rn && rn.is_available ? nz(rn.lowest_points) : null;
  const rnp = rate.reward_nights_plus;
  let rewardNightPlus = null;
  if (rnp && rnp.is_available) {
    const pts = nz(rnp.lowest_points);
    const cashUsd = moneyOrNull(rnp.lowest_rate);
    if (pts != null && cashUsd != null) {
      rewardNightPlus = { points: pts, cashUsd };
    }
  }
  return {
    propertyCode: code.toUpperCase(),
    propertyName: name,
    isAvailable: rate.is_available !== false,
    cashFromUsd: cash,
    cashTaxUsd: tax,
    rewardNightPoints: rnPoints,
    rewardNightPlus,
    currency: "USD"
  };
}
__name(summarizeProperty, "summarizeProperty");
async function getRates(params) {
  if (!params || typeof params !== "object") {
    throw new Error("iprefer-awards.getRates: pass a single options object {propertyCodes: [...]}");
  }
  if (!Array.isArray(params.propertyCodes) || params.propertyCodes.length === 0) {
    throw new Error("iprefer-awards.getRates: propertyCodes must be a non-empty string array");
  }
  const codes = params.propertyCodes.map((c) => String(c).toUpperCase());
  const retries = Math.max(0, params.retries ?? 2);
  const url = `${RATE_FETCH_URL}?propertyCodes=${encodeURIComponent(JSON.stringify(codes))}`;
  const { status, json, bodyText } = await getJson(url, retries);
  if (status !== 200 || !json?.results) {
    throw new Error(`iprefer-awards.getRates: HTTP ${status} \u2014 ${bodyText.slice(0, 200)}`);
  }
  return Object.fromEntries(codes.map(code => [code, summarizeProperty(json.results[code], code)]));
}
__name(getRates, "getRates");
async function searchDestinations(params) {
  if (!params || typeof params !== "object") {
    throw new Error("iprefer-awards.searchDestinations: pass {query: '...'}");
  }
  if (!params.query || typeof params.query !== "string") {
    throw new Error("iprefer-awards.searchDestinations: query is required");
  }
  const language = params.language ?? "en";
  const retries = Math.max(0, params.retries ?? 1);
  const url = `${POI_SEARCH_URL}?site=IPrefer&search=${encodeURIComponent(params.query)}&language=${encodeURIComponent(language)}`;
  const { status, json, bodyText } = await getJson(url, retries);
  if (status !== 200) {
    throw new Error(`iprefer-awards.searchDestinations: HTTP ${status} \u2014 ${bodyText.slice(0, 200)}`);
  }
  const results = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : [];
  return results.filter((r) => r && (r.id || r.nid || r.name)).map((r) => ({
    id: String(r.id ?? r.nid ?? ""),
    name: String(r.name ?? r.title ?? r.field_display_title ?? "").trim(),
    type: String(r.type ?? r.bundle ?? "destination"),
    latitude: typeof r.latitude === "number" ? r.latitude : void 0,
    longitude: typeof r.longitude === "number" ? r.longitude : void 0,
    ...r
  }));
}
__name(searchDestinations, "searchDestinations");
let catalogCache = null;
let catalogPromise = null;
async function getCatalog() {
  if (catalogCache) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const body = {
      field_item_code: {},
      field_display_title: {},
      changed: {}
    };
    const { status, json } = await postJson(PROPERTY_SEARCH_URL, body, 2);
    if (status !== 200 || !json?.properties) {
      catalogPromise = null;
      throw new Error(`iprefer-awards.getCatalog: HTTP ${status}`);
    }
    const map = /* @__PURE__ */ new Map();
    for (const p of Object.values(json.properties)) {
      const name = String(p?.field_display_title ?? "").trim();
      const code = String(p?.field_item_code ?? "").trim();
      if (name && code) map.set(name, code.toUpperCase());
    }
    catalogCache = Object.fromEntries(map);
    catalogPromise = null;
    return catalogCache;
  })();
  return catalogPromise;
}
__name(getCatalog, "getCatalog");
function filterProperties(items, filters) {
  if (!filters) return items.slice();
  return items.filter((p) => {
    if (!p.isAvailable) return false;
    if (filters.cashOnly && p.cashFromUsd == null) return false;
    if (filters.pointsOnly && p.rewardNightPoints == null) return false;
    if (filters.pointsPlusOnly && p.rewardNightPlus == null) return false;
    if (filters.maxCashUsd != null && (p.cashFromUsd == null || p.cashFromUsd > filters.maxCashUsd)) return false;
    if (filters.maxPoints != null && (p.rewardNightPoints == null || p.rewardNightPoints > filters.maxPoints)) return false;
    return true;
  });
}
__name(filterProperties, "filterProperties");
function bookingUrl(propertyCode, opts = {}) {
  if (!propertyCode) throw new Error("iprefer-awards.bookingUrl: propertyCode is required");
  if (opts.checkInDate) assertDate("checkInDate", opts.checkInDate);
  if (opts.checkOutDate) assertDate("checkOutDate", opts.checkOutDate);
  const params = new URLSearchParams();
  if (opts.checkInDate) params.set("checkInDate", opts.checkInDate);
  if (opts.checkOutDate) params.set("checkOutDate", opts.checkOutDate);
  params.set("adults", String(opts.adults ?? 1));
  params.set("children", String(opts.children ?? 0));
  params.set("rooms", String(opts.rooms ?? 1));
  if (opts.rateType) params.set("rateType", opts.rateType);
  return `https://iprefer.com/hotels/${propertyCode.toLowerCase()}?${params.toString()}`;
}
__name(bookingUrl, "bookingUrl");

export default defineSkill({
  bookingUrl: fn({
    summary: "Build iprefer.com property URL from propertyCode and optional dates/occupancy.",
    input: z.object({
      propertyCode: z.string().min(1),
      checkInDate: z.string().regex(DATE_RX).optional(),
      checkOutDate: z.string().regex(DATE_RX).optional(),
      adults: z.number().int().positive().optional(),
      children: z.number().int().nonnegative().optional(),
      rooms: z.number().int().positive().optional(),
      rateType: z.string().optional(),
    }),
    handler: async ({propertyCode, ...opts}) => bookingUrl(propertyCode, opts),
  }),
  filterProperties: fn({
    summary: "Filter {items, filters}; items is Object.values(getRates(...)). Returns PropertySummary[].",
    input: z.object({
      items: z.array(z.record(z.unknown())),
      filters: z.object({
        cashOnly: z.boolean().optional(),
        pointsOnly: z.boolean().optional(),
        pointsPlusOnly: z.boolean().optional(),
        maxCashUsd: z.number().nonnegative().optional(),
        maxPoints: z.number().nonnegative().optional(),
      }).optional(),
    }),
    handler: async ({items, filters}) => filterProperties(items, filters),
  }),
  getCatalog: fn({
    summary: "Cached JSON object keyed by property name, with propertyCode values.",
    input: z.object({}),
    handler: async () => getCatalog(),
  }),
  getRates: fn({
    summary: "★ main entry. Returns a JSON object keyed by propertyCode with indicative 'from' cash + points.",
    input: z.object({propertyCodes: z.array(z.string().min(1)).min(1), retries: z.number().int().nonnegative().optional()}),
    handler: async (params) => getRates(params),
  }),
  searchDestinations: fn({
    summary: "POI search by query string.",
    input: z.object({query: z.string().min(1), language: z.string().optional(), retries: z.number().int().nonnegative().optional()}),
    handler: async (params) => searchDestinations(params),
  }),
  summarizeProperty: fn({
    summary: "Normalize {rate, code, name?}; rate is one native rate-fetch entry, code is its property code.",
    input: z.object({rate: z.record(z.unknown()).nullish(), code: z.string().min(1), name: z.string().nullable().optional()}),
    handler: async ({rate, code, name}) => summarizeProperty(rate, code, name),
  }),
});

