// ==XGooseSkill==
// @name        eva-awards
// @namespace   eva
// @version     0.1.0
// @description EVA Air (BR) award search helper. Booking landing URL + session detection; real ASPX search is gated until a live capture is done.
// @match       *://booking.evaair.com/*
// @match       *://www.evaair.com/*
// @detect      /(^|\.)evaair\.com$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @primary     bookingUrl
// @keyword     eva
// @keyword     EVA Air
// @keyword     BR
// @keyword     Infinity MileageLands
// @keyword     长荣
// @keyword     里程票
// @keyword     award
// ==/XGooseSkill==

/**
 * EVA Air (BR) award search helper. Booking landing URL + session detection; real ASPX search is gated until a live capture is done.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # EVA Air Awards — Schema Reference
 * > **Read this BEFORE calling any function.** The skill loads on `*.evaair.com`. **v0.1 is partial:** the booking landing URL + session detection work; the actual ASPX form POST is `__VIEWSTATE`-protected ASP.NET that requires an Infinity MileageLands login, which we have not captured live. `findAwards()` returns `status: 'requires_session_capture'`. The intended flow today: send the user to `bookingUrl()` and let them search manually.
 * ## Common types
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const LOGIN_URL = "https://booking.evaair.com/flyeva/eva/b2c/plan-your-journey/award-upgrade-availability/login.aspx?lang=en-us";
const CAPTURE_URL_PATTERN = "https://booking.evaair.com/flyeva/EVA/B2C/plan-your-journey/award-upgrade-availability/award-upgrade-availability.aspx*";
const BOOKING_URL = "https://booking.evaair.com/flyeva/EVA/B2C/plan-your-journey/award-upgrade-availability/award-upgrade-availability.aspx";
function loginUrl() {
  return LOGIN_URL;
}
__name(loginUrl, "loginUrl");
function captureUrl() {
  return CAPTURE_URL_PATTERN;
}
__name(captureUrl, "captureUrl");
function bookingUrl() {
  return BOOKING_URL;
}
__name(bookingUrl, "bookingUrl");
function hasActiveSession() {
  if (typeof location === "undefined") return false;
  return location.hostname === "booking.evaair.com" && /award-upgrade-availability\.aspx$/i.test(location.pathname);
}
__name(hasActiveSession, "hasActiveSession");
async function findAwards(_params) {
  return {
    status: "requires_session_capture",
    rows: [],
    diagnostic: "EVA award search not implemented in v0.1. The ASPX form POST is `__VIEWSTATE`-protected ASP.NET that requires a logged-in Infinity MileageLands session and we have not captured the round-trip live. Send the user to bookingUrl() to perform the search themselves."
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
    summary: "★ EVA award-upgrade-availability ASPX landing.",
    input: z.any().optional(),
    handler: async (params) => bookingUrl(params),
  }),
  captureUrl: fn({
    summary: "the URL pattern this skill activates on.",
    input: z.any().optional(),
    handler: async (params) => captureUrl(params),
  }),
  findAwards: fn({
    summary: "returns status:'requires_session_capture' until a live ASPX capture is done.",
    input: z.any().optional(),
    handler: async (params) => findAwards(params),
  }),
  hasActiveSession: fn({
    summary: "true if user is on the award-upgrade-availability ASPX.",
    input: z.any().optional(),
    handler: async (params) => hasActiveSession(params),
  }),
  loginUrl: fn({
    summary: "Infinity MileageLands login.",
    input: z.any().optional(),
    handler: async (params) => loginUrl(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic helper.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
});

