// ==XGooseSkill==
// @name        jal-awards
// @namespace   jal
// @version     0.1.1
// @description Japan Airlines (JAL) award search helper. Booking landing URL + session detection; real search is gated until a live capture is done.
// @match       *://www.jal.co.jp/*
// @match       *://book-i.jal.co.jp/*
// @detect      /(^|\.)jal\.co\.jp$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @primary     bookingUrl
// @keyword     jal
// @keyword     japan airlines
// @keyword     JL
// @keyword     JMB
// @keyword     Mileage Bank
// @keyword     日航
// @keyword     日本航空
// @keyword     里程票
// @keyword     award
// ==/XGooseSkill==

/**
 * Japan Airlines (JAL) award search helper. Booking landing URL + session detection; real search is gated until a live capture is done.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # JAL Awards — Schema Reference
 * > **Read this BEFORE calling any function.** The skill loads on `*.jal.co.jp` (including `book-i.jal.co.jp`). **v0.1 is partial:** the booking-landing URL + session detection work; real search via `book-i.jal.co.jp/JLInt/dyn/air/booking/*` requires a captured login + session and is gated as `status: 'requires_session_capture'`. The intended flow today: send the user to `bookingUrl()` and let them search manually. JAL aggressively rate-limits award POSTs (HTTP 403 after burst); a v0.2 should mirror back-off (2s / 4s / 6s).
 * ## Common types
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const LOGIN_URL = "https://www.jal.co.jp/jp/en/inter/";
const CAPTURE_URL_PATTERN = "https://book-i.jal.co.jp/JLInt/dyn/air/booking/*";
const BOOKING_URL = "https://www.jal.co.jp/jp/en/inter/award/";
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
  return location.hostname === "book-i.jal.co.jp" && /^\/JLInt\/dyn\/air\/booking\//.test(location.pathname);
}
__name(hasActiveSession, "hasActiveSession");
async function findAwards(_params) {
  return {
    status: "requires_session_capture",
    rows: [],
    diagnostic: "JAL award search not implemented in v0.1. The endpoint is live at book-i.jal.co.jp/JLInt/dyn/air/booking/* but the POST shape carries a session-bound state we have not captured. Send the user to bookingUrl() to perform the search themselves. JAL aggressively rate-limits award POSTs (HTTP 403 after burst); a future v0.2 should mirror that backoff (2s/4s/6s)."
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
    currency: String(rowOrHit?.currency ?? "JPY")
  };
}
__name(summarizeFlight, "summarizeFlight");

export default defineSkill({
  bookingUrl: fn({
    summary: "★ JAL international award landing.",
    input: z.any().optional(),
    handler: async (params) => bookingUrl(params),
  }),
  captureUrl: fn({
    summary: "the URL pattern for the JLInt booking app.",
    input: z.any().optional(),
    handler: async (params) => captureUrl(params),
  }),
  findAwards: fn({
    summary: "returns status:'requires_session_capture' until a live JLInt capture is done.",
    input: z.any().optional(),
    handler: async (params) => findAwards(params),
  }),
  hasActiveSession: fn({
    summary: "true if the user is on book-i.jal.co.jp/JLInt/*.",
    input: z.any().optional(),
    handler: async (params) => hasActiveSession(params),
  }),
  loginUrl: fn({
    summary: "JMB login URL.",
    input: z.any().optional(),
    handler: async (params) => loginUrl(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic helper.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
});

