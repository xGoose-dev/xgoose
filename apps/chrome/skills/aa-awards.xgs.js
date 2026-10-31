// ==XGooseSkill==
// @name         aa-awards
// @namespace    aaAwards
// @version      0.3.1
// @description  American Airlines award/cash calendar scanner. Same-origin POST to www.aa.com/booking/api/search/calendar.
// @match        *://www.aa.com/*
// @match        *://aa.com/*
// @detect       location.hostname.endsWith('aa.com')
// @run-at       document_idle
// @primary      scanMonths
// @connect      <self>
// @keyword      american airlines
// @keyword      AA
// @keyword      AAdvantage
// @keyword      award
// @keyword      miles
// @keyword      business class
// ==/XGooseSkill==

// AA monthly calendar API; search UI reference:
// https://github.com/markswendsen-code/mcp-american/blob/main/src/browser.ts
// Calendar points and cash are returned per passenger by AA.

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const CabinSchema = z.enum(['COACH', 'PREMIUM_COACH', 'BUSINESS,FIRST']);
const MaxStopsSchema = z.enum(['0', '1', '2']);
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RX = /^\d{4}-\d{2}$/;
const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ENDPOINT = 'https://www.aa.com/booking/api/search/calendar';

const TYO_CITY = new Set(['NRT', 'HND', 'TYO']);
const LON_CITY = new Set(['LHR', 'LGW', 'STN', 'LCY', 'LON']);
const NYC_CITY = new Set(['JFK', 'LGA', 'EWR', 'NYC']);

function dayOfWeek(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return DAYS_OF_WEEK[dt.getUTCDay()];
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pickDepDate(month, today = todayIso()) {
  const currentMonth = today.slice(0, 7);
  if (month < currentMonth) return null;
  if (month === currentMonth) return today;
  return `${month}-01`;
}

function enumerateMonths(fromMonth, toMonth) {
  if (toMonth < fromMonth) return [];
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [yEnd, mEnd] = toMonth.split('-').map(Number);
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isSameCity(a, b) {
  if (a === b) return true;
  return (
    (TYO_CITY.has(a) && TYO_CITY.has(b)) ||
    (LON_CITY.has(a) && LON_CITY.has(b)) ||
    (NYC_CITY.has(a) && NYC_CITY.has(b))
  );
}

function buildBody(p) {
  return JSON.stringify({
    metadata: { selectedProducts: [], tripType: 'OneWay', udo: {} },
    passengers: [{ type: 'adult', count: p.adults ?? 1 }],
    requestHeader: { clientId: 'AAcom' },
    slices: [
      {
        allCarriers: true,
        cabin: p.cabin,
        departureDate: p.depDate,
        destination: p.destination,
        destinationNearbyAirports: false,
        maxStops: p.maxStops,
        origin: p.origin,
        originNearbyAirports: false,
      },
    ],
    tripOptions: {
      corporateBooking: false,
      fareType: 'Lowest',
      locale: 'en_US',
      pointOfSale: null,
      searchType: 'Award',
    },
    loyaltyInfo: null,
    version: '',
    queryParams: { sliceIndex: 0, sessionId: '', solutionSet: '', solutionId: '' },
  });
}

async function rawFetch(p) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-cache',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: buildBody({
      origin: p.origin,
      destination: p.destination,
      depDate: p.depDate,
      cabin: p.cabin ?? 'BUSINESS,FIRST',
      maxStops: p.maxStops ?? '1',
      adults: p.adults ?? 1,
    }),
  });

  if (r.status === 403) {
    const text = await r.text().catch(() => '');
    if (/access denied|_abck|akam/i.test(text)) {
      return { status: 'akamai_blocked', httpStatus: 403, message: text.slice(0, 200) };
    }
    return { status: 'http_error', httpStatus: 403, message: text.slice(0, 200) };
  }
  if (r.status === 429) return { status: 'rate_limited', httpStatus: 429 };
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return { status: 'http_error', httpStatus: r.status, message: text.slice(0, 200) };
  }
  const body = await r.json().catch(() => ({}));
  return { status: 'ok', body };
}

function summarize(p) {
  const cap = p.maxAwardPoints ?? Infinity;
  const out = [];
  for (const month of p.raw.raw?.calendarMonths ?? []) {
    for (const week of month?.weeks ?? []) {
      for (const day of week?.days ?? []) {
        if (!day?.validDay) continue;
        const sol = day.solution;
        if (!sol) continue;
        const points = sol.perPassengerAwardPoints;
        if (typeof points !== 'number' || points <= 0 || points > cap) continue;
        const cash = sol.perPassengerSaleTotal?.amount ?? null;
        const currency = sol.perPassengerSaleTotal?.currency ?? null;
        out.push({
          date: day.date,
          dayOfWeek: dayOfWeek(day.date),
          origin: p.raw.origin,
          destination: p.raw.destination,
          cabin: p.raw.cabin,
          points,
          cash,
          adults: p.raw.adults ?? 1,
          priceBasis: 'per_passenger',
          currency,
          bookingUrl: makeBookingUrl({
            origin: p.raw.origin,
            destination: p.raw.destination,
            depart: day.date,
            cabin: p.raw.cabin,
            adults: p.raw.adults ?? 1,
          }),
        });
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function makeBookingUrl({ origin, destination, depart, cabin, adults = 1 }) {
  const sp = new URLSearchParams({
    type: 'OneWay',
    searchType: 'Award',
    from: origin,
    to: destination,
    pax: String(adults),
    cabin: cabin ?? 'BUSINESS,FIRST',
    locale: 'en_US',
    nearbyAirports: 'false',
    depart,
    carriers: 'ALL',
    pos: 'US',
    adult: String(adults),
  });
  return `https://www.aa.com/booking/search?${sp.toString()}`;
}

export default defineSkill({
  scanMonths: fn({
    summary: 'Scan AA award availability across origins × destinations × months. ★ primary entry.',
    input: z.object({
      origins: z.array(z.string()).min(1).describe('IATA codes, e.g. ["DFW", "JFK"]'),
      destinations: z.array(z.string()).min(1).describe('IATA codes, e.g. ["NRT", "HND"]'),
      fromMonth: z.string().regex(MONTH_RX).describe('YYYY-MM'),
      toMonth: z.string().regex(MONTH_RX).describe('YYYY-MM'),
      cabin: CabinSchema.optional().describe('Default "BUSINESS,FIRST"'),
      adults: z.number().int().min(1).max(9).optional(),
      maxStops: MaxStopsSchema.optional().describe('Default "1"'),
      delayMs: z.number().int().min(0).max(10000).optional().describe('Throttle between probes. Default 300.'),
      maxAwardPoints: z.number().positive().optional().describe('Maximum points per passenger, inclusive.'),
    }),
    examples: [
      {
        args: {
          origins: ['DFW'],
          destinations: ['NRT', 'HND'],
          fromMonth: '2026-06',
          toMonth: '2026-08',
          cabin: 'BUSINESS,FIRST',
        },
      },
    ],
    handler: async (p) => {
      const months = enumerateMonths(p.fromMonth, p.toMonth);
      if (!months.length) {
        throw new Error(`scanMonths: toMonth (${p.toMonth}) must be >= fromMonth (${p.fromMonth})`);
      }
      const cabin = p.cabin ?? 'BUSINESS,FIRST';
      const maxStops = p.maxStops ?? '1';
      const delayMs = Math.max(0, p.delayMs ?? 300);
      const cap = p.maxAwardPoints ?? Infinity;

      const today = todayIso();
      const tasks = [];
      const skippedNotes = [];
      for (const m of months) {
        const depDate = pickDepDate(m, today);
        if (!depDate) {
          skippedNotes.push(`skipped ${m}: month is fully in the past (today ${today})`);
          continue;
        }
        for (const o of p.origins) {
          for (const d of p.destinations) {
            if (isSameCity(o, d)) continue;
            tasks.push({ origin: o, destination: d, depDate });
          }
        }
      }

      const hits = [];
      const notes = [...skippedNotes];
      let failed = 0;
      let rateLimited = 0;
      let blocked = false;

      for (const t of tasks) {
        if (blocked) {
          failed++;
          continue;
        }
        const r = await rawFetch({ ...t, cabin, maxStops, adults: p.adults ?? 1 });
        if (r.status === 'akamai_blocked') {
          blocked = true;
          failed++;
          notes.push(`akamai blocked at ${t.origin}→${t.destination} ${t.depDate}; aborting`);
          break;
        }
        if (r.status === 'rate_limited') {
          failed++;
          rateLimited++;
          notes.push(`rate limited at ${t.origin}→${t.destination} ${t.depDate}; bump delayMs`);
          continue;
        }
        if (r.status !== 'ok') {
          failed++;
          notes.push(`HTTP ${r.httpStatus ?? '?'} on ${t.origin}→${t.destination} ${t.depDate}`);
          continue;
        }
        const month = { raw: r.body ?? {}, origin: t.origin, destination: t.destination, depDate: t.depDate, cabin, adults: p.adults ?? 1 };
        const monthHits = summarize({ raw: month, maxAwardPoints: cap });
        hits.push(...monthHits);
        if (delayMs) await sleep(delayMs);
      }
      hits.sort((a, b) => a.date.localeCompare(b.date) || a.points - b.points);

      let status;
      if (blocked) status = 'akamai_blocked';
      else if (rateLimited > 0 && hits.length === 0) status = 'rate_limited';
      else if (failed > 0 && hits.length > 0) status = 'partial';
      else if (failed > 0) status = 'http_error';
      else if (hits.length === 0) status = 'no_availability';
      else status = 'ok';
      return { status, hits, scanned: tasks.length, failed, notes };
    },
  }),

  searchCalendar: fn({
    summary: 'Fetch one month of AA calendar availability for a single origin+destination+date.',
    input: z.object({
      origin: z.string().min(3),
      destination: z.string().min(3),
      depDate: z.string().regex(DATE_RX),
      cabin: CabinSchema.optional(),
      adults: z.number().int().min(1).max(9).optional(),
      maxStops: MaxStopsSchema.optional(),
    }),
    handler: async (p) => {
      const cabin = p.cabin ?? 'BUSINESS,FIRST';
      const result = await rawFetch(p);
      if (result.status !== 'ok') {
        throw new Error(`searchCalendar: ${result.status} (HTTP ${result.httpStatus ?? '?'})`);
      }
      return { raw: result.body ?? {}, origin: p.origin, destination: p.destination, depDate: p.depDate, cabin, adults: p.adults ?? 1 };
    },
  }),

  getCalendar: fn({
    summary: "Monthly calendar normalized to per-passenger points, cash, currency and booking links.",
    input: z.object({origin: z.string(), destination: z.string(), depDate: z.string().regex(DATE_RX), adults: z.number().int().min(1).max(9).optional(), cabin: CabinSchema.optional(), maxStops: MaxStopsSchema.optional(), maxAwardPoints: z.number().positive().optional()}),
    examples: [{args: {origin: "DFW", destination: "LHR", depDate: "2026-12-01", adults: 2}}],
    handler: async p => {
      const result = await rawFetch(p);
      if (result.status !== "ok") return result;
      return {status: "ok", origin: p.origin, destination: p.destination, adults: p.adults ?? 1, hits: summarize({raw: {raw: result.body, ...p}, maxAwardPoints: p.maxAwardPoints}), source: ENDPOINT};
    },
  }),

  summarizeCalendar: fn({
    summary: 'Normalize the raw response from searchCalendar into a hits array.',
    input: z.object({
      raw: z.any(),
      maxAwardPoints: z.number().positive().optional(),
    }),
    handler: async (p) => summarize(p),
  }),

  bookingUrl: fn({
    summary: 'Build the aa.com /booking/search URL pre-populated with the given trip.',
    input: z.object({
      origin: z.string(),
      destination: z.string(),
      depart: z.string().regex(DATE_RX),
      cabin: CabinSchema.optional(),
      adults: z.number().int().min(1).max(9).optional(),
    }),
    handler: async (p) => makeBookingUrl(p),
  }),
});
