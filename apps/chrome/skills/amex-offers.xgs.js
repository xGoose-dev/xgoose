// ==XGooseSkill==
// @name         amex-offers
// @namespace    amex
// @version      0.2.0
// @description  American Express Offers automation — list / add / track via DOM clicks on global.americanexpress.com.
// @match        *://global.americanexpress.com/*
// @match        *://www.americanexpress.com/*
// @detect       /(^|\.)americanexpress\.com$/.test(location.hostname)
// @run-at       document_idle
// @primary      listOffers
// @connect      <self>
// @keyword      amex
// @keyword      american express
// @keyword      amex offers
// @keyword      offer
// @keyword      add to card
// @keyword      MR
// @keyword      membership rewards
// @keyword      SUB
// @keyword      美卡白金
// @keyword      美白
// @keyword      开卡奖励
// ==/XGooseSkill==

/**
 * American Express Offers automation skill.
 *
 * DOM-driven (clicks the page's own buttons), lifted from uscardforum #460181 +
 * greasyfork 433741 (peckjon "Add all AMEX offers") + greasyfork 495405
 * ("Amex Bonus Tracker" v1.0.6).
 *
 * Driving the DOM is the proven path because Amex's add-to-card endpoint uses
 * signed payloads we can't easily reproduce. The UI button click triggers
 * Amex's own bundled handler, which signs + dispatches correctly.
 *
 * Selectors live near the top — refresh when Amex re-themes (every 6-12 mo).
 *
 * Failure modes:
 *   - listOffers() returns [] on /offers → either no offers or Amex re-themed
 *     the DOM. Inspect in DevTools and refresh selector constants below.
 *   - addOffer status:'session_expired' → page redirected to login.
 *   - addAllOffers status:'rate_limited' → 3 consecutive failures; bump throttleMs.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const ADD_BUTTON_TITLES = ['add to list card', 'Add to Card', 'Activate Offer'];
const ADD_BUTTON_QUERY = ADD_BUTTON_TITLES.map((t) => `button[title="${t}"]`).join(', ');

const OFFER_TILE_QUERIES = [
  '[data-test-id*="offer"]',
  '.offer-info-container',
  'axp-offers-tile',
  '[data-cypress-id*="offer-tile"]',
];

const ACTIVITY_TABLE = '[data-module-name="axp-activity-feed-transactions-table-transactions"]';
const ACTIVITY_ROW = '.position-relative';
const ACTIVITY_DESC = '.description';
const ACTIVITY_AMOUNT = '.hidden-md-up.col-sm-4.col-sm-4.pad-responsive-r';

const CARD_SWITCHER_OPTIONS = '[data-module-name*="card-switcher"] [role="option"], [aria-label*="card switcher"] li';

const EXCLUDED_DESCRIPTIONS = new Set([
  'MEMBERSHIP FEE',
  'PAYPAL ACCT PAYMENT RECEIVED - THANK YOU',
  'AUTOPAY PAYMENT - THANK YOU',
  'CR ADJ FOR BALANCE TRA',
  'ONLINE PAYMENT - THANK YOU',
  'MOBILE PAYMENT - THANK YOU',
  'AMEX AIRLINE FEE REIMBURSEMENT',
  'SHOP SAKS WITH PLATINUM CREDIT',
  'DELL CREDIT',
  'AMEX DINING CREDIT',
  'HILTON RESORT CREDIT',
  'AMEX FLIGHT CREDIT',
  'HILTON STATEMENT CREDIT',
  "AMEX DUNKIN' CREDIT",
  'RENEWAL MEMBERSHIP FEE',
  'ADJUST MEMBERSHIP FEE',
  'MEM RWDS AIRLINE TAX OFFSET FEE',
  'RETURN PAYMENT FEE',
  'AMEX SEND: TRANSFER TO CARD',
  'AMEX SEND: ADD MONEY',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stableHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function findOfferTile(button) {
  let cur = button;
  for (let i = 0; i < 10 && cur; i++) {
    if (OFFER_TILE_QUERIES.some((q) => cur.matches?.(q))) return cur;
    cur = cur.parentElement;
  }
  return button.closest('article, section, li, div[role="listitem"], div') ?? button;
}

function textOf(el, sel) {
  if (!el) return '';
  const node = sel ? el.querySelector(sel) : el;
  return node?.innerText?.trim() ?? '';
}

function detectRewardKind(text) {
  const m = text.match(/(\d{1,3}(?:[,\d]*))\s*%/);
  if (m) return { kind: 'percent', amount: Number(m[1].replace(/,/g, '')) };
  const cash = text.match(/\$(\d{1,3}(?:[,\d]*)(?:\.\d+)?)/);
  if (cash) return { kind: 'cash', amount: Number(cash[1].replace(/,/g, '')) };
  const mr = text.match(/(\d{1,3}(?:[,\d]*))\s*(?:MR|Membership Rewards|points)/i);
  if (mr) return { kind: 'mr_points', amount: Number(mr[1].replace(/,/g, '')) };
  return { kind: 'unknown', amount: null };
}

function detectExpiry(text) {
  const m = text.match(/(?:exp(?:ire)?s?\.?\s+(?:on\s+)?)(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (!m) return null;
  const parts = m[1].split('/').map(Number);
  if (parts.length !== 3) return null;
  const [mo, day, yrRaw] = parts;
  const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function readOfferTile(tile) {
  const all = textOf(tile);
  const merchant =
    textOf(tile, 'h2, h3, .merchant-name, [data-test-id*="merchant"], [class*="merchantName"]') ||
    all.split('\n')[0]?.slice(0, 80) ||
    '';
  const reward = textOf(tile, '.offer-text, [data-test-id*="reward"], [class*="rewardText"]') || all;
  const button = tile.querySelector(ADD_BUTTON_QUERY);
  const rewardInfo = detectRewardKind(reward || all);
  const id = stableHash(`${merchant}|${reward.slice(0, 200)}`);
  return {
    offerId: id,
    merchant,
    reward: reward.slice(0, 240),
    rewardKind: rewardInfo.kind,
    rewardAmount: rewardInfo.amount,
    expiresAt: detectExpiry(all),
    status: button ? 'addable' : 'added',
    _domTitle: button?.getAttribute('title') ?? undefined,
    _addButtonPresent: !!button,
  };
}

function detectSessionExpired() {
  const url = location.href;
  if (/\/login|\/signin|\/welcome/.test(url)) return true;
  if (document.querySelector('input[type="password"], input[name*="UserID"], input[name*="user_id"]')) {
    return true;
  }
  return false;
}

function listOffersInternal() {
  if (detectSessionExpired()) return [];
  const tiles = new Set();
  for (const q of OFFER_TILE_QUERIES) {
    document.querySelectorAll(q).forEach((el) => tiles.add(el));
  }
  if (!tiles.size) {
    document.querySelectorAll(ADD_BUTTON_QUERY).forEach((btn) => tiles.add(findOfferTile(btn)));
  }
  return Array.from(tiles).map(readOfferTile);
}

function listCardsInternal() {
  const opts = Array.from(document.querySelectorAll(CARD_SWITCHER_OPTIONS));
  if (!opts.length) {
    const display = document.querySelector('h1, [data-module-name*="card-name"]')?.innerText?.trim() ?? '';
    return display ? [{ cardKey: stableHash(display), display, isCurrent: true }] : [];
  }
  return opts.map((el) => {
    const display = el.innerText?.trim() ?? '';
    const isCurrent =
      el.getAttribute('aria-selected') === 'true' ||
      el.classList.contains('selected') ||
      el.classList.contains('active');
    return { cardKey: stableHash(display), display, isCurrent };
  });
}

async function clickButtonForOffer(offerId) {
  if (detectSessionExpired()) return { status: 'session_expired', offerId };
  const tiles = listOffersInternal();
  const target = tiles.find((t) => t.offerId === offerId);
  if (!target) return { status: 'no_button', offerId };
  if (target.status !== 'addable') return { status: 'duplicate', offerId };
  const allTiles = new Set();
  for (const q of OFFER_TILE_QUERIES) document.querySelectorAll(q).forEach((el) => allTiles.add(el));
  if (!allTiles.size) document.querySelectorAll(ADD_BUTTON_QUERY).forEach((btn) => allTiles.add(findOfferTile(btn)));
  for (const el of allTiles) {
    if (readOfferTile(el).offerId !== offerId) continue;
    const button = el.querySelector(ADD_BUTTON_QUERY);
    if (!button) return { status: 'no_button', offerId };
    button.click();
    return { status: 'added', offerId };
  }
  return { status: 'no_button', offerId };
}

function getSpendForBonusInternal() {
  const root = document.querySelector(ACTIVITY_TABLE);
  if (!root) {
    return {
      totalEligibleAmount: 0,
      totalAmount: 0,
      includedCount: 0,
      excludedCount: 0,
      excludedAmounts: {},
      transactions: [],
    };
  }
  const rows = root.querySelectorAll(ACTIVITY_ROW);
  let totalEligibleAmount = 0;
  let totalAmount = 0;
  let includedCount = 0;
  let excludedCount = 0;
  const excludedAmounts = {};
  const transactions = [];

  for (const row of Array.from(rows)) {
    const description = row.querySelector(ACTIVITY_DESC)?.innerText?.trim() ?? '';
    const amountText = row.querySelector(ACTIVITY_AMOUNT)?.innerText?.trim() ?? '';
    if (!description || !amountText) continue;
    const amount = parseFloat(amountText.replace(/[$,]/g, ''));
    if (!Number.isFinite(amount)) continue;
    totalAmount += amount;
    const excluded = EXCLUDED_DESCRIPTIONS.has(description);
    if (excluded) {
      excludedCount++;
      excludedAmounts[description] = (excludedAmounts[description] ?? 0) + amount;
    } else {
      includedCount++;
      totalEligibleAmount += amount;
    }
    transactions.push({ description, amount, included: !excluded });
  }
  return { totalEligibleAmount, totalAmount, includedCount, excludedCount, excludedAmounts, transactions };
}

export default defineSkill({
  listOffers: fn({
    summary:
      'Scrape currently-visible offers on /offers. ★ primary entry. Returns OfferRow[] with merchant, reward, rewardKind ("percent"|"cash"|"mr_points"|"unknown"), rewardAmount, expiresAt (YYYY-MM-DD), status ("addable"|"added"|"expired"|"unknown").',
    input: z.object({}),
    examples: [{ args: {} }],
    handler: async () => listOffersInternal(),
  }),

  addOffer: fn({
    summary: "Click one offer's add-to-card button. Returns { status: 'added'|'duplicate'|'no_button'|'session_expired', offerId }.",
    input: z.object({
      offerId: z.string().describe('Stable hash from listOffers().'),
    }),
    examples: [{ args: { offerId: 'a1b2c3d4' } }],
    handler: async ({ offerId }) => clickButtonForOffer(offerId),
  }),

  addAllOffers: fn({
    summary:
      'Sequentially click every add-to-card button. Returns { added, skipped, rateLimited, status: "ok"|"rate_limited"|"session_expired"|"no_offers_found" }.',
    input: z.object({
      cardKey: z.string().optional().describe('Currently informational; defaults to whatever card the UI has selected.'),
      throttleMs: z.number().int().min(500).max(10000).optional().describe('Default 1500. Amex hates parallel; do not push under 500.'),
    }),
    examples: [{ args: { throttleMs: 1500 } }],
    handler: async (params = {}) => {
      const throttleMs = Math.max(500, params.throttleMs ?? 1500);
      const offers = listOffersInternal();
      const addable = offers.filter((o) => o.status === 'addable');
      if (!addable.length) return { added: 0, skipped: 0, rateLimited: 0, status: 'no_offers_found' };

      let added = 0;
      let skipped = 0;
      let consecutiveFailures = 0;
      let rateLimited = 0;

      for (const o of addable) {
        const r = await clickButtonForOffer(o.offerId);
        if (r.status === 'session_expired') {
          return { added, skipped, rateLimited, status: 'session_expired' };
        }
        if (r.status === 'added') {
          added++;
          consecutiveFailures = 0;
        } else if (r.status === 'duplicate' || r.status === 'no_button') {
          skipped++;
        } else {
          rateLimited++;
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            return { added, skipped, rateLimited, status: 'rate_limited' };
          }
        }
        await sleep(throttleMs);
      }
      return { added, skipped, rateLimited, status: 'ok' };
    },
  }),

  listCards: fn({
    summary: 'Enumerate cards visible in the card switcher. Returns CardRow[] = { cardKey, display, isCurrent }.',
    input: z.object({}),
    handler: async () => listCardsInternal(),
  }),

  listAddedOffers: fn({
    summary: 'Same shape as listOffers but reads /offers/enrolled — switch the URL first.',
    input: z.object({}),
    handler: async () => listOffersInternal().map((o) => ({ ...o, status: o._addButtonPresent ? 'addable' : 'added' })),
  }),

  getSpendForBonus: fn({
    summary:
      'SUB tracking from /activity. Drops Amex Bonus Tracker exclusion list (fees / autopayments / credits). Returns { totalEligibleAmount, totalAmount, includedCount, excludedCount, excludedAmounts, transactions[] }.',
    input: z.object({}),
    handler: async () => getSpendForBonusInternal(),
  }),

  _unsafeMultiCardSpread: fn({
    summary:
      'Repeats one offer across multiple cards. ⚠ Bypasses Amex T&C; can flag the account. Throws unless ack === "i-understand-this-may-trigger-amex-flag".',
    input: z.object({
      offerId: z.string(),
      cardKeys: z.array(z.string()).min(1),
      ack: z.literal('i-understand-this-may-trigger-amex-flag'),
    }),
    handler: async (params) => {
      if (!params.offerId || !params.cardKeys?.length) {
        throw new Error('amex._unsafeMultiCardSpread: offerId and cardKeys are required');
      }
      const results = [];
      const cards = listCardsInternal();
      for (const cardKey of params.cardKeys) {
        const card = cards.find((c) => c.cardKey === cardKey);
        if (!card) {
          results.push({ cardKey, status: 'card_not_found' });
          continue;
        }
        if (!card.isCurrent) {
          const opt = Array.from(document.querySelectorAll(CARD_SWITCHER_OPTIONS)).find(
            (el) => stableHash(el.innerText?.trim() ?? '') === cardKey,
          );
          opt?.click();
          await sleep(2500);
        }
        const r = await clickButtonForOffer(params.offerId);
        results.push({ cardKey, status: r.status });
        await sleep(3000);
      }
      return { results };
    },
  }),
});
