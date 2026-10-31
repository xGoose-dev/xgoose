// ==XGooseSkill==
// @name        china-airlines-awards
// @namespace   ci
// @version     0.1.0
// @description China Airlines (CI / Dynasty Flyer) award search helper. Booking URL + session helpers; real search is gated until a live session capture is done.
// @match       *://membersonair.china-airlines.com/*
// @match       *://www.china-airlines.com/*
// @detect      /china-airlines\.com$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @primary     bookingUrl
// @keyword     china airlines
// @keyword     CI
// @keyword     Dynasty Flyer
// @keyword     中華航空
// @keyword     中华航空
// @keyword     華航
// @keyword     华航
// @keyword     里程票
// @keyword     award
// ==/XGooseSkill==

/**
 * China Airlines (CI / Dynasty Flyer) award search helper. Booking URL + session helpers; real search is gated until a live session capture is done.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # China Airlines Awards — Schema Reference
 * > **Read this BEFORE calling any function.** The skill loads on `*.china-airlines.com`. **v0.1 is partial:** the booking-search URL + session detection work; the actual search POST against `membersonair.china-airlines.com/AwardTicketSeat/*` is a Dynasty-Flyer-login-gated server-rendered postback that we have not captured live, so `findAwards()` returns `status: 'requires_session_capture'`. The intended flow today: send the user to `bookingUrl()` and let them search manually.
 * ## Common types
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const LOGIN_URL = "https://www.china-airlines.com/en-global/member/login";
const CAPTURE_URL_PATTERN = "https://membersonair.china-airlines.com/AwardTicketSeat/SeatInquiry/Index*";
const SEARCH_BASE = "https://membersonair.china-airlines.com/AwardTicketSeat/SeatInquiry/Index";
function loginUrl() {
  return LOGIN_URL;
}
__name(loginUrl, "loginUrl");
function captureUrl() {
  return CAPTURE_URL_PATTERN;
}
__name(captureUrl, "captureUrl");
function bookingUrl(params = {}) {
  const sp = new URLSearchParams();
  sp.set("lang", params.lang ?? "en-US");
  sp.set("programCode", params.programCode ?? "individual");
  return `${SEARCH_BASE}?${sp.toString()}`;
}
__name(bookingUrl, "bookingUrl");
function hasActiveSession() {
  if (typeof location === "undefined") return false;
  return location.hostname === "membersonair.china-airlines.com" && /^\/AwardTicketSeat\/SeatInquiry\/Index/i.test(location.pathname);
}
__name(hasActiveSession, "hasActiveSession");
async function findAwards(_params) {
  return {
    status: "requires_session_capture",
    rows: [],
    diagnostic: "CI (China Airlines) award search not implemented in v0.1. The search is a server-rendered postback against `membersonair.china-airlines.com` that we have not captured live; without the form-action + hidden-field shape we cannot drive it reliably. Send the user to bookingUrl() to perform the search themselves."
  };
}
__name(findAwards, "findAwards");
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
    cabinByLeg: segs.map((s) => s.cabin ?? "Y"),
    miles: typeof rowOrHit?.miles === "number" ? rowOrHit.miles : null,
    cashTaxes: typeof rowOrHit?.cashTaxes === "number" ? rowOrHit.cashTaxes : null,
    currency: String(rowOrHit?.currency ?? "TWD")
  };
}
__name(summarizeFlight, "summarizeFlight");

export default defineSkill({
  bookingUrl: fn({
    summary: "★ China Airlines AwardTicketSeat search URL.",
    input: z.any().optional(),
    handler: async (params) => bookingUrl(params),
  }),
  captureUrl: fn({
    summary: "the URL pattern this skill activates on.",
    input: z.any().optional(),
    handler: async (params) => captureUrl(params),
  }),
  findAwards: fn({
    summary: "returns status:'requires_session_capture' until a live postback capture is done.",
    input: z.any().optional(),
    handler: async (params) => findAwards(params),
  }),
  hasActiveSession: fn({
    summary: "true if user is on the AwardTicketSeat search page.",
    input: z.any().optional(),
    handler: async (params) => hasActiveSession(params),
  }),
  loginUrl: fn({
    summary: "Dynasty Flyer login.",
    input: z.any().optional(),
    handler: async (params) => loginUrl(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic helper.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
});

