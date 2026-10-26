// ==XGooseSkill==
// @name        hilton-awards
// @namespace   hilton
// @version     0.1.0
// @description Hilton Honors property rate search. Same-origin scraper for Hilton's `hotel_shopAvailOptions_shopPropAvail` Apollo GraphQL endpoint with operation-name allowlisting. Anonymous-friendly for cash; points pricing requires Hilton Honors login. Run on www.hilton.com.
// @match       *://www.hilton.com/*
// @detect      location.hostname === 'www.hilton.com'
// @run-at      document_idle
// @connect     <self>
// @primary     findAvailability
// @keyword     hilton
// @keyword     honors
// @keyword     hilton honors
// @keyword     conrad
// @keyword     waldorf astoria
// @keyword     doubletree
// @keyword     embassy suites
// @keyword     hampton
// @keyword     tru
// @keyword     curio
// @keyword     tapestry
// @keyword     lxr
// @keyword     希尔顿
// @keyword     康莱德
// @keyword     华尔道夫
// @keyword     hotel
// ==/XGooseSkill==

/**
 * Hilton Honors property rate search. Same-origin scraper for Hilton's `hotel_shopAvailOptions_shopPropAvail` Apollo GraphQL endpoint with operation-name allowlisting. Anonymous-friendly for cash; points pricing requires Hilton Honors login. Run on www.hilton.com.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # Hilton Honors — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a **single options object** with the keys below.
 * The skill loads as a content script on `www.hilton.com` and POSTs to `/graphql/customer` with the verbatim `hotel_shopAvailOptions_shopPropAvail` query. **No Hilton Honors account required** for cash; points pricing needs login.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const GQL_PATH = "/graphql/customer";
const GQL_OP = "hotel_shopAvailOptions_shopPropAvail";
const GQL_QUERY = `query hotel_shopAvailOptions_shopPropAvail($arrivalDate: String!, $ctyhocn: String!, $departureDate: String!, $language: String!, $guestLocationCountry: String, $numAdults: Int!, $numChildren: Int!, $numRooms: Int!, $displayCurrency: String, $guestId: BigInt, $specialRates: ShopSpecialRateInput, $rateCategoryTokens: [String], $selectedRoomRateCodes: [ShopRoomRateCodeInput!], $ratePlanCodes: [String], $pnd: String, $offerId: BigInt, $cacheId: String!, $knownGuest: Boolean, $modifyingReservation: Boolean, $currentlySelectedRoomTypeCode: String, $currentlySelectedRatePlanCode: String, $childAges: [Int], $adjoiningRoomStay: Boolean, $programAccountId: BigInt, $roomTypeSortInput: [ShopRoomTypeSortInput!], $includeCUCEligibility: Boolean) {
  hotel(ctyhocn: $ctyhocn, language: $language) {
    ctyhocn
    roomTypes(filter: {accommodationCode_in: ["STD", "EXEC", "STE", "ACCS"]}) {
      roomTypeCode
      adaAccessibleRoom
      numBeds
      roomTypeName
      roomTypeDesc
      roomOccupancy: maxOccupancy
      executive
      suite
      code: roomTypeCode
      name: roomTypeName
      thumbnail: carousel(first: 1) {
        _id
        altText
        variants {
          size
          url
        }
      }
    }
    shopAvailOptions(input: {offerId: $offerId, pnd: $pnd}) {
      maxNumChildren
      altCorporateAccount {
        corporateId
        name
      }
      contentOffer {
        name
      }
    }
    shopAvail(
      cacheId: $cacheId
      input: {guestLocationCountry: $guestLocationCountry, arrivalDate: $arrivalDate, departureDate: $departureDate, displayCurrency: $displayCurrency, numAdults: $numAdults, numChildren: $numChildren, numRooms: $numRooms, guestId: $guestId, specialRates: $specialRates, rateCategoryTokens: $rateCategoryTokens, selectedRoomRateCodes: $selectedRoomRateCodes, ratePlanCodes: $ratePlanCodes, knownGuest: $knownGuest, modifyingReservation: $modifyingReservation, childAges: $childAges, adjoiningRoomStay: $adjoiningRoomStay, programAccountId: $programAccountId, includeCUCEligibility: $includeCUCEligibility, includeGuests: true}
    ) {
      currentlySelectedRoom: roomTypes(
        filter: {roomTypeCode: $currentlySelectedRoomTypeCode}
      ) {
        adaAccessibleRoom
        roomTypeCode
        roomRates(filter: {ratePlanCode: $currentlySelectedRatePlanCode}) {
          ratePlanCode
          rateAmount
          rateAmountFmt(decimal: 0, strategy: ceiling)
          rateAmountUSD: rateAmount(currencyCode: "USD")
          amountAfterTaxFmt(decimal: 0, strategy: ceiling)
          fullAmountAfterTax: amountAfterTaxFmt
          rateChangeIndicator
          ratePlan {
            ratePlanName
            commissionable
            confidentialRates
            specialRateType
            hhonorsMembershipRequired
            redemptionType
          }
          pointDetails {
            pointsRateFmt
          }
        }
      }
      statusCode
      summary {
        specialRates {
          specialRateType
          roomCount
        }
        requestedRates {
          ratePlanCode
          ratePlanName
          roomCount
        }
      }
      notifications {
        subText
        subType
        title
        text
      }
      addOnsAvailable
      currencyCode
      roomTypes(sort: $roomTypeSortInput) {
        attributeGroups(applyEffectiveDates: true) {
          attributes {
            description
            effectiveDate
            expiryDate
            valueAdd
          }
          groupCode
          groupDescription
        }
        roomTypeCode
        adaAccessibleRoom
        numBeds
        roomTypeName
        roomTypeDesc
        roomTypeOffers {
          offerType
          roomTypeCodes
        }
        roomOccupancy
        executive
        suite
        code: roomTypeCode
        name: roomTypeName
        adjoiningRoom
        thumbnail: carousel(first: 1) {
          _id
          altText
          variants {
            size
            url
          }
        }
        virtualMedia(filter: {assetType_in: [photo_360, model_3d]}) {
          assetType
          assetUrl
        }
        quickBookRate {
          cashRatePlan
          roomTypeCode
          rateAmount
          rateAmountUSD: rateAmount(currencyCode: "USD")
          rateChangeIndicator
          feeTransparencyIndicator
          cmaTotalPriceIndicator
          ratePlanCode
          rateAmountFmt(decimal: 0, strategy: ceiling)
          roomTypeCode
          amountAfterTaxFmt(decimal: 0, strategy: ceiling)
          fullAmountAfterTax: amountAfterTaxFmt
          ratePlan {
            commissionable
            confidentialRates
            ratePlanName
            specialRateType
            hhonorsMembershipRequired
            redemptionType
            serviceChargesAndTaxesIncluded
          }
          serviceChargeDetails
          pointDetails(perNight: true) {
            pointsRate
            pointsRateFmt
          }
        }
        moreRatesFromRate {
          rateChangeIndicator
          feeTransparencyIndicator
          cmaTotalPriceIndicator
          roomTypeCode
          rateAmount
          rateAmountFmt(decimal: 0, strategy: ceiling)
          rateAmountUSD: rateAmount(currencyCode: "USD")
          amountAfterTaxFmt(decimal: 0, strategy: ceiling)
          fullAmountAfterTax: amountAfterTaxFmt
          serviceChargeDetails
          ratePlanCode
          ratePlan {
            confidentialRates
            serviceChargesAndTaxesIncluded
          }
        }
        bookNowRate {
          roomTypeCode
          rateAmount
          rateChangeIndicator
          feeTransparencyIndicator
          cmaTotalPriceIndicator
          ratePlanCode
          rateAmountFmt(decimal: 0, strategy: ceiling)
          amountAfterTaxFmt(decimal: 0, strategy: ceiling)
          fullAmountAfterTax: amountAfterTaxFmt
          roomTypeCode
          ratePlan {
            commissionable
            confidentialRates
            ratePlanName
            specialRateType
            hhonorsMembershipRequired
            disclaimer {
              diamond48
            }
            serviceChargesAndTaxesIncluded
          }
          serviceChargeDetails
        }
        redemptionRoomRates(first: 1) {
          rateChangeIndicator
          pointDetails(perNight: true) {
            pointsRate
            pointsRateFmt
          }
          sufficientPoints
          pamEligibleRoomRate {
            ratePlan {
              ratePlanCode
              rateCategoryToken
              redemptionType
            }
            roomTypeCode
            sufficientPoints
          }
        }
      }
      lowestPointsInc
    }
  }
}`;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label, s) {
  if (typeof s !== "string" || !DATE_RX.test(s)) {
    throw new Error(`hilton-awards: ${label} must be 'YYYY-MM-DD' (got ${JSON.stringify(s)})`);
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
const sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
function nightsBetween(arrival, departure) {
  const a = Date.UTC(+arrival.slice(0, 4), +arrival.slice(5, 7) - 1, +arrival.slice(8, 10));
  const d = Date.UTC(+departure.slice(0, 4), +departure.slice(5, 7) - 1, +departure.slice(8, 10));
  return Math.max(0, Math.round((d - a) / 864e5));
}
__name(nightsBetween, "nightsBetween");
function makeCacheId() {
  return "wa-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
__name(makeCacheId, "makeCacheId");
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
function buildVariables(opts) {
  return {
    arrivalDate: opts.arrivalDate,
    departureDate: opts.departureDate,
    ctyhocn: opts.ctyhocn,
    language: "en",
    guestLocationCountry: opts.guestLocationCountry,
    numAdults: opts.numAdults,
    numChildren: opts.numChildren,
    numRooms: opts.numRooms,
    displayCurrency: null,
    guestId: null,
    specialRates: {
      aaa: false,
      governmentMilitary: false,
      hhonors: true,
      // ★ MANDATORY to populate quickBookRate, even for cash searches
      lta: false,
      pnd: "",
      senior: false,
      teamMember: false,
      owner: false,
      ownerHGV: false,
      familyAndFriends: false,
      travelAgent: false,
      smb: false,
      specialOffer: false,
      specialOfferName: null
    },
    pnd: null,
    cacheId: makeCacheId(),
    offerId: null,
    knownGuest: false,
    modifyingReservation: false,
    currentlySelectedRoomTypeCode: null,
    currentlySelectedRatePlanCode: null,
    childAges: null,
    adjoiningRoomStay: false,
    includeCUCEligibility: false,
    roomTypeSortInput: [],
    rateCategoryTokens: null,
    selectedRoomRateCodes: null,
    ratePlanCodes: null,
    programAccountId: null
  };
}
__name(buildVariables, "buildVariables");
async function callGqlOnce(ctyhocn, body) {
  const url = `${GQL_PATH}?appName=dx-res-ui&operationName=${GQL_OP}&ctyhocn=${encodeURIComponent(ctyhocn)}&bl=en`;
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body)
  });
  const bodyText = await r.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  return { status: r.status, bodyText, json };
}
__name(callGqlOnce, "callGqlOnce");
function classifyError(status, json) {
  if (status >= 500) return { status: "http_error", error: `HTTP ${status}` };
  const msg = json?.errors?.[0]?.message ?? "";
  if (status === 403 && /Invalid operation name/i.test(msg)) {
    return { status: "invalid_operation", error: msg };
  }
  if (status === 400) return { status: "graphql_error", error: msg || `HTTP 400` };
  if (json?.errors?.length) return { status: "graphql_error", error: msg };
  return { status: "http_error", error: `HTTP ${status}` };
}
__name(classifyError, "classifyError");
async function getStayRates(params) {
  if (!params || typeof params !== "object") {
    throw new Error("hilton-awards.getStayRates: pass a single options object {ctyhocn, arrivalDate, departureDate, ...}");
  }
  if (!params.ctyhocn) throw new Error("hilton-awards.getStayRates: ctyhocn is required");
  assertDate("arrivalDate", params.arrivalDate);
  assertDate("departureDate", params.departureDate);
  if (params.departureDate <= params.arrivalDate) {
    throw new Error(
      `hilton-awards.getStayRates: departureDate (${params.departureDate}) must be after arrivalDate (${params.arrivalDate})`
    );
  }
  const ctyhocn = params.ctyhocn.toUpperCase();
  const numAdults = params.numAdults ?? 1;
  const numChildren = params.numChildren ?? 0;
  const numRooms = params.numRooms ?? 1;
  const guestLocationCountry = params.guestLocationCountry ?? "US";
  const retries = Math.max(0, params.retries ?? 2);
  const nights = nightsBetween(params.arrivalDate, params.departureDate);
  const variables = buildVariables({
    ctyhocn,
    arrivalDate: params.arrivalDate,
    departureDate: params.departureDate,
    numAdults,
    numChildren,
    numRooms,
    guestLocationCountry
  });
  const body = { operationName: GQL_OP, query: GQL_QUERY, variables };
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { status, json } = await callGqlOnce(ctyhocn, body);
    if (status === 200 && json?.data?.hotel?.shopAvail) {
      const sa = json.data.hotel.shopAvail;
      const roomTypes = Array.isArray(sa.roomTypes) ? sa.roomTypes : [];
      const statusCode = typeof sa.statusCode === "number" ? sa.statusCode : null;
      const awardRoomCount = Array.isArray(sa.summary?.specialRates) ? sa.summary.specialRates.find((s) => s?.specialRateType === "hhonors")?.roomCount ?? 0 : null;
      return {
        ctyhocn,
        arrivalDate: params.arrivalDate,
        departureDate: params.departureDate,
        nights,
        status: statusCode === 0 || statusCode == null ? roomTypes.length === 0 ? "sold_out" : "ok" : "sold_out",
        statusCode,
        currencyCode: sa.currencyCode ?? null,
        lowestPointsInc: typeof sa.lowestPointsInc === "number" ? sa.lowestPointsInc : null,
        awardRoomCount,
        rooms: roomTypes
      };
    }
    lastErr = { status, json };
    if (status === 200) break;
    if (attempt < retries) {
      const delay = [1e3, 3e3][Math.min(attempt, 1)];
      await sleep(delay);
    }
  }
  const cls = classifyError(lastErr?.status ?? 0, lastErr?.json);
  return {
    ctyhocn,
    arrivalDate: params.arrivalDate,
    departureDate: params.departureDate,
    nights,
    status: cls.status,
    statusCode: null,
    currencyCode: null,
    lowestPointsInc: null,
    awardRoomCount: null,
    rooms: [],
    error: cls.error
  };
}
__name(getStayRates, "getStayRates");
function summarizeRoom(room, ctx) {
  if (!room || typeof room !== "object") {
    throw new Error("hilton-awards.summarizeRoom: pass a RoomRate (from getStayRates().rooms[])");
  }
  const qb = room.quickBookRate;
  const points = qb?.pointDetails?.pointsRate ?? room.redemptionRoomRates?.[0]?.pointDetails?.pointsRate ?? null;
  const pointsFmt = qb?.pointDetails?.pointsRateFmt ?? room.redemptionRoomRates?.[0]?.pointDetails?.pointsRateFmt ?? null;
  const sufficientPoints = room.redemptionRoomRates?.[0]?.sufficientPoints ?? null;
  const awardEligible = !!ctx?.awardRoomsExist || points != null || sufficientPoints === true || qb?.ratePlan?.specialRateType === "hhonors";
  return {
    date: ctx?.date ?? "",
    nights: ctx?.nights ?? 1,
    roomTypeCode: room.roomTypeCode,
    title: room.roomTypeName ?? room.roomTypeCode,
    suite: !!room.suite,
    executive: !!room.executive,
    numBeds: typeof room.numBeds === "number" ? room.numBeds : null,
    cash: typeof qb?.rateAmount === "number" ? qb.rateAmount : null,
    cashFmt: qb?.rateAmountFmt ?? null,
    cashUsd: typeof qb?.rateAmountUSD === "number" ? qb.rateAmountUSD : null,
    cashAfterTaxFmt: qb?.amountAfterTaxFmt ?? null,
    ratePlanCode: qb?.ratePlanCode ?? null,
    ratePlanName: qb?.ratePlan?.ratePlanName ?? null,
    currency: ctx?.currency ?? null,
    points,
    pointsFmt,
    awardEligible
  };
}
__name(summarizeRoom, "summarizeRoom");
function asArray(v) {
  if (v == null) return void 0;
  return Array.isArray(v) ? v : [v];
}
__name(asArray, "asArray");
function filterRooms(items, filters) {
  if (!filters) return items.slice();
  const planCodes = asArray(filters.ratePlanCode);
  return items.filter((r) => {
    if (filters.suiteOnly && !r.suite) return false;
    if (filters.excludeSuites && r.suite) return false;
    if (filters.executiveOnly && !r.executive) return false;
    if (filters.cashOnly && r.cash == null) return false;
    if (filters.pointsOnly && r.points == null) return false;
    if (filters.awardEligibleOnly && !r.awardEligible) return false;
    if (filters.maxCash != null && (r.cash == null || r.cash > filters.maxCash)) return false;
    if (filters.maxCashUsd != null && (r.cashUsd == null || r.cashUsd > filters.maxCashUsd)) return false;
    if (filters.maxPoints != null && (r.points == null || r.points > filters.maxPoints)) return false;
    if (planCodes && (!r.ratePlanCode || !planCodes.includes(r.ratePlanCode))) return false;
    if (filters.weekdaysOnly || filters.weekendsOnly) {
      const dow = dayOfWeek(r.date);
      const isWeekend = dow === 5 || dow === 6;
      if (filters.weekdaysOnly && isWeekend) return false;
      if (filters.weekendsOnly && !isWeekend) return false;
    }
    return true;
  });
}
__name(filterRooms, "filterRooms");
function compareRooms(a, b) {
  const ac = a.cash ?? Number.POSITIVE_INFINITY;
  const bc = b.cash ?? Number.POSITIVE_INFINITY;
  if (ac !== bc) return ac - bc;
  const ap = a.points ?? Number.POSITIVE_INFINITY;
  const bp = b.points ?? Number.POSITIVE_INFINITY;
  return ap - bp;
}
__name(compareRooms, "compareRooms");
async function findAvailability(params) {
  if (!params || typeof params !== "object") {
    throw new Error("hilton-awards.findAvailability: pass a single options object {ctyhocn, startDate, endDate, ...}");
  }
  if (!params.ctyhocn) throw new Error("hilton-awards.findAvailability: ctyhocn is required");
  assertDate("startDate", params.startDate);
  assertDate("endDate", params.endDate);
  if (params.endDate < params.startDate) {
    throw new Error(`hilton-awards.findAvailability: endDate (${params.endDate}) must be >= startDate (${params.startDate})`);
  }
  const ctyhocn = params.ctyhocn.toUpperCase();
  const nights = Math.max(1, params.nights ?? 1);
  const numAdults = params.numAdults ?? 1;
  const numChildren = params.numChildren ?? 0;
  const numRooms = params.numRooms ?? 1;
  const guestLocationCountry = params.guestLocationCountry ?? "US";
  const mode = params.mode === "points" ? "points" : "cash";
  const concurrency = params.concurrency ?? 4;
  const retries = params.retries ?? 2;
  const includeRaw = params.includeRaw === true;
  const filters = params.filters;
  const checkins = dateRangeInclusive(params.startDate, params.endDate);
  const tasks = checkins.map((date) => async () => {
    const checkout = addDays(date, nights);
    try {
      const stay = await getStayRates({
        ctyhocn,
        arrivalDate: date,
        departureDate: checkout,
        numAdults,
        numChildren,
        numRooms,
        guestLocationCountry,
        retries
      });
      if (stay.status === "invalid_operation" || stay.status === "graphql_error" || stay.status === "http_error") {
        return {
          date,
          checkout,
          status: "error",
          rooms: [],
          awardRoomCount: null,
          error: `${stay.status}: ${stay.error ?? ""}`.trim()
        };
      }
      const summaries = stay.rooms.map(
        (r) => summarizeRoom(r, {
          date,
          nights,
          currency: stay.currencyCode,
          awardRoomsExist: !!(stay.awardRoomCount && stay.awardRoomCount > 0)
        })
      );
      const filtered = filterRooms(summaries, filters);
      filtered.sort(compareRooms);
      return {
        date,
        checkout,
        status: stay.status === "sold_out" || filtered.length === 0 ? stay.status === "sold_out" ? "sold_out" : "available" : "available",
        rooms: filtered,
        awardRoomCount: stay.awardRoomCount,
        raw: includeRaw ? stay.rooms : void 0
      };
    } catch (err) {
      return {
        date,
        checkout,
        status: "error",
        rooms: [],
        awardRoomCount: null,
        error: err?.message ?? String(err)
      };
    }
  });
  const days = await runWithConcurrency(tasks, concurrency);
  const available = days.filter((d) => d.status === "available" && d.rooms.length > 0);
  const errors = days.filter((d) => d.status === "error").map((d) => ({ date: d.date, error: d.error ?? "unknown error" }));
  const awardRoomsSeen = days.some((d) => (d.awardRoomCount ?? 0) > 0);
  let cashBest = null;
  let pointsBest = null;
  for (const d of available) {
    for (const r of d.rooms) {
      if (r.cash != null && (!cashBest || r.cash < cashBest.cash)) {
        cashBest = { date: d.date, cash: r.cash, currency: r.currency ?? "", roomTypeCode: r.roomTypeCode };
      }
      if (r.points != null && (!pointsBest || r.points < pointsBest.points)) {
        pointsBest = { date: d.date, points: r.points, roomTypeCode: r.roomTypeCode };
      }
    }
  }
  return {
    ctyhocn,
    mode,
    nights,
    startDate: params.startDate,
    endDate: params.endDate,
    days,
    available,
    cashBest,
    pointsBest,
    awardRoomsSeen,
    scanned: days.length,
    errors
  };
}
__name(findAvailability, "findAvailability");

export default defineSkill({
  filterRooms: fn({
    summary: "post-search filter.",
    input: z.any().optional(),
    handler: async (params) => filterRooms(params),
  }),
  findAvailability: fn({
    summary: "★ main entry. Date range → per-night calendar.",
    input: z.any().optional(),
    handler: async (params) => findAvailability(params),
  }),
  getStayRates: fn({
    summary: "raw single GraphQL call for one check-in/check-out.",
    input: z.any().optional(),
    handler: async (params) => getStayRates(params),
  }),
  summarizeRoom: fn({
    summary: "normalize one room from a getStayRates response.",
    input: z.any().optional(),
    handler: async (params) => summarizeRoom(params),
  }),
});

