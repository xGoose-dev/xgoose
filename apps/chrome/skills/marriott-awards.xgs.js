// ==XGooseSkill==
// @name         marriott-awards
// @namespace    marriott
// @version      0.2.0
// @description  Marriott Bonvoy property calendar search. Same-origin scraper for phoenixShopADFSearchProductsByProperty GraphQL endpoint with persisted-query allowlisting.
// @match        *://www.marriott.com/*
// @detect       location.hostname === 'www.marriott.com'
// @run-at       document_idle
// @primary      findAvailability
// @connect      <self>
// @keyword      marriott
// @keyword      bonvoy
// @keyword      ritz-carlton
// @keyword      st regis
// @keyword      edition
// @keyword      luxury collection
// @keyword      JW marriott
// @keyword      westin
// @keyword      sheraton
// @keyword      万豪
// @keyword      丽思卡尔顿
// @keyword      瑞吉
// @keyword      艾迪逊
// @keyword      豪华精选
// @keyword      hotel
// ==/XGooseSkill==

/**
 * Marriott Bonvoy property calendar search.
 *
 * Endpoint: POST /mi/query/phoenixShopADFSearchProductsByProperty
 * Reverse-engineered from Marriott's /search/availabilityCalendar.mi UI.
 *
 * Akamai bot protection:
 *   - Persisted-query signature header is required (SHA of GraphQL query text).
 *   - Bursts trigger multi-minute cooldown. Throttle: concurrency 1, 750ms inter-call.
 *   - Sensor cookies (_abck/bm_*) expire if the marriott.com tab is idle.
 *     First call may 403 → status: 'akamai_blocked' → tell the user to refresh tab.
 *   - When Marriott deploys a new bundle, signature goes stale → status: 'stale_signature'
 *     → re-capture from /search/availabilityCalendar.mi.
 *
 * Field reference (LLMs kept getting wrong):
 *   edge.node.rateModes.lowestAverageRate.amount.amount    // average per-night cash, in `currency` units
 *   edge.node.rateModes.lowestAverageRate.amount.currency  // 'JPY' | 'USD' | ...
 *   edge.node.rateModes.lowestAverageRate.amount.decimalPoint  // divide raw amount by 10^this
 *   edge.node.rateModes.pointsPerQuantity?.points          // null for anonymous; per-night when logged in
 *   edge.node.startDate / endDate                          // INCLUSIVE rate window. expand back into per-night.
 *
 * Limitations (v0.2):
 *   - Cash-only. Anonymous always has pointsPerQuantity: null. Points pricing
 *     needs a logged-in Bonvoy session (planned).
 *   - No destination search. Caller must know propertyCode (5-letter MARSHA).
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const GQL_URL = '/mi/query/phoenixShopADFSearchProductsByProperty';
const GQL_OP = 'phoenixShopADFSearchProductsByProperty';

const GQL_SIGNATURE = '887375892e1ad2a43f46a9c95c55ea47cf6eca3af03331c2134f1b440cff3f9f';

const GQL_QUERY = `query phoenixShopADFSearchProductsByProperty($search: CalendarSearchByPropertyInput!, $id: [ID!]!) {
  search {
    calendarSearchByProperty(search: $search) {
      total
      edges {
        node {
          endDate
          startDate
          rateModes {
            lowestAverageRate {
              amount {
                currency
                amount
                decimalPoint
                __typename
              }
              __typename
            }
            pointsPerQuantity {
              points
              __typename
            }
            totalRate {
              amount {
                amount
                currency
                decimalPoint
                __typename
              }
              __typename
            }
            sourceOfRate
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
  propertiesByIds(ids: $id) {
    basicInformation {
      isAdultsOnly
      descriptions(
        filter: [RESORT_FEE_DESCRIPTION, DESTINATION_FEE_DESCRIPTION, SURCHARGE_ORDINANCE_COST_DESCRIPTION]
      ) {
        type {
          enumCode
          __typename
        }
        __typename
      }
      resort
      __typename
    }
    __typename
  }
}
`;

const GQL_HEADERS = {
  'application-name': 'shop',
  'apollographql-client-name': 'phoenix_shop',
  'apollographql-client-version': 'v1',
  'content-type': 'application/json',
  accept: '*/*',
  'graphql-operation-name': GQL_OP,
  'graphql-operation-signature': GQL_SIGNATURE,
  'graphql-require-safelisting': 'true',
};

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_DAYS = 32;
const INTER_CALL_MS = 750;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addDays(yyyymmdd, delta) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function dateRangeInclusive(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function dayOfWeek(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function decodeMoney(m) {
  if (!m || m.amount == null) return null;
  const dp = typeof m.decimalPoint === 'number' ? m.decimalPoint : 0;
  return m.amount / Math.pow(10, dp);
}

async function callGqlOnce(body) {
  const r = await fetch(GQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: GQL_HEADERS,
    body: JSON.stringify(body),
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

function classify403(bodyText) {
  if (/errors\.edgesuite\.net|Access Denied/i.test(bodyText)) return 'akamai_blocked';
  return 'stale_signature';
}

function summarizeNightInternal(input) {
  return {
    date: input.date,
    status: input.cash != null || input.points != null ? 'available' : 'sold_out',
    cash: input.cash,
    cashTotal: input.cashTotal,
    currency: input.currency,
    points: input.points,
    sourceOfRate: input.sourceOfRate,
    rateMode: input.rateMode,
  };
}

function filterNightsInternal(items, filters) {
  if (!filters) return items.slice();
  return items.filter((n) => {
    if (filters.cashOnly && n.cash == null) return false;
    if (filters.pointsOnly && n.points == null) return false;
    if (filters.maxCash != null && (n.cash == null || n.cash > filters.maxCash)) return false;
    if (filters.maxPoints != null && (n.points == null || n.points > filters.maxPoints)) return false;
    if (filters.weekdaysOnly || filters.weekendsOnly) {
      const dow = dayOfWeek(n.date);
      const isWeekend = dow === 0 || dow === 6;
      if (filters.weekdaysOnly && isWeekend) return false;
      if (filters.weekendsOnly && !isWeekend) return false;
    }
    return true;
  });
}

function expandEdges(edges, startDate, endDate) {
  const map = new Map();
  for (const e of edges) {
    const days = dateRangeInclusive(e.startDate, e.endDate);
    for (const d of days) {
      if (d < startDate || d > endDate) continue;
      map.set(d, summarizeNightInternal({
        date: d,
        cash: e.cash,
        cashTotal: e.cashTotal,
        currency: e.currency,
        points: e.points,
        sourceOfRate: e.sourceOfRate,
        rateMode: e.rateMode,
      }));
    }
  }
  const out = [];
  const checkins = dateRangeInclusive(startDate, endDate);
  for (const d of checkins) {
    out.push(map.get(d) ?? {
      date: d,
      status: 'sold_out',
      cash: null, cashTotal: null, currency: null, points: null,
      sourceOfRate: null, rateMode: null,
    });
  }
  return out;
}

async function getCalendarInternal(params) {
  const propertyCode = params.propertyCode.toUpperCase();
  const numberOfRooms = params.numberOfRooms ?? 1;
  const numberInParty = params.numberInParty ?? 1;
  const retries = Math.max(0, params.retries ?? 3);

  const body = {
    operationName: GQL_OP,
    variables: {
      id: [propertyCode],
      search: {
        propertyId: propertyCode,
        options: {
          startDate: params.startDate,
          endDate: params.endDate,
          numberOfRooms,
          numberInParty,
          numberOfDays: 1,
          rateRequestTypes: [{ value: '', type: 'STANDARD' }],
        },
      },
    },
    query: GQL_QUERY,
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { status, bodyText, json } = await callGqlOnce(body);
    if (status === 200 && json?.data) {
      const conn = json.data.search?.calendarSearchByProperty;
      const rawEdges = conn?.edges ?? [];
      const edges = rawEdges.map((e) => {
        const node = e.node ?? {};
        const rm = node.rateModes ?? {};
        const cash = decodeMoney(rm.lowestAverageRate?.amount);
        const cashTotal = decodeMoney(rm.totalRate?.amount);
        return {
          startDate: node.startDate,
          endDate: node.endDate,
          cash,
          cashTotal,
          currency: rm.lowestAverageRate?.amount?.currency ?? rm.totalRate?.amount?.currency ?? null,
          points: rm.pointsPerQuantity?.points ?? null,
          sourceOfRate: rm.sourceOfRate ?? null,
          rateMode: rm.lowestAverageRate?.__typename ?? null,
        };
      });
      return {
        propertyCode,
        startDate: params.startDate,
        endDate: params.endDate,
        total: typeof conn?.total === 'number' ? conn.total : edges.length,
        edges,
        status: 'ok',
      };
    }
    lastErr = { status, bodyText };
    if (status !== 403) break;
    if (attempt < retries) {
      const delay = [2000, 5000, 15000][Math.min(attempt, 2)];
      await sleep(delay);
    }
  }

  return {
    propertyCode,
    startDate: params.startDate,
    endDate: params.endDate,
    total: 0,
    edges: [],
    status: lastErr?.status === 403 ? classify403(lastErr.bodyText) : 'stale_signature',
  };
}

const NightFiltersSchema = z.object({
  maxCash: z.number().positive().optional(),
  maxPoints: z.number().positive().optional(),
  cashOnly: z.boolean().optional(),
  pointsOnly: z.boolean().optional(),
  weekdaysOnly: z.boolean().optional(),
  weekendsOnly: z.boolean().optional(),
}).optional();

export default defineSkill({
  findAvailability: fn({
    summary:
      'Date range → per-night cash calendar for a Marriott property. ★ primary entry. Returns Calendar { propertyCode, mode, startDate, endDate, nights[], available[] (filtered), cashBest, pointsBest, scanned, errors[] }. NightSummary = { date, status: "available"|"sold_out", cash, cashTotal, currency, points, sourceOfRate, rateMode }.',
    input: z.object({
      propertyCode: z.string().min(5).max(8).describe('5-letter MARSHA code, e.g. "TYOLC". Auto-uppercased.'),
      startDate: z.string().regex(DATE_RX).describe('YYYY-MM-DD inclusive.'),
      endDate: z.string().regex(DATE_RX).describe('YYYY-MM-DD inclusive.'),
      numberOfRooms: z.number().int().min(1).max(9).optional(),
      numberInParty: z.number().int().min(1).max(9).optional(),
      mode: z.enum(['cash', 'points']).optional().describe('Default "cash". "points" currently returns same data; needs login.'),
      filters: NightFiltersSchema,
      retries: z.number().int().min(0).max(10).optional(),
    }),
    examples: [
      {
        args: {
          propertyCode: 'TYOLC',
          startDate: '2026-06-01',
          endDate: '2026-08-31',
          filters: { maxCash: 80000, weekdaysOnly: true },
        },
      },
    ],
    handler: async (params) => {
      if (params.endDate < params.startDate) {
        throw new Error(`marriott.findAvailability: endDate (${params.endDate}) must be >= startDate (${params.startDate})`);
      }
      const propertyCode = params.propertyCode.toUpperCase();
      const mode = params.mode === 'points' ? 'points' : 'cash';
      const errors = [];
      const allEdges = [];
      let cursor = params.startDate;
      let calls = 0;
      while (cursor <= params.endDate) {
        const candidate = addDays(cursor, WINDOW_DAYS - 1);
        const windowEnd = candidate > params.endDate ? params.endDate : candidate;
        if (calls > 0) await sleep(INTER_CALL_MS);
        const resp = await getCalendarInternal({
          propertyCode,
          startDate: cursor,
          endDate: windowEnd,
          numberOfRooms: params.numberOfRooms,
          numberInParty: params.numberInParty,
          retries: params.retries,
        });
        calls++;
        if (resp.status !== 'ok') {
          errors.push({ window: `${cursor}..${windowEnd}`, error: resp.status });
        } else {
          allEdges.push(...resp.edges);
        }
        cursor = addDays(windowEnd, 1);
      }

      const nights = expandEdges(allEdges, params.startDate, params.endDate);
      const filtered = filterNightsInternal(nights.filter((n) => n.status === 'available'), params.filters);

      let cashBest = null;
      let pointsBest = null;
      for (const n of filtered) {
        if (n.cash != null && (!cashBest || n.cash < cashBest.cash)) {
          cashBest = { date: n.date, cash: n.cash, currency: n.currency ?? '' };
        }
        if (n.points != null && (!pointsBest || n.points < pointsBest.points)) {
          pointsBest = { date: n.date, points: n.points };
        }
      }

      return {
        propertyCode,
        mode,
        startDate: params.startDate,
        endDate: params.endDate,
        nights,
        available: filtered,
        cashBest,
        pointsBest,
        scanned: calls,
        errors,
      };
    },
  }),

  getCalendar: fn({
    summary:
      'Single raw GraphQL call (≤32 nights). Returns CalendarResponse { propertyCode, startDate, endDate, total, edges[], status: "ok"|"akamai_blocked"|"stale_signature" }.',
    input: z.object({
      propertyCode: z.string().min(5).max(8),
      startDate: z.string().regex(DATE_RX),
      endDate: z.string().regex(DATE_RX),
      numberOfRooms: z.number().int().min(1).max(9).optional(),
      numberInParty: z.number().int().min(1).max(9).optional(),
      mode: z.enum(['cash', 'points']).optional(),
      retries: z.number().int().min(0).max(10).optional(),
    }),
    handler: async (params) => getCalendarInternal(params),
  }),

  summarizeNight: fn({
    summary: 'Normalize one expanded night.',
    input: z.object({
      date: z.string().regex(DATE_RX),
      cash: z.number().nullable(),
      cashTotal: z.number().nullable(),
      currency: z.string().nullable(),
      points: z.number().nullable(),
      sourceOfRate: z.string().nullable(),
      rateMode: z.string().nullable(),
    }),
    handler: async (input) => summarizeNightInternal(input),
  }),

  filterNights: fn({
    summary: 'Post-search filter on a NightSummary[].',
    input: z.object({
      items: z.array(z.any()),
      filters: NightFiltersSchema,
    }),
    handler: async ({ items, filters }) => filterNightsInternal(items, filters),
  }),
});
