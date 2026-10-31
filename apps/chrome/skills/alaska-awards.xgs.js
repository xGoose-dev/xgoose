// ==XGooseSkill==
// @name        alaska-awards
// @namespace   alaska
// @version     0.4.1
// @description Alaska Airlines award/cash flight search. Programmatic equivalent of the AS Enhancer + AS Batch Award Search userscripts (uscardforum topic 492786). Run on www.alaskaair.com.
// @match       *://www.alaskaair.com/*
// @detect      location.hostname === 'www.alaskaair.com'
// @run-at      document_idle
// @connect     <self>
// @primary     findAwards
// @keyword     alaska
// @keyword     AS
// @keyword     AS Enhancer
// @keyword     AS Batch Search
// @keyword     award
// @keyword     miles
// @keyword     redemption
// @keyword     里程票
// @keyword     兑换
// @keyword     alaskaair
// @keyword     搜票
// ==/XGooseSkill==

// SvelteKit results + calendar access, following AS Enhancer's native API discovery:
// https://gist.github.com/AhaiMk01/f80d8e70fd112be6a83a948ce5d45122
// https://www.uscardforum.com/t/topic/492786

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const PAST_MS = 864e5;
function adultsOf(p) {
  return p.adults ?? 1;
}
__name(adultsOf, "adultsOf");
function numPos(v) {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : void 0;
}
__name(numPos, "numPos");
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
__name(pad2, "pad2");
function parseDate(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}
__name(parseDate, "parseDate");
function formatDate(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
__name(formatDate, "formatDate");
function enumerateDateRange(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e || e < s) return [];
  const out = [];
  for (let t = s.getTime(); t <= e.getTime(); t += PAST_MS) out.push(formatDate(new Date(t)));
  return out;
}
__name(enumerateDateRange, "enumerateDateRange");
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
__name(daysInMonth, "daysInMonth");
function coerceHour(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const m = v.match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
}
__name(coerceHour, "coerceHour");
async function runWithConcurrency(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) return;
      out[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return out;
}
__name(runWithConcurrency, "runWithConcurrency");
function emptyDrops() {
  return {
    nonstopOnly: 0,
    depAfter: 0,
    depBefore: 0,
    arriveAfter: 0,
    arriveBefore: 0,
    carriers: 0,
    excludeCarriers: 0,
    maxDurationMinutes: 0,
    maxLayoverMinutes: 0,
    minSeats: 0,
    bookingCodes: 0,
    noMixedCabin: 0,
    maxCash: 0,
    maxMiles: 0
  };
}
__name(emptyDrops, "emptyDrops");
function mergeDrops(into, from) {
  for (const k of Object.keys(into)) into[k] += from[k];
}
__name(mergeDrops, "mergeDrops");
function sortFlights(a, b) {
  return (a.date ?? "").localeCompare(b.date ?? "") || a.depart.localeCompare(b.depart);
}
__name(sortFlights, "sortFlights");
function devalueRevive(data) {
  if (!Array.isArray(data)) return data;
  const cache = /* @__PURE__ */ new Map();
  function r(i) {
    if (typeof i !== "number") return i;
    if (i < 0) {
      if (i === -1) return void 0;
      if (i === -2) return NaN;
      if (i === -3) return Infinity;
      if (i === -4) return -Infinity;
      return void 0;
    }
    if (cache.has(i)) return cache.get(i);
    const v = data[i];
    if (v === null || typeof v !== "object") {
      cache.set(i, v);
      return v;
    }
    if (Array.isArray(v)) {
      const a = [];
      cache.set(i, a);
      for (const j of v) a.push(r(j));
      return a;
    }
    const o = {};
    cache.set(i, o);
    for (const [k, j] of Object.entries(v)) o[k] = r(j);
    return o;
  }
  __name(r, "r");
  return r(0);
}
__name(devalueRevive, "devalueRevive");
function buildSearchUrl(p, asJson = false) {
  const sp = new URLSearchParams();
  sp.set("O", p.from);
  sp.set("D", p.to);
  sp.set("OD", p.date);
  sp.set("A", String(adultsOf(p)));
  if (p.mode !== "cash") sp.set("ShoppingMethod", "onlineaward");
  return `https://www.alaskaair.com/search/results${asJson ? "/__data.json" : ""}?${sp}`;
}
__name(buildSearchUrl, "buildSearchUrl");
function findRowsInDecoded(decoded) {
  if (!decoded || typeof decoded !== "object") return null;
  if (Array.isArray(decoded.rows)) return decoded.rows;
  for (const v of Object.values(decoded)) {
    if (v && typeof v === "object" && Array.isArray(v.rows)) return v.rows;
  }
  return null;
}
__name(findRowsInDecoded, "findRowsInDecoded");
function parseAsDataResponse(text) {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj?.type === "redirect") {
      return { rows: [], status: "redirect", redirectLocation: String(obj.location ?? "") };
    }
    const candidates = [];
    if (obj?.type === "chunk" && Array.isArray(obj.data)) candidates.push(obj.data);
    if (obj?.type === "data" && Array.isArray(obj.nodes)) {
      for (const n of obj.nodes) {
        if (n?.type === "data" && Array.isArray(n.data)) candidates.push(n.data);
      }
    }
    for (const c of candidates) {
      let decoded;
      try {
        decoded = devalueRevive(c);
      } catch {
        continue;
      }
      const rows = findRowsInDecoded(decoded);
      if (rows) return { rows, status: "ok" };
    }
  }
  return { rows: [], status: "empty" };
}
__name(parseAsDataResponse, "parseAsDataResponse");
const FLIGHT_FILTER_KEYS = [
  "nonstopOnly",
  "depAfter",
  "depBefore",
  "arriveAfter",
  "arriveBefore",
  "carriers",
  "excludeCarriers",
  "maxDurationMinutes",
  "maxLayoverMinutes",
  "minSeats",
  "bookingCodes",
  "noMixedCabin",
  "maxMiles",
  "maxCash"
];
function validateParams(fnName, p, required, allowed) {
  if (!p || typeof p !== "object") {
    throw new Error(
      `${fnName}: expected an options object, got ${typeof p}. Call as ${fnName}({ ${required.join(", ")} }).`
    );
  }
  const missing = required.filter((k) => p[k] == null || p[k] === "");
  if (missing.length) {
    throw new Error(
      `${fnName}: missing required option(s) ${missing.map((k) => `\`${String(k)}\``).join(", ")}. Got keys: [${Object.keys(p).join(", ")}]. See SKILL.md for schema.`
    );
  }
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(p).filter((k) => !allowedSet.has(k));
  if (unknown.length) {
    throw new Error(
      `${fnName}: unknown option(s) ${unknown.map((k) => `\`${k}\``).join(", ")}. Allowed: [${allowed.join(", ")}]. See SKILL.md for schema.`
    );
  }
}
__name(validateParams, "validateParams");
const ROUTE_DATE_KEYS = ["from", "to", "date", "adults", "mode"];
async function searchAwardsRaw(p) {
  validateParams("searchAwardsRaw", p, ["from", "to", "date"], ROUTE_DATE_KEYS);
  const url = buildSearchUrl(p, true);
  const r = await fetch(url, { credentials: "include", cache: "no-cache" });
  if (!r.ok) throw new Error(`AS search HTTP ${r.status}: ${p.from}-${p.to} ${p.date}`);
  return parseAsDataResponse(await r.text());
}
__name(searchAwardsRaw, "searchAwardsRaw");
async function searchAwards(p) {
  return (await searchAwardsRaw(p)).rows;
}
__name(searchAwards, "searchAwards");
const CABIN_TO_BUCKET = {
  COACH: "main",
  MAIN: "main",
  ECONOMY: "main",
  PREMIUM: "main",
  BUSINESS: "business",
  FIRST: "first"
};
function bucketFromCabin(cabin) {
  if (!cabin) return null;
  const upper = cabin.toUpperCase();
  if (CABIN_TO_BUCKET[upper]) return CABIN_TO_BUCKET[upper];
  for (const [k, v] of Object.entries(CABIN_TO_BUCKET)) if (upper.includes(k)) return v;
  return null;
}
__name(bucketFromCabin, "bucketFromCabin");
function normalizeFare(key, sol) {
  const refundable = key.startsWith("REFUNDABLE_") || sol.refundable === true;
  const cabin = (sol.cabins?.[0] ?? key.replace(/^REFUNDABLE_/, "")).toUpperCase();
  return {
    key,
    cabin,
    bucket: bucketFromCabin(cabin),
    miles: numPos(sol.atmosPoints) ?? numPos(sol.allPaxPoints),
    cash: (typeof sol.grandTotal === "number" ? sol.grandTotal : sol.allPaxTotal) ?? null,
    bookingCodes: Array.isArray(sol.bookingCodes) ? sol.bookingCodes.slice() : [],
    seatsRemaining: typeof sol.seatsRemaining === "number" ? sol.seatsRemaining : void 0,
    refundable,
    mixedCabin: sol.mixedCabin === true
  };
}
__name(normalizeFare, "normalizeFare");
function normalizeRowFares(row) {
  const out = [];
  for (const [key, sol] of Object.entries(row.solutions ?? {})) {
    if (sol) out.push(normalizeFare(key, sol));
  }
  return out;
}
__name(normalizeRowFares, "normalizeRowFares");
function parseIsoLocal(iso) {
  if (!iso || typeof iso !== "string") return { hour: -1, minute: -1, hhmm: "", date: "" };
  const tm = iso.match(/T(\d{2}):(\d{2})/);
  const dm = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return {
    hour: tm ? Number(tm[1]) : -1,
    minute: tm ? Number(tm[2]) : -1,
    hhmm: tm ? `${tm[1]}:${tm[2]}` : "",
    date: dm ? dm[1] : ""
  };
}
__name(parseIsoLocal, "parseIsoLocal");
function isSummary(x) {
  return x && typeof x === "object" && typeof x.cheapestByCabin === "object" && typeof x.duration === "string" && Array.isArray(x.flightNumbers);
}
__name(isSummary, "isSummary");
function summarizeFlight(input, dateHint) {
  if (!input || typeof input !== "object") {
    throw new Error("summarizeFlight: input is empty");
  }
  if (isSummary(input)) {
    return dateHint && !input.date ? { ...input, date: dateHint } : input;
  }
  let row;
  let date = dateHint;
  if (input.row && Array.isArray(input.row.segments)) {
    row = input.row;
    date = date ?? input.date;
  } else if (Array.isArray(input.segments)) {
    row = input;
  }
  if (!row) {
    throw new Error(
      "summarizeFlight: could not find segments. Pass a FlightRow (from searchAwards) or a hit object with `.row`."
    );
  }
  const segs = row.segments;
  const dep = parseIsoLocal(segs[0]?.departureTime ?? "");
  const arr = parseIsoLocal(segs[segs.length - 1]?.arrivalTime ?? "");
  const departDate = date || dep.date;
  const arrivesNextDay = !!(departDate && arr.date && arr.date > departDate);
  const durationMin = typeof row.duration === "number" ? row.duration : 0;
  const route = segs.length ? segs.map((s, i) => i === 0 ? `${s.departureStation}\u2192${s.arrivalStation}` : `\u2192${s.arrivalStation}`).join("") : "";
  const carriers = Array.from(
    new Set(
      segs.map((s) => s.publishingCarrier?.carrierCode ?? s.displayCarrier?.carrierCode).filter((x) => !!x)
    )
  );
  const flightNumbers = segs.map((s) => {
    const c = s.publishingCarrier ?? s.displayCarrier;
    return c?.carrierCode && c?.flightNumber != null ? `${c.carrierCode}${c.flightNumber}` : null;
  }).filter((x) => !!x);
  const totalLayoverMinutes = segs.slice(0, -1).reduce((sum, s) => sum + (typeof s.stopoverDuration === "number" ? s.stopoverDuration : 0), 0);
  const cheapestByCabin = { main: null, business: null, first: null };
  for (const f of normalizeRowFares(row)) {
    if (!f.bucket) continue;
    const cur = cheapestByCabin[f.bucket];
    if (!cur || (f.miles ?? f.cash ?? Infinity) < (cur.miles ?? cur.cash ?? Infinity)) {
      cheapestByCabin[f.bucket] = f;
    }
  }
  return {
    date: departDate || void 0,
    route,
    depart: segs[0]?.departureTime ?? "",
    arrive: segs[segs.length - 1]?.arrivalTime ?? "",
    departHourLocal: dep.hour,
    departMinuteLocal: dep.minute,
    arriveHourLocal: arr.hour,
    arriveMinuteLocal: arr.minute,
    departTimeLocal: dep.hhmm,
    arriveTimeLocal: arr.hhmm,
    duration: `${Math.floor(durationMin / 60)}h ${pad2(durationMin % 60)}m`,
    durationMinutes: durationMin,
    segments: segs.length,
    nonstop: segs.length === 1,
    totalLayoverMinutes,
    arrivesNextDay,
    carriers,
    flightNumbers,
    segmentDetails: segs.map(s => ({from: s.departureStation, to: s.arrivalStation, depart: s.departureTime, arrive: s.arrivalTime, marketingCarrier: s.publishingCarrier, operatingCarrier: s.operatingCarrier, aircraft: s.aircraft, stopoverMinutes: s.stopoverDuration})),
    allFares: normalizeRowFares(row),
    cheapestByCabin
  };
}
__name(summarizeFlight, "summarizeFlight");
function frac(h, m) {
  return h < 0 ? -1 : h + (m > 0 ? m / 60 : 0);
}
__name(frac, "frac");
function evaluate(summary, filters, mode) {
  if (filters.nonstopOnly && !summary.nonstop) {
    return { ok: false, matchedCabins: [], rejectedBy: "nonstopOnly" };
  }
  const dep = frac(summary.departHourLocal, summary.departMinuteLocal);
  const arr = frac(summary.arriveHourLocal, summary.arriveMinuteLocal);
  const da = coerceHour(filters.depAfter);
  const db = coerceHour(filters.depBefore);
  const aa = coerceHour(filters.arriveAfter);
  const ab = coerceHour(filters.arriveBefore);
  if (da != null && dep < da) return { ok: false, matchedCabins: [], rejectedBy: "depAfter" };
  if (db != null && dep > db) return { ok: false, matchedCabins: [], rejectedBy: "depBefore" };
  if (aa != null && arr < aa) return { ok: false, matchedCabins: [], rejectedBy: "arriveAfter" };
  if (ab != null && arr > ab) return { ok: false, matchedCabins: [], rejectedBy: "arriveBefore" };
  if (filters.maxDurationMinutes != null && summary.durationMinutes > filters.maxDurationMinutes) {
    return { ok: false, matchedCabins: [], rejectedBy: "maxDurationMinutes" };
  }
  if (filters.maxLayoverMinutes != null && summary.totalLayoverMinutes > filters.maxLayoverMinutes) {
    return { ok: false, matchedCabins: [], rejectedBy: "maxLayoverMinutes" };
  }
  if (filters.carriers?.length) {
    const allow = new Set(filters.carriers.map((c) => c.toUpperCase()));
    if (!summary.carriers.some((c) => allow.has(c.toUpperCase()))) {
      return { ok: false, matchedCabins: [], rejectedBy: "carriers" };
    }
  }
  if (filters.excludeCarriers?.length) {
    const block = new Set(filters.excludeCarriers.map((c) => c.toUpperCase()));
    if (summary.carriers.some((c) => block.has(c.toUpperCase()))) {
      return { ok: false, matchedCabins: [], rejectedBy: "excludeCarriers" };
    }
  }
  const caps = filters.maxMiles;
  const haveCaps = !!caps && Object.values(caps).some((v) => typeof v === "number");
  const wantBookingCodes = filters.bookingCodes?.length ? new Set(filters.bookingCodes.map((c) => c.toUpperCase())) : null;
  const minSeats = filters.minSeats;
  const matched = [];
  const matchedFares = [];
  for (const f of summary.allFares ?? Object.values(summary.cheapestByCabin).filter(Boolean)) {
    const bucket = f.bucket;
    if (!bucket) continue;
    if (filters.noMixedCabin && f.mixedCabin) continue;
    if (filters.maxCash != null && (f.cash == null || f.cash > filters.maxCash)) continue;
    if (typeof minSeats === "number" && (typeof f.seatsRemaining !== "number" || f.seatsRemaining < minSeats)) continue;
    if (wantBookingCodes && !f.bookingCodes.some((c) => wantBookingCodes.has(c.toUpperCase()))) continue;
    if (haveCaps) {
      const cap = caps[bucket];
      const price = mode === "award" ? f.miles : f.cash;
      if (typeof cap === "number" && (typeof price !== "number" || price > cap)) continue;
    }
    matched.push(bucket);
    matchedFares.push(f);
  }
  if (filters.maxCash != null && matched.length === 0) return {ok:false, matchedCabins: [], rejectedBy: "maxCash"};
  if (haveCaps && matched.length === 0) return { ok: false, matchedCabins: [], rejectedBy: "maxMiles" };
  if (wantBookingCodes && matched.length === 0) return { ok: false, matchedCabins: [], rejectedBy: "bookingCodes" };
  if (filters.noMixedCabin && matched.length === 0) return { ok: false, matchedCabins: [], rejectedBy: "noMixedCabin" };
  if (typeof minSeats === "number" && matched.length === 0) return { ok: false, matchedCabins: [], rejectedBy: "minSeats" };
  return { ok: true, matchedCabins: [...new Set(matched)], matchedFares };
}
__name(evaluate, "evaluate");
function filterFlights(items, filters = {}) {
  const mode = filters.mode ?? "award";
  const out = [];
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item) continue;
    let summary;
    try {
      summary = summarizeFlight(item);
    } catch {
      continue;
    }
    if (evaluate(summary, filters, mode).ok) out.push({...summary, matchedFares: evaluate(summary, filters, mode).matchedFares});
  }
  return out;
}
__name(filterFlights, "filterFlights");
const DATE_RANGE_KEYS = [
  "from",
  "to",
  "start",
  "end",
  "adults",
  "mode",
  "concurrency",
  ...FLIGHT_FILTER_KEYS
];
async function searchDateRange(p) {
  validateParams("searchDateRange", p, ["from", "to", "start", "end"], DATE_RANGE_KEYS);
  const adults = adultsOf(p);
  const concurrency = Math.min(8, Math.max(1, p.concurrency ?? 4));
  const mode = p.mode ?? "award";
  const dates = enumerateDateRange(p.start, p.end);
  if (!dates.length) {
    throw new Error(
      `searchDateRange: invalid date range \`${p.start}\` \u2192 \`${p.end}\`. Expected YYYY-MM-DD strings with end >= start.`
    );
  }
  const hits = [];
  const byDate = {};
  const dropped = emptyDrops();
  let scanned = 0;
  let redirects = 0;
  let errors = 0;
  const tasks = dates.map((date) => async () => {
    let res;
    try {
      res = await searchAwardsRaw({ from: p.from, to: p.to, date, adults, mode });
    } catch {
      errors++;
      return;
    }
    if (res.status === "redirect") {
      redirects++;
      return;
    }
    const summaries = [];
    for (const row of res.rows) {
      scanned++;
      const summary = summarizeFlight(row, date);
      const verdict = evaluate(summary, p, mode);
      if (!verdict.ok) {
        if (verdict.rejectedBy) dropped[verdict.rejectedBy]++;
        continue;
      }
      const fares = normalizeRowFares(row).filter((f) => f.miles != null || f.cash != null);
      summaries.push(summary);
      hits.push({ date, summary, fares, row, matchedCabins: verdict.matchedCabins, matchedFares: verdict.matchedFares });
    }
    if (summaries.length) byDate[date] = summaries;
  });
  await runWithConcurrency(tasks, concurrency);
  const flights = hits.map((h) => h.summary).sort(sortFlights);
  return { flights, hits, byDate, scanned, dropped, redirects, errors };
}
__name(searchDateRange, "searchDateRange");
const FIND_AWARDS_KEYS = [
  "from",
  "to",
  "date",
  "start",
  "end",
  "days",
  "adults",
  "mode",
  "concurrency",
  ...FLIGHT_FILTER_KEYS
];
async function findAwards(p) {
  validateParams("findAwards", p, ["from", "to"], FIND_AWARDS_KEYS);
  let start;
  let end;
  if (p.date) {
    start = end = p.date;
  } else if (p.start && p.end) {
    start = p.start;
    end = p.end;
  } else {
    const today = /* @__PURE__ */ new Date();
    const days = Math.max(1, p.days ?? 14);
    start = formatDate(today);
    end = formatDate(new Date(today.getTime() + (days - 1) * PAST_MS));
  }
  const { date: _d, days: _days, start: _s, end: _e, ...rest } = p;
  return searchDateRange({ ...rest, start, end });
}
__name(findAwards, "findAwards");
function normalizeCalendarCell(raw) {
  return {date: raw.date.slice(0,10), miles: raw.awardPoints ?? null, cash: raw.price ?? null, raw};
}
const MONTH_CALENDAR_KEYS = ["from", "to", "month", "adults", "mode", "timeoutMs"];
function parseCalendarPayload(text) {
  for (const line of text.trim().split("\n")) {
    const message = JSON.parse(line);
    if (message.type === "redirect") throw new Error(`AS calendar redirect: ${message.location}`);
    const chunks = message.type === "chunk" ? [message.data] : (message.nodes ?? []).filter(n => n?.type === "data").map(n => n.data);
    for (const chunk of chunks) {
      const decoded = devalueRevive(chunk);
      const payload = [decoded, ...Object.values(decoded ?? {})].find(value => value && (value.calendarDates || value.shoulderDates));
      if (payload) return payload;
    }
  }
  throw new Error("AS calendar response did not contain calendarDates or shoulderDates");
}
async function getMonthCalendar(p) {
  const qs = new URLSearchParams({O: p.from, D: p.to, OD: `${p.month}-15`, A: String(adultsOf(p)), RT: "false", RequestType: "Calendar", ShoppingMethod: p.mode === "cash" ? "onlinerevenue" : "onlineaward", locale: "en-us"});
  const response = await fetch(`https://www.alaskaair.com/search/calendar/__data.json?${qs}`, {credentials: "include"});
  if (!response.ok) throw new Error(`AS calendar HTTP ${response.status}`);
  const payload = parseCalendarPayload(await response.text());
  const cells = [...(payload.shoulderDates ?? []), ...(payload.calendarDates ?? [])].map(normalizeCalendarCell).filter(cell => cell.date.startsWith(p.month));
  return [...new Map(cells.map(cell => [cell.date, cell])).values()].sort((a,b) => a.date.localeCompare(b.date));
}
function enumerateMonthDates(month) {
  const dim = daysInMonth(month);
  const out = [];
  for (let d = 1; d <= dim; d++) out.push(`${month}-${pad2(d)}`);
  return out;
}
__name(enumerateMonthDates, "enumerateMonthDates");
const BATCH_KEYS = [
  "origins",
  "destinations",
  "months",
  "start",
  "end",
  "adults",
  "mode",
  "concurrency",
  "maxCandidateDates",
  "skipCalendar",
  ...FLIGHT_FILTER_KEYS
];
async function batchSearch(p) {
  validateParams("batchSearch", p, ["origins", "destinations"], BATCH_KEYS);
  if (!Array.isArray(p.origins) || !p.origins.length) {
    throw new Error("batchSearch: `origins` must be a non-empty string array.");
  }
  if (!Array.isArray(p.destinations) || !p.destinations.length) {
    throw new Error("batchSearch: `destinations` must be a non-empty string array.");
  }
  let months = p.months?.slice() ?? [];
  let explicitDates = null;
  if (p.start && p.end) {
    explicitDates = enumerateDateRange(p.start, p.end);
    months = Array.from(new Set(explicitDates.map((d) => d.slice(0, 7))));
  }
  if (!months.length) {
    throw new Error('batchSearch: provide either `months: ["YYYY-MM", ...]` or `start`+`end` date range.');
  }
  const adults = adultsOf(p);
  const concurrency = Math.min(8, Math.max(1, p.concurrency ?? 4));
  const maxCandidates = p.maxCandidateDates ?? 200;
  const mode = p.mode ?? "award";
  const cabinValues = ["main", "business", "first"].map((k) => p.maxMiles?.[k]).filter((v) => typeof v === "number");
  const calCeiling = cabinValues.length ? Math.max(...cabinValues) : Infinity;
  const dateFilter = explicitDates ? new Set(explicitDates) : null;
  const candidates = [];
  let skipped = 0;
  if (p.skipCalendar || explicitDates) {
    for (const o of p.origins) {
      for (const d of p.destinations) {
        if (o === d) continue;
        for (const month of months) {
          for (const date of enumerateMonthDates(month)) {
            if (dateFilter && !dateFilter.has(date)) continue;
            candidates.push({ from: o, to: d, date });
            if (candidates.length >= maxCandidates) break;
          }
          if (candidates.length >= maxCandidates) break;
        }
        if (candidates.length >= maxCandidates) break;
      }
      if (candidates.length >= maxCandidates) break;
    }
  } else {
    for (const o of p.origins) {
      for (const d of p.destinations) {
        if (o === d) continue;
        for (const month of months) {
          if (candidates.length >= maxCandidates) break;
          let cells = [];
          try {
            cells = await getMonthCalendar({ from: o, to: d, month, adults, mode });
          } catch {
            skipped++;
            continue;
          }
          for (const cell of cells) {
            const cheap = mode === "award" ? cell.miles : cell.cash;
            if (cheap == null) continue;
            if (mode === "award" && isFinite(calCeiling) && cheap > calCeiling) continue;
            candidates.push({ from: o, to: d, date: cell.date });
            if (candidates.length >= maxCandidates) break;
          }
        }
      }
    }
  }
  const hits = [];
  const dropped = emptyDrops();
  let scanned = 0;
  let redirects = 0;
  const detailTasks = candidates.map((cand) => async () => {
    let res;
    try {
      res = await searchAwardsRaw({ from: cand.from, to: cand.to, date: cand.date, adults, mode });
    } catch {
      skipped++;
      return;
    }
    if (res.status === "redirect") {
      redirects++;
      return;
    }
    for (const row of res.rows) {
      scanned++;
      const summary = summarizeFlight(row, cand.date);
      const verdict = evaluate(summary, p, mode);
      if (!verdict.ok) {
        if (verdict.rejectedBy) dropped[verdict.rejectedBy]++;
        continue;
      }
      const fares = normalizeRowFares(row).filter((f) => f.miles != null || f.cash != null);
      hits.push({
        route: `${cand.from}-${cand.to}`,
        date: cand.date,
        summary,
        fares,
        row,
        flight: row,
        matchedCabins: verdict.matchedCabins, matchedFares: verdict.matchedFares
      });
    }
  });
  await runWithConcurrency(detailTasks, concurrency);
  const flights = hits.map((h) => h.summary).sort(sortFlights);
  return { flights, hits, scanned, candidateDates: candidates.length, skipped, redirects, dropped };
}
__name(batchSearch, "batchSearch");

const routeInput = z.object({from:z.string(),to:z.string(),date:z.string(),adults:z.number().int().min(1).max(9).optional(),mode:z.enum(["award","cash"]).optional()});
const filtersInput = z.object({nonstopOnly:z.boolean().optional(),depAfter:z.union([z.string(),z.number()]).optional(),depBefore:z.union([z.string(),z.number()]).optional(),arriveAfter:z.union([z.string(),z.number()]).optional(),arriveBefore:z.union([z.string(),z.number()]).optional(),carriers:z.array(z.string()).optional(),excludeCarriers:z.array(z.string()).optional(),maxDurationMinutes:z.number().optional(),maxLayoverMinutes:z.number().optional(),minSeats:z.number().int().positive().optional(),bookingCodes:z.array(z.string()).optional(),noMixedCabin:z.boolean().optional(),maxMiles:z.object({main:z.number().optional(),business:z.number().optional(),first:z.number().optional()}).optional(),maxCash:z.number().nonnegative().optional()});
const rangeInput = routeInput.omit({date:true}).merge(filtersInput).extend({start:z.string(),end:z.string(),concurrency:z.number().int().positive().optional()});
export default defineSkill({
  batchSearch: fn({
    summary: "multi-route × multi-month scan.",
    input: rangeInput.omit({from:true,to:true,start:true,end:true}).extend({origins:z.array(z.string()),destinations:z.array(z.string()),months:z.array(z.string()).optional(),start:z.string().optional(),end:z.string().optional(),maxCandidateDates:z.number().int().positive().optional(),skipCalendar:z.boolean().optional()}),
    handler: async (params) => batchSearch(params),
  }),
  filterFlights: fn({
    summary: "post-search filter; accepts row/hit/summary.",
    input: z.object({items: z.array(z.any()), filters: z.record(z.any()).optional()}),
    handler: async (params) => filterFlights(params.items, params.filters),
  }),
  findAwards: fn({
    summary: "★ main entry. Date range + filters.",
    input: rangeInput.omit({start:true,end:true}).extend({date:z.string().optional(),start:z.string().optional(),end:z.string().optional(),days:z.number().int().positive().optional()}),
    examples: [{args:{from:"SEA",to:"NRT",start:"2026-12-01",end:"2026-12-05",noMixedCabin:true,maxCash:100}}],
    handler: async (params) => findAwards(params),
  }),
  getMonthCalendar: fn({
    summary: "Native monthly SvelteKit calendar JSON; points and cash, no iframe.",
    input: z.object({from: z.string(), to: z.string(), month: z.string(), adults: z.number().int().positive().optional(), mode: z.enum(["award", "cash"]).optional()}),
    handler: async (params) => getMonthCalendar(params),
  }),
  normalizeFare: fn({
    summary: "Normalize one fare: {key, solution}; points, cash, seats and booking codes.",
    input: z.object({key: z.string(), solution: z.record(z.any())}),
    handler: async (params) => normalizeFare(params.key, params.solution),
  }),
  normalizeRowFares: fn({
    summary: "normalizeRowFares(row): NormalizedFare[]",
    input: z.any().optional(),
    handler: async (params) => normalizeRowFares(params.row ?? params),
  }),
  searchAwards: fn({
    summary: "single date, raw rows.",
    input: routeInput,
    handler: async (params) => searchAwards(params),
  }),
  searchAwardsRaw: fn({
    summary: "searchAwardsRaw(params): { rows, status, redirectLocation? }",
    input: routeInput,
    handler: async (params) => searchAwardsRaw(params),
  }),
  searchDateRange: fn({
    summary: "explicit start+end variant.",
    input: rangeInput,
    handler: async (params) => searchDateRange(params),
  }),
  summarizeFlight: fn({
    summary: "polymorphic — accepts row, hit, or summary.",
    input: z.any().optional(),
    handler: async (params) => summarizeFlight(params),
  }),
});

