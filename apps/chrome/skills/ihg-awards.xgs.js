// ==XGooseSkill==
// @name        ihg-awards
// @namespace   ihg
// @version     0.1.1
// @description IHG One Rewards property rate search. Cross-origin scraper for `apis.ihg.com/availability/v3/hotels/offers`. Anonymous returns BOTH cash AND points pricing in a single call. Run on www.ihg.com.
// @match       *://www.ihg.com/*
// @detect      location.hostname === 'www.ihg.com'
// @run-at      document_idle
// @connect     <self>
// @connect     apis.ihg.com
// @primary     findAvailability
// @keyword     ihg
// @keyword     intercontinental
// @keyword     holiday inn
// @keyword     crowne plaza
// @keyword     kimpton
// @keyword     indigo
// @keyword     ihg one rewards
// @keyword     ihg rewards club
// @keyword     洲际
// @keyword     假日酒店
// @keyword     皇冠假日
// @keyword     金普顿
// @keyword     hotel
// ==/XGooseSkill==

/**
 * IHG One Rewards property rate search. Cross-origin scraper for `apis.ihg.com/availability/v3/hotels/offers`. Anonymous returns BOTH cash AND points pricing in a single call. Run on www.ihg.com.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # IHG One Rewards — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a **single options object**.
 * The skill loads as a content script on `www.ihg.com` and POSTs cross-origin to `apis.ihg.com/availability/v3/hotels/offers`. **No login required for cash OR points** — IHG returns both in a single anonymous call.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const API_URL = "https://apis.ihg.com/availability/v3/hotels/offers?fieldset=rateDetails,rateDetails.policies,rateDetails.bonusRates,rateDetails.upsells,alternatePayments";
const IHG_API_KEY = "se9ym5iAzaW8pxfBjkmgbuGjJcr3Pj6Y";
const DEFAULT_RATE_PLAN_CODES = [
  { internal: "IVAN1" },
  { internal: "IVAN3" },
  { internal: "IVAN5" },
  { internal: "IVAN6" },
  { internal: "IVAN7" },
  { internal: "IVANI" }
];
const RATE_PLAN_CATEGORY = {
  IGCOR: "cash",
  IDAS1: "cash_advance",
  IDME0: "cash_member",
  IDME2: "cash_member_advance",
  IGBBB: "cash_breakfast",
  IKAS1: "cash_advance_breakfast",
  IKME0: "cash_member_breakfast",
  IKME2: "cash_member_advance_breakfast",
  IKME3: "cash_bonus_pts",
  IKME4: "cash_bonus_pts",
  IKME6: "cash_bonus_pts",
  IKME7: "cash_bonus_pts",
  IKME8: "cash_bonus_pts",
  IKME9: "cash_bonus_pts",
  IKM5K: "cash_bonus_pts",
  IKPCM: "cash_bonus_pts",
  IKBB1: "cash_bonus_pts",
  IBDNG: "cash_package",
  IVANI: "points",
  IVAN1: "points_member",
  IVAN3: "points_member",
  IVAN5: "points_member",
  IVAN6: "points_member",
  IVAN7: "points_member"
};
function categorize(code) {
  return RATE_PLAN_CATEGORY[code] ?? "unknown";
}
__name(categorize, "categorize");
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label, s) {
  if (typeof s !== "string" || !DATE_RX.test(s)) {
    throw new Error(`ihg-awards: ${label} must be 'YYYY-MM-DD' (got ${JSON.stringify(s)})`);
  }
}
__name(assertDate, "assertDate");
function addDays(yyyymmdd, delta) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
__name(addDays, "addDays");
function dateRangeInclusive(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
__name(dateRangeInclusive, "dateRangeInclusive");
function dayOfWeek(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
__name(dayOfWeek, "dayOfWeek");
function nightsBetween(arrival, departure) {
  const a = Date.UTC(+arrival.slice(0, 4), +arrival.slice(5, 7) - 1, +arrival.slice(8, 10));
  const d = Date.UTC(+departure.slice(0, 4), +departure.slice(5, 7) - 1, +departure.slice(8, 10));
  return Math.max(0, Math.round((d - a) / 864e5));
}
__name(nightsBetween, "nightsBetween");
const sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
function makeUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
__name(makeUuid, "makeUuid");
async function runWithConcurrency(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const workers = [];
  const concurrency = Math.max(1, Math.min(limit | 0 || 1, tasks.length));
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        for (; ; ) {
          const idx = next++;
          if (idx >= tasks.length) return;
          out[idx] = await tasks[idx]();
        }
      })()
    );
  }
  await Promise.all(workers);
  return out;
}
__name(runWithConcurrency, "runWithConcurrency");
function buildBody(opts) {
  return {
    startDate: opts.arrivalDate,
    endDate: opts.departureDate,
    hotelMnemonics: [opts.hotelMnemonic],
    rates: { ratePlanCodes: DEFAULT_RATE_PLAN_CODES },
    products: [
      {
        productCode: "SR",
        startDate: opts.arrivalDate,
        endDate: opts.departureDate,
        quantity: opts.numRooms,
        guestCounts: [{ otaCode: "AQC10", count: opts.numAdults }]
      }
    ],
    options: {
      disabilityMode: "ACCESSIBLE_AND_NON_ACCESSIBLE",
      returnAdditionalRatePlanDescriptions: true,
      rateDetails: { includePackageDetails: true, returnDetailedTaxDescriptions: true }
    }
  };
}
__name(buildBody, "buildBody");
async function callOnce(body) {
  const r = await fetch(API_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "x-ihg-api-key": IHG_API_KEY,
      "ihg-sessionid": makeUuid(),
      "ihg-transactionid": makeUuid(),
      "ihg-language": "en-US",
      "content-type": "application/json; charset=UTF-8",
      accept: "application/json, text/plain, */*"
    },
    body: JSON.stringify(body)
  });
  const bodyText = await r.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  return { status: r.status, json, bodyText };
}
__name(callOnce, "callOnce");
function indexProductDefinitions(productDefinitions) {
  const out = /* @__PURE__ */ new Map();
  for (const p of productDefinitions ?? []) {
    if (!p?.inventoryTypeCode) continue;
    const code = p.inventoryTypeCode;
    const existing = out.get(code);
    const desc = p.description ?? "";
    if (existing && (existing.description?.length ?? 0) >= desc.length) continue;
    out.set(code, {
      inventoryTypeCode: code,
      roomName: p.inventoryTypeName || p.productName || code,
      description: p.description ?? null,
      maxAdultOcc: typeof p.maxAdultOcc === "number" ? p.maxAdultOcc : null,
      maxChildOcc: typeof p.maxChildOcc === "number" ? p.maxChildOcc : null,
      isPremium: typeof p.isPremium === "boolean" ? p.isPremium : null,
      isAvailable: typeof p.isAvailable === "boolean" ? p.isAvailable : null,
      attributeCodes: Array.isArray(p.attributeCodes) ? p.attributeCodes : []
    });
  }
  return out;
}
__name(indexProductDefinitions, "indexProductDefinitions");
function indexRatePlanDefinitions(ratePlanDefinitions) {
  const out = /* @__PURE__ */ new Map();
  for (const rp of ratePlanDefinitions ?? []) {
    if (!rp?.code) continue;
    const code = rp.code;
    out.set(code, { code, name: rp.name ?? null, category: categorize(code) });
  }
  return out;
}
__name(indexRatePlanDefinitions, "indexRatePlanDefinitions");
async function getStayRates(params) {
  if (!params || typeof params !== "object") {
    throw new Error("ihg-awards.getStayRates: pass a single options object {hotelMnemonic, arrivalDate, departureDate, ...}");
  }
  if (!params.hotelMnemonic) throw new Error("ihg-awards.getStayRates: hotelMnemonic is required");
  assertDate("arrivalDate", params.arrivalDate);
  assertDate("departureDate", params.departureDate);
  if (params.departureDate <= params.arrivalDate) {
    throw new Error(
      `ihg-awards.getStayRates: departureDate (${params.departureDate}) must be after arrivalDate (${params.arrivalDate})`
    );
  }
  const hotelMnemonic = params.hotelMnemonic.toUpperCase();
  const numAdults = params.numAdults ?? 1;
  const numRooms = params.numRooms ?? 1;
  const retries = Math.max(0, params.retries ?? 2);
  const nights = nightsBetween(params.arrivalDate, params.departureDate);
  const body = buildBody({
    hotelMnemonic,
    arrivalDate: params.arrivalDate,
    departureDate: params.departureDate,
    numAdults,
    numRooms
  });
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { status: status2, json, bodyText } = await callOnce(body);
    if (status2 === 200 && json?.hotels?.[0]) {
      const hotel = json.hotels[0];
      const offers = hotel?.rateDetails?.offers ?? [];
      const rooms = indexProductDefinitions(hotel?.productDefinitions ?? []);
      const ratePlans = indexRatePlanDefinitions(hotel?.ratePlanDefinitions ?? []);
      for (const o of offers) {
        if (o?.ratePlanCode && !ratePlans.has(o.ratePlanCode)) {
          ratePlans.set(o.ratePlanCode, { code: o.ratePlanCode, name: null, category: categorize(o.ratePlanCode) });
        }
      }
      return {
        hotelMnemonic,
        arrivalDate: params.arrivalDate,
        departureDate: params.departureDate,
        nights,
        status: offers.length === 0 ? "sold_out" : "ok",
        propertyCurrency: hotel?.propertyCurrency ?? null,
        brandCode: hotel?.brandCode ?? null,
        rooms: Object.fromEntries(rooms),
        ratePlans: Object.fromEntries(ratePlans),
        offers,
        raw: hotel
      };
    }
    lastErr = { status: status2, json, bodyText };
    if (status2 === 401 || status2 === 403) break;
    if (attempt < retries) {
      const delay = [800, 2500][Math.min(attempt, 1)];
      await sleep(delay);
    }
  }
  const status = lastErr?.status === 401 || lastErr?.status === 403 ? "auth_error" : "http_error";
  return {
    hotelMnemonic,
    arrivalDate: params.arrivalDate,
    departureDate: params.departureDate,
    nights,
    status,
    propertyCurrency: null,
    brandCode: null,
    rooms: {},
    ratePlans: {},
    offers: [],
    raw: lastErr?.json ?? null,
    error: lastErr ? `HTTP ${lastErr.status}: ${lastErr.bodyText.slice(0, 200)}` : "unknown error"
  };
}
__name(getStayRates, "getStayRates");
function isMatchingProduct(o, arrivalDate, departureDate) {
  const pu = o?.productUses?.[0];
  if (!pu) return false;
  if (pu.period?.start !== arrivalDate || pu.period?.end !== departureDate) return false;
  return o.availableStatus === "AVAILABLE" || !o.availableStatus;
}
__name(isMatchingProduct, "isMatchingProduct");
function nightlyCash(o, currency) {
  const v = o?.totalRate?.average?.amountAfterTax;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
__name(nightlyCash, "nightlyCash");
function applyCategoryFilter(category, allow) {
  if (allow == null) return true;
  const list = Array.isArray(allow) ? allow : [allow];
  return list.includes(category);
}
__name(applyCategoryFilter, "applyCategoryFilter");
function summarizeStay(stay) {
  if (!stay || typeof stay !== "object") {
    throw new Error("ihg-awards.summarizeStay: pass a StayRates (from getStayRates())");
  }
  const currency = stay.propertyCurrency ?? "";
  const rooms = stay.rooms;
  const offersByRoom = /* @__PURE__ */ new Map();
  for (const o of stay.offers) {
    if (!isMatchingProduct(o, stay.arrivalDate, stay.departureDate)) continue;
    const code = o?.productUses?.[0]?.inventoryTypeCode;
    if (!code) continue;
    const arr = offersByRoom.get(code) ?? [];
    arr.push(o);
    offersByRoom.set(code, arr);
  }
  const out = [];
  for (const [roomCode, offers] of offersByRoom) {
    const room = rooms[roomCode];
    let bestCash = null;
    let bestPoints = null;
    const pointsCashOptions = [];
    for (const o of offers) {
      const code = o.ratePlanCode;
      const cat = categorize(code);
      if (cat === "points" || cat === "points_member") {
        const ptsAvg = o?.rewardNights?.pointsOnly?.averageDailyPoints;
        if (typeof ptsAvg === "number") {
          const taxesCash = nightlyCash(o, currency);
          if (!bestPoints || ptsAvg < bestPoints.points) {
            bestPoints = {
              points: ptsAvg,
              ratePlanCode: "IVANI",
              taxesCash,
              taxesCurrency: currency || null
            };
          }
        }
        const pcOptions = o?.rewardNights?.pointsCash?.options;
        if (Array.isArray(pcOptions)) {
          for (const opt of pcOptions) {
            if (typeof opt?.averageDailyPoints !== "number" || typeof opt?.averageDailyCash !== "number") continue;
            pointsCashOptions.push({
              depositId: opt.depositId,
              points: opt.averageDailyPoints,
              cashUsd: opt.averageDailyCash
            });
          }
        }
      } else {
        const cash = nightlyCash(o, currency);
        if (cash != null && (!bestCash || cash < bestCash.amount)) {
          const planName = stay.ratePlans[code]?.name ?? code;
          bestCash = {
            amount: cash,
            currency,
            ratePlanCode: code,
            ratePlanName: planName ?? code,
            isRefundable: typeof o?.policies?.isRefundable === "boolean" ? o.policies.isRefundable : null
          };
        }
      }
    }
    pointsCashOptions.sort((a, b) => a.points - b.points);
    out.push({
      roomTypeCode: roomCode,
      roomName: room?.roomName ?? roomCode,
      description: room?.description ?? null,
      maxAdultOcc: room?.maxAdultOcc ?? null,
      isPremium: room?.isPremium ?? null,
      cash: bestCash,
      points: bestPoints,
      pointsCashOptions: pointsCashOptions.slice(0, 6)
    });
  }
  out.sort((a, b) => {
    const ac = a.cash?.amount ?? Number.POSITIVE_INFINITY;
    const bc = b.cash?.amount ?? Number.POSITIVE_INFINITY;
    if (ac !== bc) return ac - bc;
    const ap = a.points?.points ?? Number.POSITIVE_INFINITY;
    const bp = b.points?.points ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  let cheapestCash = null;
  let cheapestPoints = null;
  let cheapestPointsCash = null;
  for (const r of out) {
    if (r.cash && (!cheapestCash || r.cash.amount < cheapestCash.cash)) {
      cheapestCash = {
        roomTypeCode: r.roomTypeCode,
        ratePlanCode: r.cash.ratePlanCode,
        ratePlanName: r.cash.ratePlanName,
        cash: r.cash.amount,
        currency: r.cash.currency,
        isRefundable: r.cash.isRefundable
      };
    }
    if (r.points && (!cheapestPoints || r.points.points < cheapestPoints.points)) {
      cheapestPoints = {
        roomTypeCode: r.roomTypeCode,
        points: r.points.points,
        taxesCash: r.points.taxesCash,
        taxesCurrency: r.points.taxesCurrency
      };
    }
    for (const pc of r.pointsCashOptions) {
      if (!cheapestPointsCash || pc.cashUsd < cheapestPointsCash.cashUsd) {
        cheapestPointsCash = {
          roomTypeCode: r.roomTypeCode,
          depositId: pc.depositId,
          points: pc.points,
          cashUsd: pc.cashUsd
        };
      }
    }
  }
  return {
    hotelMnemonic: stay.hotelMnemonic,
    date: stay.arrivalDate,
    nights: stay.nights,
    propertyCurrency: stay.propertyCurrency,
    cheapestCash,
    cheapestPoints,
    cheapestPointsCash,
    rooms: out
  };
}
__name(summarizeStay, "summarizeStay");
function filterStaySummaries(rooms, filters) {
  if (!filters) return rooms.slice();
  return rooms.filter((r) => {
    if (filters.cashOnly && !r.cash) return false;
    if (filters.pointsOnly && !r.points) return false;
    if (filters.refundableOnly && (!r.cash || r.cash.isRefundable !== true)) return false;
    if (filters.maxCash != null && (!r.cash || r.cash.amount > filters.maxCash)) return false;
    if (filters.maxPoints != null && (!r.points || r.points.points > filters.maxPoints)) return false;
    if (r.cash) {
      const cat = categorize(r.cash.ratePlanCode);
      if (filters.excludeBonusPoints && cat === "cash_bonus_pts") return false;
      if (!applyCategoryFilter(cat, filters.ratePlanCategoryAllow)) return false;
    }
    return true;
  });
}
__name(filterStaySummaries, "filterStaySummaries");
async function findAvailability(params) {
  if (!params || typeof params !== "object") {
    throw new Error("ihg-awards.findAvailability: pass a single options object {hotelMnemonic, startDate, endDate, ...}");
  }
  if (!params.hotelMnemonic) throw new Error("ihg-awards.findAvailability: hotelMnemonic is required");
  assertDate("startDate", params.startDate);
  assertDate("endDate", params.endDate);
  if (params.endDate < params.startDate) {
    throw new Error(`ihg-awards.findAvailability: endDate (${params.endDate}) must be >= startDate (${params.startDate})`);
  }
  const hotelMnemonic = params.hotelMnemonic.toUpperCase();
  const nights = Math.max(1, params.nights ?? 1);
  const numAdults = params.numAdults ?? 1;
  const numChildren = params.numChildren ?? 0;
  const numRooms = params.numRooms ?? 1;
  const mode = params.mode === "points" ? "points" : "cash";
  const concurrency = params.concurrency ?? 4;
  const retries = params.retries ?? 2;
  const includeRaw = params.includeRaw === true;
  const filters = params.filters;
  const checkins = dateRangeInclusive(params.startDate, params.endDate);
  let propertyCurrency = null;
  let brandCode = null;
  const tasks = checkins.map((date) => async () => {
    const checkout = addDays(date, nights);
    try {
      const stay = await getStayRates({
        hotelMnemonic,
        arrivalDate: date,
        departureDate: checkout,
        numAdults,
        numChildren,
        numRooms,
        retries
      });
      if (stay.status === "http_error" || stay.status === "auth_error") {
        return {
          date,
          checkout,
          status: "error",
          cheapestCash: null,
          cheapestPoints: null,
          cheapestPointsCash: null,
          rooms: [],
          error: `${stay.status}: ${stay.error ?? ""}`.trim()
        };
      }
      if (!propertyCurrency && stay.propertyCurrency) propertyCurrency = stay.propertyCurrency;
      if (!brandCode && stay.brandCode) brandCode = stay.brandCode;
      const summary = summarizeStay(stay);
      const filtered = filterStaySummaries(summary.rooms, filters);
      let cheapestCash = null;
      let cheapestPoints = null;
      let cheapestPointsCash = null;
      for (const r of filtered) {
        if (r.cash && (!cheapestCash || r.cash.amount < cheapestCash.cash)) {
          cheapestCash = {
            roomTypeCode: r.roomTypeCode,
            ratePlanCode: r.cash.ratePlanCode,
            ratePlanName: r.cash.ratePlanName,
            cash: r.cash.amount,
            currency: r.cash.currency,
            isRefundable: r.cash.isRefundable
          };
        }
        if (r.points && (!cheapestPoints || r.points.points < cheapestPoints.points)) {
          cheapestPoints = { roomTypeCode: r.roomTypeCode, points: r.points.points, taxesCash: r.points.taxesCash, taxesCurrency: r.points.taxesCurrency };
        }
        for (const pc of r.pointsCashOptions) {
          if (!cheapestPointsCash || pc.cashUsd < cheapestPointsCash.cashUsd) {
            cheapestPointsCash = { roomTypeCode: r.roomTypeCode, depositId: pc.depositId, points: pc.points, cashUsd: pc.cashUsd };
          }
        }
      }
      const dayStatus = stay.status === "sold_out" ? "sold_out" : filtered.length === 0 ? "sold_out" : "available";
      if (filters && (filters.weekdaysOnly || filters.weekendsOnly)) {
        const dow = dayOfWeek(date);
        const isWeekend = dow === 5 || dow === 6;
        if (filters.weekdaysOnly && isWeekend || filters.weekendsOnly && !isWeekend) {
          return {
            date,
            checkout,
            status: "sold_out",
            cheapestCash: null,
            cheapestPoints: null,
            cheapestPointsCash: null,
            rooms: []
          };
        }
      }
      return {
        date,
        checkout,
        status: dayStatus,
        cheapestCash,
        cheapestPoints,
        cheapestPointsCash,
        rooms: filtered,
        raw: includeRaw ? { offers: stay.offers } : void 0
      };
    } catch (err) {
      return {
        date,
        checkout,
        status: "error",
        cheapestCash: null,
        cheapestPoints: null,
        cheapestPointsCash: null,
        rooms: [],
        error: err?.message ?? String(err)
      };
    }
  });
  const days = await runWithConcurrency(tasks, concurrency);
  const available = days.filter((d) => d.status === "available" && d.rooms.length > 0);
  const errors = days.filter((d) => d.status === "error").map((d) => ({ date: d.date, error: d.error ?? "unknown error" }));
  let cashBest = null;
  let pointsBest = null;
  let pointsCashBest = null;
  for (const d of available) {
    if (d.cheapestCash && (!cashBest || d.cheapestCash.cash < cashBest.cash)) {
      cashBest = {
        date: d.date,
        cash: d.cheapestCash.cash,
        currency: d.cheapestCash.currency,
        roomTypeCode: d.cheapestCash.roomTypeCode,
        ratePlanCode: d.cheapestCash.ratePlanCode
      };
    }
    if (d.cheapestPoints && (!pointsBest || d.cheapestPoints.points < pointsBest.points)) {
      pointsBest = { date: d.date, points: d.cheapestPoints.points, roomTypeCode: d.cheapestPoints.roomTypeCode };
    }
    if (d.cheapestPointsCash && (!pointsCashBest || d.cheapestPointsCash.cashUsd < pointsCashBest.cashUsd)) {
      pointsCashBest = {
        date: d.date,
        points: d.cheapestPointsCash.points,
        cashUsd: d.cheapestPointsCash.cashUsd,
        roomTypeCode: d.cheapestPointsCash.roomTypeCode,
        depositId: d.cheapestPointsCash.depositId
      };
    }
  }
  return {
    hotelMnemonic,
    brandCode,
    propertyCurrency,
    mode,
    nights,
    startDate: params.startDate,
    endDate: params.endDate,
    days,
    available,
    cashBest,
    pointsBest,
    pointsCashBest,
    scanned: days.length,
    errors
  };
}
__name(findAvailability, "findAvailability");

export default defineSkill({
  filterStaySummaries: fn({
    summary: "Filter {rooms, filters}; rooms is the room summary array from summarizeStay.",
    input: z.object({
      rooms: z.array(z.record(z.unknown())),
      filters: z.object({
        cashOnly: z.boolean().optional(), pointsOnly: z.boolean().optional(),
        refundableOnly: z.boolean().optional(), excludeBonusPoints: z.boolean().optional(),
        maxCash: z.number().nonnegative().optional(), maxPoints: z.number().nonnegative().optional(),
        ratePlanCategoryAllow: z.union([z.string(), z.array(z.string())]).optional(),
      }).optional(),
    }),
    handler: async ({rooms, filters}) => filterStaySummaries(rooms, filters),
  }),
  findAvailability: fn({
    summary: "★ main entry. Date range → per-night calendar with cash + points.",
    input: z.any().optional(),
    handler: async (params) => findAvailability(params),
  }),
  getStayRates: fn({
    summary: "raw single API call.",
    input: z.any().optional(),
    handler: async (params) => getStayRates(params),
  }),
  summarizeStay: fn({
    summary: "best-cash + best-points across all rate plans.",
    input: z.any().optional(),
    handler: async (params) => summarizeStay(params),
  }),
});

