// ==XGooseSkill==
// @name        cathay-awards
// @namespace   cx
// @version     0.2.0
// @description Cathay Pacific (CX) award search helper. Builds the redibe deep-link, captures the in-page TAB_ID/ENC, and POSTs Asia Miles availability against book.cathaypacific.com directly.
// @match       *://*.cathaypacific.com/*
// @match       *://book.cathaypacific.com/*
// @match       *://api.cathaypacific.com/*
// @detect      /(^|\.)cathaypacific\.com$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @connect     api.cathaypacific.com
// @primary     bookingUrl
// @keyword     cathay
// @keyword     cathay pacific
// @keyword     CX
// @keyword     asia miles
// @keyword     award
// @keyword     国泰
// @keyword     亚洲万里通
// @keyword     里程票
// ==/XGooseSkill==

/**
 * Cathay Pacific (CX) award search helper. Builds the redibe deep-link, captures the in-page TAB_ID/ENC, and POSTs Asia Miles availability against book.cathaypacific.com directly.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # Cathay Pacific Awards — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object. The skill loads on `*.cathaypacific.com`. **v0.2** ships:
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const LOGIN_URL = "https://www.cathaypacific.com/cx/en_HK/sign-in.html";
const CAPTURE_URL_PATTERN = "https://book.cathaypacific.com/*";
const REDIBE_URL = "https://api.cathaypacific.com/redibe/IBEFacade";
const ENTRY_PAGE = "https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html";
const SIGNIN_US = "https://www.cathaypacific.com/cx/en_US/sign-in.html";
const SEARCH_ENDPOINT = "https://book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability";
const CABIN_TO_SELECTED = {
  Y: "ECO",
  N: "PEY",
  J: "BUS",
  F: "FST"
};
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label, s) {
  if (typeof s !== "string" || !DATE_RX.test(s)) {
    throw new Error(`cathay-awards: ${label} must be 'YYYY-MM-DD' (got ${JSON.stringify(s)})`);
  }
}
__name(assertDate, "assertDate");
function loginUrl() {
  return LOGIN_URL;
}
__name(loginUrl, "loginUrl");
function captureUrl() {
  return CAPTURE_URL_PATTERN;
}
__name(captureUrl, "captureUrl");
function bookingUrl(params) {
  if (!params || typeof params !== "object") {
    throw new Error("cathay-awards.bookingUrl: pass {origin, destination, date, cabin?, adults?, child?, flexibleDate?}");
  }
  if (!params.origin || !params.destination) {
    throw new Error("cathay-awards.bookingUrl: origin and destination are required");
  }
  assertDate("date", params.date);
  const cabin = params.cabin ?? "J";
  const sp = new URLSearchParams();
  sp.set("ACTION", "RED_AWARD_SEARCH");
  sp.set("ENTRYPOINT", ENTRY_PAGE);
  sp.set("ENTRYLANGUAGE", "en");
  sp.set("ENTRYCOUNTRY", "HK");
  sp.set("RETURNURL", ENTRY_PAGE);
  sp.set("ERRORURL", ENTRY_PAGE);
  sp.set("CABINCLASS", cabin);
  sp.set("BRAND", "CX");
  sp.set("ADULT", String(params.adults ?? 1));
  sp.set("CHILD", String(params.child ?? 0));
  sp.set("FLEXIBLEDATE", params.flexibleDate ? "true" : "false");
  sp.set("ORIGIN[1]", params.origin);
  sp.set("DESTINATION[1]", params.destination);
  sp.set("DEPARTUREDATE[1]", params.date.replace(/-/g, ""));
  sp.set("LOGINURL", SIGNIN_US);
  return `${REDIBE_URL}?${sp.toString()}`;
}
__name(bookingUrl, "bookingUrl");
function hasActiveSession() {
  if (typeof window === "undefined") return false;
  const w = window;
  if (!w.requestParams) return false;
  const params = typeof w.requestParams === "string" ? safeParse(w.requestParams) : w.requestParams;
  return typeof params?.TAB_ID === "string" && params.TAB_ID.length > 0;
}
__name(hasActiveSession, "hasActiveSession");
function getRequestParams() {
  if (typeof window === "undefined") return null;
  const w = window;
  if (!w.requestParams) return null;
  const params = typeof w.requestParams === "string" ? safeParse(w.requestParams) : w.requestParams;
  if (!params || typeof params !== "object" || !params.TAB_ID) return null;
  return {
    TAB_ID: String(params.TAB_ID),
    ENC: params.ENC ? String(params.ENC) : void 0,
    SITE: params.SITE ? String(params.SITE) : void 0,
    LANGUAGE: params.LANGUAGE ? String(params.LANGUAGE) : void 0,
    ENTRYCOUNTRY: params.ENTRYCOUNTRY ? String(params.ENTRYCOUNTRY) : void 0,
    ENTRYLANGUAGE: params.ENTRYLANGUAGE ? String(params.ENTRYLANGUAGE) : void 0,
    capturedAt: Date.now(),
    raw: { ...params }
  };
}
__name(getRequestParams, "getRequestParams");
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
__name(safeParse, "safeParse");
function buildSearchBody(rp, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(rp.raw)) {
    if (typeof v === "string") body.set(k, v);
  }
  body.set("TAB_ID", rp.TAB_ID);
  if (rp.ENC) body.set("ENC", rp.ENC);
  body.set("B_DATE_1", `${params.date.replace(/-/g, "")}0000`);
  body.set("B_LOCATION_1", params.origin);
  body.set("E_LOCATION_1", params.destination);
  const cabin = params.cabin ?? "J";
  body.set("CABINCLASS", cabin);
  body.set("SELECTED_CABIN", CABIN_TO_SELECTED[cabin] ?? "BUS");
  body.set("SERVICE_ID", "1");
  body.set("LANGUAGE", rp.LANGUAGE ?? "GB");
  body.set("EMBEDDED_TRANSACTION", "AirAvailabilityServlet");
  body.set("SITE", rp.SITE ?? "CXAWCXAW");
  body.set("ENCT", "2");
  body.set("ENTRYCOUNTRY", rp.ENTRYCOUNTRY ?? "");
  body.set("ENTRYLANGUAGE", rp.ENTRYLANGUAGE ?? "");
  if (typeof params.adults === "number") body.set("NUM_ADT", String(params.adults));
  return body;
}
__name(buildSearchBody, "buildSearchBody");
async function findAwards(params) {
  if (!params || typeof params !== "object") {
    throw new Error("cathay-awards.findAwards: pass {origin, destination, date, cabin?, adults?}");
  }
  if (!params.origin || !params.destination) {
    throw new Error("cathay-awards.findAwards: origin and destination are required");
  }
  assertDate("date", params.date);
  const rp = getRequestParams();
  if (!rp) {
    return {
      status: "requires_session_capture",
      rows: [],
      diagnostic: "window.requestParams not populated. Open bookingUrl(...) in this tab and let CX render the search page once so its JS sets TAB_ID + ENC, then call findAwards again."
    };
  }
  const url = `${SEARCH_ENDPOINT}?TAB_ID=${encodeURIComponent(rp.TAB_ID)}`;
  const body = buildSearchBody(rp, params);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest"
      },
      body: body.toString(),
      redirect: "manual"
    });
  } catch (e) {
    return {
      status: "akamai_blocked",
      rows: [],
      diagnostic: `network error / opaque redirect during CX availability POST: ${String(e?.message ?? e)}. CX often returns an opaque redirect (status 0) when the session/Akamai cookies are stale \u2014 refresh the book.cathaypacific.com tab and retry.`
    };
  }
  if (res.type === "opaqueredirect" || res.status === 0) {
    return {
      status: "session_expired",
      rows: [],
      diagnostic: "opaqueredirect from CX availability POST \u2192 session expired or login required."
    };
  }
  if (res.status === 403 || res.status === 429) {
    return {
      status: "akamai_blocked",
      rows: [],
      diagnostic: `HTTP ${res.status} from CX \u2192 Akamai block. Slow down (\u22653s between calls) or refresh the booking tab.`
    };
  }
  if (res.status === 404) {
    return {
      status: "session_expired",
      rows: [],
      diagnostic: "HTTP 404 \u2192 stale TAB_ID. Re-open bookingUrl() to get a fresh requestParams snapshot."
    };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!json || typeof json !== "object") {
    return {
      status: "no_availability",
      rows: [],
      diagnostic: `non-JSON response from CX (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`
    };
  }
  const rows = parseCxAvailabilityResponse(json, params);
  if (!rows.length) {
    return {
      status: "no_availability",
      rows: [],
      diagnostic: "CX returned an empty itinerary list for this slice."
    };
  }
  return { status: "ok", rows };
}
__name(findAwards, "findAwards");
function parseCxAvailabilityResponse(json, params) {
  const candidates = [];
  const visit = /* @__PURE__ */ __name((node, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const segs = node.segments ?? node.legs ?? node.flightSegments;
    if (Array.isArray(segs) && segs.length && (node.miles != null || node.points != null || node.awardMiles != null || node.cabinClass != null)) {
      candidates.push(node);
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  }, "visit");
  visit(json, 0);
  return candidates.map((c) => normalizeCxItinerary(c, params)).filter((x) => x != null);
}
__name(parseCxAvailabilityResponse, "parseCxAvailabilityResponse");
function normalizeCxItinerary(node, params) {
  const segs = node.segments ?? node.legs ?? node.flightSegments ?? [];
  if (!Array.isArray(segs) || !segs.length) return null;
  const carriers = Array.from(new Set(segs.map((s) => s.carrierCode ?? s.airline ?? s.marketingCarrier).filter(Boolean)));
  const flightNumbers = segs.map((s) => `${s.carrierCode ?? s.airline ?? ""}${s.flightNumber ?? s.flightNo ?? ""}`.trim()).filter(Boolean);
  const route = segs.length ? `${segs[0].origin ?? segs[0].from ?? params.origin}\u2192${segs.map((s) => s.destination ?? s.to).join("\u2192")}` : `${params.origin}\u2192${params.destination}`;
  const depart = String(segs[0]?.depart ?? segs[0]?.departureTime ?? segs[0]?.std ?? "");
  const arrive = String(segs[segs.length - 1]?.arrive ?? segs[segs.length - 1]?.arrivalTime ?? segs[segs.length - 1]?.sta ?? "");
  return {
    date: String(node.date ?? segs[0]?.date ?? params.date),
    route,
    depart,
    arrive,
    durationMinutes: Number(node.durationMinutes ?? node.totalDurationMinutes ?? 0),
    segments: segs.length,
    nonstop: segs.length === 1,
    carriers,
    flightNumbers,
    cabinByLeg: segs.map((s) => s.cabin ?? s.cabinClass ?? params.cabin ?? "J"),
    miles: typeof node.miles === "number" ? node.miles : typeof node.points === "number" ? node.points : typeof node.awardMiles === "number" ? node.awardMiles : null,
    cashTaxes: typeof node.cashTaxes === "number" ? node.cashTaxes : typeof node.taxes === "number" ? node.taxes : null,
    currency: String(node.currency ?? "HKD")
  };
}
__name(normalizeCxItinerary, "normalizeCxItinerary");
function summarizeFlight(rowOrHit) {
  if (rowOrHit && typeof rowOrHit === "object" && "route" in rowOrHit && "durationMinutes" in rowOrHit) {
    return rowOrHit;
  }
  const segs = Array.isArray(rowOrHit?.segments) ? rowOrHit.segments : [];
  const carriers = Array.from(new Set(segs.map((s) => s.carrierCode ?? s.airline).filter(Boolean)));
  const flightNumbers = segs.map((s) => `${s.carrierCode ?? s.airline ?? ""}${s.flightNumber ?? ""}`.trim()).filter(Boolean);
  const route = segs.length ? `${segs[0].origin ?? rowOrHit?.origin}\u2192${segs.map((s) => s.destination).join("\u2192")}` : `${rowOrHit?.origin ?? ""}\u2192${rowOrHit?.destination ?? ""}`;
  return {
    date: String(rowOrHit?.date ?? segs[0]?.date ?? ""),
    route,
    depart: String(rowOrHit?.depart ?? segs[0]?.depart ?? ""),
    arrive: String(rowOrHit?.arrive ?? segs[segs.length - 1]?.arrive ?? ""),
    durationMinutes: Number(rowOrHit?.durationMinutes ?? 0),
    segments: segs.length || 1,
    nonstop: (segs.length || 1) === 1,
    carriers,
    flightNumbers,
    cabinByLeg: segs.map((s) => s.cabin ?? "J"),
    miles: typeof rowOrHit?.miles === "number" ? rowOrHit.miles : null,
    cashTaxes: typeof rowOrHit?.cashTaxes === "number" ? rowOrHit.cashTaxes : null,
    currency: String(rowOrHit?.currency ?? "HKD")
  };
}
__name(summarizeFlight, "summarizeFlight");

export default defineSkill({
  bookingUrl: fn({
    summary: "★ CX redibe deep-link with origin/dest/date pre-filled.",
    input: z.any().optional(),
    handler: async (params) => bookingUrl(params),
  }),
  captureUrl: fn({
    summary: "the URL pattern that drives tab discovery.",
    input: z.any().optional(),
    handler: async (params) => captureUrl(params),
  }),
  findAwards: fn({
    summary: "★ POSTs availability with the captured session — guessed shape, will degrade gracefully.",
    input: z.any().optional(),
    handler: async (params) => findAwards(params),
  }),
  getRequestParams: fn({
    summary: "exposes the captured TAB_ID/ENC for downstream use.",
    input: z.any().optional(),
    handler: async (params) => getRequestParams(params),
  }),
  hasActiveSession: fn({
    summary: "true if window.requestParams.TAB_ID is populated.",
    input: z.any().optional(),
    handler: async (params) => hasActiveSession(params),
  }),
  loginUrl: fn({
    summary: "canonical sign-in URL.",
    input: z.any().optional(),
    handler: async (params) => loginUrl(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic helper.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
});

