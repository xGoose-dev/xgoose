// ==XGooseSkill==
// @name        ana-awards
// @namespace   ana
// @version     0.1.0
// @description ANA award search helper. Booking URL builder + multi-city form helpers (uscardforum #491401). Real award search is gated until a live session capture is done.
// @match       *://aswbe-i.ana.co.jp/*
// @match       *://www.ana.co.jp/*
// @detect      /(^|\.)ana\.co\.jp$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @primary     bookingUrl
// @keyword     ana
// @keyword     all nippon airways
// @keyword     全日空
// @keyword     miles
// @keyword     award
// @keyword     里程票
// @keyword     aswbe
// @keyword     japan award
// ==/XGooseSkill==

/**
 * ANA award search helper. Booking URL builder + multi-city form helpers (uscardforum #491401). Real award search is gated until a live session capture is done.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # ANA Awards — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object (or none). The skill loads on `aswbe-i.ana.co.jp` and `www.ana.co.jp`. **v0.1 is partial:** booking URL + multi-city form helpers (lifted from uscardforum #491401 by Xmsley) are functional and useful immediately. `findAwards()` returns `status: 'requires_session_capture'` because ANA's award POST is a JSF/MyFaces AJAX call carrying a session-bound ViewState that we have not captured live; without it we cannot drive the search reliably. The intended flow today: pre-fill the form via `bookingUrl()` + `writeMultiCityForm()`, then ask the user to click Search themselves.
 * ## Common types
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const LOGIN_URL = "https://aswbe-i.ana.co.jp/rei21d/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml";
const CAPTURE_URL_PATTERN = "https://aswbe-i.ana.co.jp/*";
const SEARCH_PATH_RX = /award_search_roundtrip_input\.xhtml/i;
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
  sp.set("LANG", params.lang === "jp" ? "jp" : "en");
  if (params.connectionKind) sp.set("CONNECTION_KIND", params.connectionKind);
  return `https://aswbe-i.ana.co.jp/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml?${sp.toString()}`;
}
__name(bookingUrl, "bookingUrl");
function hasActiveSession() {
  if (typeof location === "undefined") return false;
  return SEARCH_PATH_RX.test(location.pathname) && document.querySelector("form input, form select") != null;
}
__name(hasActiveSession, "hasActiveSession");
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label, s) {
  if (typeof s !== "string" || !DATE_RX.test(s)) {
    throw new Error(`ana-awards: ${label} must be 'YYYY-MM-DD' (got ${JSON.stringify(s)})`);
  }
}
__name(assertDate, "assertDate");
function findLegInputs() {
  const fromInputs = Array.from(document.querySelectorAll('input[id*="airportFromCode"], input[name*="airportFromCode"]'));
  const toInputs = Array.from(document.querySelectorAll('input[id*="airportToCode"], input[name*="airportToCode"]'));
  const dateInputs = Array.from(document.querySelectorAll('input[id*="depDate"], input[name*="depDate"]'));
  const n = Math.min(fromInputs.length, toInputs.length, dateInputs.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ origin: fromInputs[i], destination: toInputs[i], date: dateInputs[i] });
  return out;
}
__name(findLegInputs, "findLegInputs");
function readField(el) {
  return el ? (el.value ?? "").trim() : "";
}
__name(readField, "readField");
function readMultiCityForm() {
  const inputs = findLegInputs();
  const legs = [];
  for (const row of inputs) {
    const origin = readField(row.origin);
    const destination = readField(row.destination);
    const date = readField(row.date);
    if (!origin && !destination && !date) continue;
    legs.push({ origin, destination, date });
  }
  return legs;
}
__name(readMultiCityForm, "readMultiCityForm");
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
__name(setNativeValue, "setNativeValue");
async function writeMultiCityForm(params) {
  if (!params || !Array.isArray(params.legs)) {
    throw new Error("ana-awards.writeMultiCityForm: pass {legs: MultiCityLeg[], autoSort?: boolean}");
  }
  for (const l of params.legs) assertDate("leg.date", l.date);
  const sorted = params.autoSort === false ? params.legs.slice() : params.legs.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length > 8) {
    return { ok: false, legs: [], diagnostic: "ANA multi-city supports at most 8 legs; got " + sorted.length };
  }
  const inputs = findLegInputs();
  if (!inputs.length) {
    return { ok: false, legs: [], diagnostic: "multi-city form not found in DOM; navigate to bookingUrl() first and wait for load" };
  }
  const writable = Math.min(inputs.length, sorted.length);
  for (let i = 0; i < writable; i++) {
    setNativeValue(inputs[i].origin, sorted[i].origin);
    setNativeValue(inputs[i].destination, sorted[i].destination);
    setNativeValue(inputs[i].date, sorted[i].date);
  }
  return { ok: true, legs: sorted.slice(0, writable) };
}
__name(writeMultiCityForm, "writeMultiCityForm");
async function findAwards(_params) {
  return {
    status: "requires_session_capture",
    rows: [],
    diagnostic: "ANA award search not implemented in v0.1. The award POST is a JSF/MyFaces AJAX call carrying a session-bound ViewState that we have not captured live; without it we cannot drive the search reliably. Use bookingUrl() + writeMultiCityForm() to pre-fill the form, then ask the user to click Search themselves."
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
    summary: "★ returns the ANA award input page; pre-fills via form helpers.",
    input: z.any().optional(),
    handler: async (params) => bookingUrl(params),
  }),
  captureUrl: fn({
    summary: "the URL pattern the skill activates on.",
    input: z.any().optional(),
    handler: async (params) => captureUrl(params),
  }),
  findAwards: fn({
    summary: "returns status:'requires_session_capture' until a live JSF capture is done.",
    input: z.any().optional(),
    handler: async (params) => findAwards(params),
  }),
  hasActiveSession: fn({
    summary: "heuristic: are we on aswbe-i with a usable form?",
    input: z.any().optional(),
    handler: async (params) => hasActiveSession(params),
  }),
  loginUrl: fn({
    summary: "canonical award search input URL.",
    input: z.any().optional(),
    handler: async (params) => loginUrl(params),
  }),
  readMultiCityForm: fn({
    summary: "read the on-page multi-city form (form helper).",
    input: z.any().optional(),
    handler: async (params) => readMultiCityForm(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic helper.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
  writeMultiCityForm: fn({
    summary: "populate + auto-sort the multi-city form (form helper).",
    input: z.any().optional(),
    handler: async (params) => writeMultiCityForm(params),
  }),
});

