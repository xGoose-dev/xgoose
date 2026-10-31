// ==XGooseSkill==
// @name         hyatt-awards
// @namespace    hyatt
// @version      0.3.2
// @description  World of Hyatt award/cash search + Pay My Way + promo tracker. Same-origin scraper for hyatt.com.
// @match        *://www.hyatt.com/*
// @detect       location.hostname === 'www.hyatt.com'
// @run-at       document_idle
// @primary      findAvailability
// @connect      <self>
// @keyword      hyatt
// @keyword      world of hyatt
// @keyword      award
// @keyword      points
// @keyword      pay my way
// @keyword      凯悦
// ==/XGooseSkill==

/**
 * Hyatt roomrates wrapper.
 *
 * Endpoints:
 *   GET /en-US/shop/service/rooms/roomrates/{spiritCode}?...   (anonymous OK)
 *   GET /profile/api/member/profile                            (login required)
 *   GET /shop/itinerize/{spirit}/{ratePlan}/{roomType}         (PMW page)
 *
 * Field reference:
 *   room.lowestPointValue   = points/night (null = no award)
 *   room.lowestCashRate     = member cash rate, AVG per-night (NOT total)
 *   room.lowestPublicRate   = non-member cash rate, AVG per-night
 *   ratePlan.totalPoints    = points × nights for the queried stay
 *   responseInfo === 'soldOutHotel' = no availability
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const ModeSchema = z.enum(['points', 'cash']);

const ROOMRATES_BASE = '/shop/service/rooms/roomrates';
const PROFILE_ENDPOINT = '/profile/api/member/profile';

function addDays(yyyymmdd, delta) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function dateRange(startDate, endDate) {
  const out = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function nightsBetween(checkin, checkout) {
  const c = Date.UTC(+checkin.slice(0, 4), +checkin.slice(5, 7) - 1, +checkin.slice(8, 10));
  const o = Date.UTC(+checkout.slice(0, 4), +checkout.slice(5, 7) - 1, +checkout.slice(8, 10));
  return Math.max(0, Math.round((o - c) / 86_400_000));
}

async function runWithConcurrency(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const workers = [];
  const concurrency = Math.max(1, Math.min(limit | 0 || 1, tasks.length));
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = next++;
          if (idx >= tasks.length) return;
          out[idx] = await tasks[idx]();
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

function buildRatesUrl(opts) {
  const sc = opts.spiritCode.toLowerCase();
  const params = new URLSearchParams({
    spiritCode: sc,
    rooms: String(opts.rooms),
    adults: String(opts.adults),
    kids: String(opts.kids),
    checkinDate: opts.checkinDate,
    checkoutDate: opts.checkoutDate,
    accessibilityCheck: 'false',
    suiteUpgrade: 'true',
    rate: opts.mode === 'cash' ? 'Standard' : 'Points',
  });
  return `${ROOMRATES_BASE}/${sc}?${params.toString()}`;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-cache',
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const head = (await r.text()).slice(0, 300);
    throw new Error(`GET ${url} -> non-JSON "${ct}": ${head}`);
  }
  return await r.json();
}

function summarizeRoom(room, ctx) {
  const points = room.lowestPointValue;
  const nights = ctx?.nights ?? 1;
  return {
    date: ctx?.date ?? '',
    nights,
    roomTypeCode: room.roomTypeCode,
    title: room.roomType?.title ?? room.roomTypeCode,
    roomCategory: room.roomCategory,
    points,
    pointsTotal: points == null ? null : points * nights,
    cashAvgPerNight: room.lowestCashRate,
    cashAvgPerNightPublic: room.lowestPublicRate,
    currencyCode: room.currencyCode,
    roomQuantity: room.roomQuantity,
    pointsRatePlanCode: room.lowestPointRatePlanCode,
    cashRatePlanCode: room.lowestCashRatePlanCode,
    thumbnail: room.roomType?.thumbnail,
  };
}

function asArray(v) {
  if (v == null) return undefined;
  return Array.isArray(v) ? v : [v];
}

function applyFilters(items, filters) {
  if (!filters) return items.slice();
  const cats = asArray(filters.roomCategory);
  const codes = asArray(filters.roomTypeCode);
  const minQty = filters.minRoomQuantity ?? 0;
  return items.filter((r) => {
    if (cats && !cats.includes(r.roomCategory)) return false;
    if (codes && !codes.includes(r.roomTypeCode)) return false;
    if (filters.pointsOnly && r.points == null) return false;
    if (filters.cashOnly && r.cashAvgPerNight == null) return false;
    if (filters.maxPoints != null && (r.points == null || r.points > filters.maxPoints)) return false;
    if (filters.maxCash != null && (r.cashAvgPerNight == null || r.cashAvgPerNight > filters.maxCash)) return false;
    if (minQty > 0 && (r.roomQuantity == null || r.roomQuantity < minQty)) return false;
    return true;
  });
}

function compareRooms(a, b) {
  const ap = a.points ?? Number.POSITIVE_INFINITY;
  const bp = b.points ?? Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  const ac = a.cashAvgPerNight ?? Number.POSITIVE_INFINITY;
  const bc = b.cashAvgPerNight ?? Number.POSITIVE_INFINITY;
  return ac - bc;
}

async function fetchProfileJson() {
  const r = await fetch(PROFILE_ENDPOINT, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-cache',
    headers: { Accept: 'application/json' },
  });
  if (r.status === 401 || r.status === 403) return { status: 'session_expired', profile: null };
  if (!r.ok) return { status: 'unknown', profile: null };
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) return { status: 'session_expired', profile: null };
  return { status: 'ok', profile: await r.json() };
}

function safeNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function fmtMc20Date(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function daysUntil(yyyymmdd) {
  if (!yyyymmdd) return null;
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Math.round((target - now) / 86_400_000);
}

const CHALLENGE_HINTS = ['CHAL', 'CHALL', 'CHALLENGE', 'STATUSMATCH', 'STATUS_MATCH', 'SM24', 'SM25', 'SM26'];
function looksLikeChallenge(code) {
  const upper = (code ?? '').toUpperCase();
  return CHALLENGE_HINTS.some((hint) => upper.includes(hint));
}

function extractPromos(profile) {
  const promos = profile?.profile?.extended?.pr01_promo_status?.message_promo;
  if (!Array.isArray(promos)) return [];
  return promos.map((p) => {
    const expiresAt = fmtMc20Date(p.mc20_end_date);
    const code = String(p.mc20_promo ?? '').trim();
    return {
      code,
      expiresAt,
      daysUntilExpiry: daysUntil(expiresAt),
      staysAccum: safeNum(p.pr01_stays_accum),
      nightsAccum: safeNum(p.pr01_nights_accum),
      fulfillCount: safeNum(p.pr01_fulfill_cnt),
      complete: p.promo_complete === 'Y' || p.promo_complete === true,
      isChallenge: looksLikeChallenge(code),
      raw: p,
    };
  });
}

async function getStayRatesImpl(params) {
  const adults = params.adults ?? 1;
  const rooms = params.rooms ?? 1;
  const kids = params.kids ?? 0;
  const mode = params.mode === 'cash' ? 'cash' : 'points';
  if (params.checkoutDate <= params.checkinDate) {
    throw new Error(`checkoutDate (${params.checkoutDate}) must be after checkinDate (${params.checkinDate})`);
  }
  const url = buildRatesUrl({
    spiritCode: params.spiritCode,
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    adults,
    rooms,
    kids,
    mode,
  });
  const json = await fetchJson(url);
  const rooms_ = json.roomRates ? Object.values(json.roomRates) : [];
  const responseInfo = json.responseInfo ?? null;
  return {
    spiritCode: params.spiritCode.toLowerCase(),
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    nights: nightsBetween(params.checkinDate, params.checkoutDate),
    status: rooms_.length === 0 || responseInfo === 'soldOutHotel' ? 'sold_out' : 'available',
    rooms: rooms_,
    responseInfo,
  };
}

const FiltersSchema = z
  .object({
    roomCategory: z.union([z.string(), z.array(z.string())]).optional(),
    roomTypeCode: z.union([z.string(), z.array(z.string())]).optional(),
    maxPoints: z.number().int().positive().optional(),
    maxCash: z.number().positive().optional(),
    minRoomQuantity: z.number().int().min(0).optional(),
    pointsOnly: z.boolean().optional(),
    cashOnly: z.boolean().optional(),
  })
  .optional();

export default defineSkill({
  pointsCalendarUrl: fn({summary:'Current Hyatt CLI calendar-page route; length of stay is part of the query.',input:z.object({spiritCode:z.string(),startDate:z.string(),endDate:z.string(),adults:z.number().optional(),rooms:z.number().optional(),kids:z.number().optional()}),handler:({spiritCode,startDate,endDate,adults=1,rooms=1,kids=0})=>`https://www.hyatt.com/explore-hotels/rate-calendar?${new URLSearchParams({spiritCode,startDate,endDate,adults:String(adults),rooms:String(rooms),kids:String(kids),rate:'Standard',vrcEnabled:'true'})}`}),
  readCurrentCalendar: fn({summary:'Read the currently rendered rate calendar; retains the website text and source URL.',input:z.object({}),handler:()=>({url:location.href,text:document.querySelector('main')?.innerText || document.body.innerText})}),
  searchHotels: fn({summary:'Find Hyatt spirit codes using the website hotel directory.',input:z.object({query:z.string(),offset:z.number().optional(),limit:z.number().optional()}),examples:[{args:{query:'Tokyo'}}],handler:async({query,offset=0,limit=20})=>{
    const data=await fetchJson('/explore-hotels/service/hotels');
    const hits=Object.entries(data).filter(([code,hotel])=>JSON.stringify([code,hotel.name,hotel.location]).toLowerCase().includes(query.toLowerCase())).map(([spiritCode,hotel])=>({spiritCode,...hotel}));
    return {total:hits.length,hotels:hits.slice(offset,offset+limit),nextOffset:offset+Math.min(limit,hits.length-offset)};
  }}),
  findAvailability: fn({
    summary:
      'Scan award/cash availability across a date window for one property; returns best per-day + overall best. ★ primary entry.',
    input: z.object({
      spiritCode: z.string().describe('Hyatt property "spirit" code (e.g. "atlpw" for Park Hyatt Atlanta).'),
      startDate: z.string().regex(DATE_RX),
      endDate: z.string().regex(DATE_RX),
      nights: z.number().int().min(1).optional(),
      adults: z.number().int().min(1).optional(),
      rooms: z.number().int().min(1).optional(),
      kids: z.number().int().min(0).optional(),
      mode: ModeSchema.optional(),
      concurrency: z.number().int().min(1).max(12).optional(),
      filters: FiltersSchema,
      includeRaw: z.boolean().optional(),
    }),
    examples: [{ args: { spiritCode: 'atlpw', startDate: '2026-09-01', endDate: '2026-09-14' } }],
    handler: async (params) => {
      if (params.endDate < params.startDate) {
        throw new Error(`endDate (${params.endDate}) must be >= startDate (${params.startDate})`);
      }
      const nights = Math.max(1, params.nights ?? 1);
      const mode = params.mode === 'cash' ? 'cash' : 'points';
      const concurrency = params.concurrency ?? 6;
      const checkins = dateRange(params.startDate, params.endDate);
      const tasks = checkins.map((date) => async () => {
        const checkout = addDays(date, nights);
        try {
          const stay = await getStayRatesImpl({
            spiritCode: params.spiritCode,
            checkinDate: date,
            checkoutDate: checkout,
            adults: params.adults,
            rooms: params.rooms,
            kids: params.kids,
            mode,
          });
          const summaries = stay.rooms.map((r) => summarizeRoom(r, { date, nights }));
          const filtered = applyFilters(summaries, params.filters);
          filtered.sort(compareRooms);
          return {
            date,
            checkout,
            status: stay.status,
            rooms: filtered,
            raw: params.includeRaw ? stay.rooms : undefined,
          };
        } catch (err) {
          return { date, checkout, status: 'error', rooms: [], error: err?.message ?? String(err) };
        }
      });
      const days = await runWithConcurrency(tasks, concurrency);
      const available = days.filter((d) => d.status === 'available' && d.rooms.length > 0);
      const errors = days
        .filter((d) => d.status === 'error')
        .map((d) => ({ date: d.date, error: d.error ?? 'unknown error' }));
      let pointsBest = null;
      let cashBest = null;
      for (const d of available) {
        for (const r of d.rooms) {
          if (r.points != null && (!pointsBest || r.points < pointsBest.points)) {
            pointsBest = { date: d.date, points: r.points, roomTypeCode: r.roomTypeCode, roomCategory: r.roomCategory };
          }
          if (r.cashAvgPerNight != null && (!cashBest || r.cashAvgPerNight < cashBest.cash)) {
            cashBest = { date: d.date, cash: r.cashAvgPerNight, currencyCode: r.currencyCode ?? '', roomTypeCode: r.roomTypeCode };
          }
        }
      }
      return {
        spiritCode: params.spiritCode.toLowerCase(),
        mode,
        nights,
        startDate: params.startDate,
        endDate: params.endDate,
        days,
        available,
        pointsBest,
        cashBest,
        scanned: days.length,
        errors,
      };
    },
  }),

  getStayRates: fn({
    summary: 'Fetch raw roomrates for a single multi-night stay.',
    input: z.object({
      spiritCode: z.string(),
      checkinDate: z.string().regex(DATE_RX),
      checkoutDate: z.string().regex(DATE_RX),
      adults: z.number().int().min(1).optional(),
      rooms: z.number().int().min(1).optional(),
      kids: z.number().int().min(0).optional(),
      mode: ModeSchema.optional(),
    }),
    handler: async (p) => getStayRatesImpl(p),
  }),

  summarizeRoom: fn({
    summary: 'Normalize one RoomRate (from getStayRates().rooms[]) into a flat RoomSummary.',
    input: z.object({
      room: z.any(),
      date: z.string().optional(),
      nights: z.number().int().min(1).optional(),
    }),
    handler: async ({ room, date, nights }) => summarizeRoom(room, { date, nights }),
  }),

  filterRooms: fn({
    summary: 'Apply RoomFilters to an array of RoomSummary.',
    input: z.object({
      rooms: z.array(z.any()),
      filters: FiltersSchema,
    }),
    handler: async ({ rooms, filters }) => applyFilters(rooms, filters),
  }),

  getMyPromotions: fn({
    summary: 'List all promotions on the current account (login required).',
    input: z.object({}),
    handler: async () => {
      const r = await fetchProfileJson();
      if (r.status !== 'ok') return { status: r.status, promotions: [] };
      return { status: 'ok', promotions: extractPromos(r.profile) };
    },
  }),

  getMyChallenges: fn({
    summary: 'Filtered subset of promotions that look like status-match / challenges.',
    input: z.object({}),
    handler: async () => {
      const r = await fetchProfileJson();
      if (r.status !== 'ok') return { status: r.status, challenges: [] };
      const all = extractPromos(r.profile);
      return { status: 'ok', challenges: all.filter((p) => p.isChallenge) };
    },
  }),

  payMyWayUrl: fn({
    summary: 'Build a Pay-My-Way /shop/itinerize URL for a specific rate plan + room type.',
    input: z.object({
      spiritCode: z.string(),
      ratePlan: z.string().describe('Rate plan code, e.g. "LPRM", "MYHIAP".'),
      roomType: z.string().describe('Room type code, e.g. "KNGX".'),
    }),
    handler: async ({ spiritCode, ratePlan, roomType }) => {
      return `https://www.hyatt.com/shop/itinerize/${spiritCode.toLowerCase()}/${ratePlan}/${roomType}`;
    },
  }),

  getPayMyWayQuote: fn({
    summary: 'Fetch a Pay My Way quote page and best-effort extract the cash + points total.',
    input: z.object({
      spiritCode: z.string(),
      ratePlan: z.string(),
      roomType: z.string(),
      checkinDate: z.string().regex(DATE_RX),
      checkoutDate: z.string().regex(DATE_RX),
      adults: z.number().int().min(1).optional(),
      rooms: z.number().int().min(1).optional(),
      kids: z.number().int().min(0).optional(),
    }),
    handler: async (params) => {
      const url = `https://www.hyatt.com/shop/itinerize/${params.spiritCode.toLowerCase()}/${params.ratePlan}/${params.roomType}`;
      const sp = new URLSearchParams({
        rooms: String(params.rooms ?? 1),
        adults: String(params.adults ?? 1),
        kids: String(params.kids ?? 0),
        checkinDate: params.checkinDate,
        checkoutDate: params.checkoutDate,
      });
      const r = await fetch(`${url}?${sp.toString()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-cache',
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      });
      if (r.type === 'opaqueredirect' || r.status === 302) return { status: 'session_expired', quote: null };
      if (r.status === 404 || r.status === 410) return { status: 'pmw_disabled', quote: null };
      if (!r.ok) return { status: 'sold_out', quote: null };
      const html = await r.text();
      if (/sold\s*out|no\s*availability/i.test(html.slice(0, 5000))) return { status: 'sold_out', quote: null };
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const cashMatch = html.match(/Total[^<]*<[^>]+>\s*\$([\d,]+(?:\.\d+)?)/i);
      const pointsMatch = html.match(/([\d,]+)\s*Points\s*Total/i);
      const fnMatch = html.match(/(\d+)\s+Free\s+Night/i);
      return {
        status: 'ok',
        quote: {
          itinerizeUrl: url,
          spiritCode: params.spiritCode.toLowerCase(),
          ratePlan: params.ratePlan,
          roomType: params.roomType,
          pageTitle: titleMatch?.[1]?.trim(),
          totalCash: cashMatch ? Number(cashMatch[1].replace(/,/g, '')) : null,
          totalPoints: pointsMatch ? Number(pointsMatch[1].replace(/,/g, '')) : null,
          freeNightsAvailable: fnMatch ? Number(fnMatch[1]) : undefined,
        },
      };
    },
  }),
});
