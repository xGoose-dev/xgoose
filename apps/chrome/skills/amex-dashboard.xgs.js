// ==XGooseSkill==
// @name         amex-dashboard
// @namespace    amexd
// @version      0.1.0
// @description  American Express dashboard automation. List/sort/search/claim Amex Offers across every card on the account, query enrolled offers by category, read benefit trackers and balances. API-driven (no DOM clicks).
// @match        *://global.americanexpress.com/*
// @detect       location.hostname === 'global.americanexpress.com'
// @run-at       document_idle
// @primary      getDashboard
// @connect      <self>
// @connect      functions.americanexpress.com
// @keyword      amex
// @keyword      amex offers
// @keyword      american express
// @keyword      offer
// @keyword      add to card
// @keyword      claim offers
// @keyword      offers hub
// @keyword      enrolled offers
// @keyword      dashboard
// @keyword      MR
// @keyword      membership rewards
// @keyword      Platinum
// @keyword      Gold
// @keyword      Hilton Honors
// @keyword      美卡白金
// @keyword      美白
// @keyword      offers全选
// @keyword      offer分类
// ==/XGooseSkill==

/**
 * Amex dashboard skill — full coverage of the AMaxOffer surface.
 *
 * Reverse-engineered from AMaxOffer v4.6.8 (deobfuscated with `synchrony` from
 * github.com/AleXbMaximum/AMaxOffer raw/dist build) plus the dapper-gh
 * bookmarklet (gist 0ded3a425b08b2a126a2bf85d1df595a). The deobfuscated source
 * shows AMaxOffer talks to the same Amex endpoints, so this skill targets them
 * directly with `credentials: 'include'` (same-origin from global.americanexpress.com).
 *
 * Endpoints (all real, captured from production):
 *   GET  https://global.americanexpress.com/api/servicing/v1/member
 *        → { accounts: [{ account_token, product, account, status, profile, supplementary_accounts }] }
 *
 *   POST https://functions.americanexpress.com/ReadOffersHubPresentation.web.v1
 *        body { accountNumberProxy, locale, offerPage, requestType }
 *        requestType: "OFFERSHUB_LANDING"  → recommendedOffers.offersList.pageN[]   (eligible)
 *                     "ADDEDTOCARD_LANDING"→ addedToCardViewAll.offersList.page1[]   (enrolled)
 *                     "SAVINGS_LANDING"    → offersSavingsViewAll.savingsOffers.offersList.pageN[] (redeemed)
 *        REQUIRED header: Origin: https://global.americanexpress.com
 *
 *   POST https://functions.americanexpress.com/CreateOffersHubEnrollment.web.v1
 *        body { accountNumberProxy, enrollmentTrigger:"OFFERSHUB_TILE", locale, offerId,
 *               offerUnencrypted:false, requestType:"OFFERSHUB_ENROLLMENT", synchronizeOnly:false }
 *        success when status.purpose === "SUCCESS"
 *
 *   POST https://functions.americanexpress.com/CreateCardAccountOfferEnrollment.v1  (legacy / boost)
 *        body { accountNumberProxy, identifier:offerId, locale, requestDateTimeWithOffset, userOffset }
 *        success when isEnrolled === true. Bypasses some restrictions but raises ban risk.
 *
 *   POST https://functions.americanexpress.com/ReadBestLoyaltyBenefitsTrackers.v1
 *        body [{ accountToken, locale, limit:"ALL" }]
 *
 *   GET  https://global.americanexpress.com/api/servicing/v1/financials/balances?extended_details=...
 *        header { account_tokens: <token> }
 *   GET  https://global.americanexpress.com/api/servicing/v1/financials/transaction_summary?status=pending
 *        header { account_tokens: <token> }
 *
 * Offer object (normalized): {
 *   source_id,        // pznAnalyticsId || offerId — stable across cards
 *   offerId,          // used for enrollment
 *   name,             // merchant title
 *   category,         // "Travel" / "Hotel" / "Dining" / "Shopping" / "Entertainment" / "Business" / ...
 *   achievement_type, // "MERCHANT" usually; "MR" / "HH" / "Cash" set by parseShortDescription
 *   expiry_date,      // "YYYY-MM-DD"
 *   short_description,
 *   long_description,
 *   terms,
 *   logo,
 *   redemption_types, // "Online", "In Store", etc.
 *   threshold,        // "$50.00" — spend trigger
 *   reward,           // "$10.00" — cashback equivalent
 *   percentage,       // "20%" — back rate
 *   pointType,        // "MR" | "HH" | null
 *   eligibleCards,    // [account_token, ...]
 *   enrolledCards     // [account_token, ...]
 * }
 *
 * Throttling: AMaxOffer ships these defaults. Don't go lower; Amex 429s aggressively.
 *   - offers batchSize 5, batchDelayMs 300
 *   - benefits batchSize 5, batchDelayMs 300
 *   - enrollment throttleMs 1500 (sequential)
 *
 * Failure modes:
 *   - Session expired → /member returns 401/redirect → status: 'session_expired'.
 *     Tell user to refresh global.americanexpress.com.
 *   - Rate limited → repeated 429s. Back off; AMaxOffer config bumps batchDelayMs to 1000-3000ms.
 *   - Enrollment status.purpose !== "SUCCESS" → check status.message; common reasons:
 *     "already enrolled", "offer expired", "card not eligible", "max enrollments reached".
 *   - Boost mode (legacy endpoint) is the only way to add an offer to multiple cards when
 *     Amex restricts it. Has flagged accounts historically. Set mode:'boost' + ack only when
 *     the caller really wants it.
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const URLS = Object.freeze({
  member: 'https://global.americanexpress.com/api/servicing/v1/member',
  balance:
    'https://global.americanexpress.com/api/servicing/v1/financials/balances?extended_details=deferred,non_deferred,pay_in_full,pay_over_time,early_pay',
  pendingBalance:
    'https://global.americanexpress.com/api/servicing/v1/financials/transaction_summary?status=pending',
  offersHub: 'https://functions.americanexpress.com/ReadOffersHubPresentation.web.v1',
  enrollV2: 'https://functions.americanexpress.com/CreateOffersHubEnrollment.web.v1',
  enrollLegacy: 'https://functions.americanexpress.com/CreateCardAccountOfferEnrollment.v1',
  benefits: 'https://functions.americanexpress.com/ReadBestLoyaltyBenefitsTrackers.v1',
});

const HUB_HEADERS = Object.freeze({
  Origin: 'https://global.americanexpress.com',
});

const DEFAULTS = Object.freeze({
  offerPageLimit: 20,
  fetchBatchSize: 5,
  fetchBatchDelayMs: 300,
  enrollThrottleMs: 1500,
  enrollMaxConsecutiveFailures: 5,
});

const CATEGORY_ALIASES = Object.freeze({
  travel: ['travel', 'airport benefits'],
  hotel: ['hotel', 'lodging'],
  dining: ['dining', 'food', 'restaurant'],
  shopping: ['shopping', 'retail'],
  entertainment: ['entertainment'],
  business: ['business'],
  digital: ['digital', 'streaming', 'subscription'],
});

const SAFE_SORT_KEYS = new Set([
  'name',
  'merchant',
  'category',
  'achievement_type',
  'expiry_date',
  'threshold',
  'reward',
  'percentage',
  'pointType',
  'eligibleCount',
  'enrolledCount',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getUserOffset() {
  const tz = new Date().getTimezoneOffset();
  const sign = tz >= 0 ? '-' : '+';
  return sign + pad2(Math.floor(Math.abs(tz) / 60)) + ':' + pad2(Math.abs(tz) % 60);
}

function getDateTimeWithOffset() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    'T' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes()) +
    ':' +
    pad2(d.getSeconds()) +
    getUserOffset()
  );
}

function parseExpiry(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const [, mo, day, yrRaw] = m;
  const yr = yrRaw.length === 2 ? '20' + yrRaw : yrRaw;
  return yr + '-' + mo.padStart(2, '0') + '-' + day.padStart(2, '0');
}

function fmtCash(n) {
  if (n == null || isNaN(n)) return null;
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseMoney(s) {
  return parseFloat(String(s).replace(/[,$]/g, ''));
}

function parseInt2(s) {
  return parseInt(String(s).replace(/,/g, ''), 10);
}

/**
 * Port of AMaxOffer module 9726 (the reward parser). Extracts:
 *   - threshold:   spend trigger ("$50.00")
 *   - reward:      cashback equivalent of the offer ("$10.00")
 *   - percentage:  back rate as percent string ("20%")
 *   - times:       max redemptions ("up to 5 times")
 *   - total:       total cap if listed as "(total of $X)"
 *   - pointType:   "MR" | "HH" | null
 */
function parseShortDescription(text = '') {
  let threshold = null;
  let reward = null;
  let percentage = null;
  let pointType = null;

  const mSpend = text.match(/Spend\s*\$(\d[\d,.]*)/i);
  if (mSpend) threshold = parseMoney(mSpend[1]);

  const mPct = text.match(/(?:Earn|Get)\s+(\d+(?:\.\d+)?)%\s*back/i);
  if (mPct) percentage = parseFloat(mPct[1]);

  // Hilton Honors
  const mHHPer = text.match(
    /Earn\s*\+?(\d+)\s*Hilton Honors Bonus Points?\s*per\s*(?:eligible\s*)?dollar spent/i,
  );
  if (mHHPer) {
    pointType = 'HH';
    if (percentage == null) percentage = parseFloat(mHHPer[1]) * 0.004 * 100;
    const mHHCap = text.match(/up to\s*([\d,]+)\s*Points/i);
    if (mHHCap) reward = parseInt2(mHHCap[1]) * 0.004;
  } else {
    const mHHFlat = text.match(/Earn\s+([\d,]+)\s*Hilton Honors Bonus Points(?!\s*per)/i);
    if (mHHFlat) {
      pointType = 'HH';
      reward = parseInt2(mHHFlat[1]) * 0.004;
    }
  }

  // Membership Rewards (only if HH didn't already set pointType)
  if (!pointType) {
    const mMRPer = text.match(
      /Earn\s*\+?(\d+)\s*Membership Rewards(?:®)?\s*points?\s*per\s*(?:eligible\s*)?dollar spent/i,
    );
    if (mMRPer) {
      pointType = 'MR';
      if (percentage == null) percentage = parseFloat(mMRPer[1]) * 0.01 * 100;
      const mMRCap = text.match(/up to\s*(\d[\d,.]*)\s*(?:points|pts)/i);
      if (mMRCap) reward = parseMoney(mMRCap[1]) * 0.01;
    } else {
      const mMRFlat = text.match(/Earn\s+([\d,]+)\s*Membership Rewards(?:®)?\s*points(?!\s*per)/i);
      if (mMRFlat) {
        pointType = 'MR';
        reward = parseInt2(mMRFlat[1]) * 0.01;
      }
    }
  }

  if (reward == null) {
    const mEarn = text.match(/(?:earn|get)\s*\$(\d[\d,.]*)/i);
    if (mEarn) reward = parseMoney(mEarn[1]);
    else {
      const mCap = text.match(/up to (?:a total of )?\$(\d[\d,.]*)/i);
      if (mCap) reward = parseMoney(mCap[1]);
    }
  }

  const mTimes = text.match(/up to\s+(\d+)\s+times?/i);
  const times = mTimes ? mTimes[1] : null;
  const mTotal = text.match(/\(total of\s*\$(\d[\d,.]*)\)/i);
  const total = mTotal ? fmtCash(parseMoney(mTotal[1])) : null;

  // Cross-derive missing values
  const hasThreshold = threshold != null && !isNaN(threshold);
  const hasReward = reward != null && !isNaN(reward);
  const hasPercentage = percentage != null && !isNaN(percentage);
  if (hasThreshold && hasReward && !hasPercentage && threshold > 0)
    percentage = (reward / threshold) * 100;
  else if (hasThreshold && hasPercentage && !hasReward) reward = threshold * (percentage / 100);
  else if (hasReward && hasPercentage && !hasThreshold && percentage !== 0)
    threshold = reward / (percentage / 100);

  return {
    threshold: threshold != null ? fmtCash(threshold) : null,
    reward: reward != null ? fmtCash(reward) : null,
    percentage: percentage != null ? Math.round(percentage * 10) / 10 + '%' : null,
    times,
    total,
    pointType,
  };
}

function normalizeOffer(raw) {
  const pznId = raw?.pznAnalyticsId ? String(raw.pznAnalyticsId) : undefined;
  const offerId = raw?.offerId ? String(raw.offerId) : undefined;
  const source_id = pznId || offerId || raw?.title || 'N/A';
  const category =
    raw?.applicableCategories?.[0]?.text ||
    raw?.applicableCategories?.[0]?.optionType ||
    'N/A';
  const redemption_types = Array.isArray(raw?.applicableFilters)
    ? raw.applicableFilters.map((r) => r.text || r.optionType).filter(Boolean).join(', ') || 'N/A'
    : 'N/A';
  const parsed = parseShortDescription(raw?.shortDescription || '');
  return {
    source_id,
    offerId: offerId || 'N/A',
    pznAnalyticsId: pznId,
    name: raw?.title || 'N/A',
    achievement_type: parsed.pointType || raw?.offerType || 'N/A',
    category,
    expiry_date: parseExpiry(raw?.expiration?.text),
    logo: raw?.image || 'N/A',
    redemption_types,
    short_description: raw?.shortDescription || 'N/A',
    long_description: raw?.longDescription || null,
    terms: raw?.terms?.details || raw?.terms || null,
    enrollmentMeta: raw?.enrollmentDetails?.enrollmentMeta || null,
    threshold: parsed.threshold,
    reward: parsed.reward,
    percentage: parsed.percentage,
    pointType: parsed.pointType,
    times: parsed.times,
    total: parsed.total,
  };
}

function normalizeRedeemed(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const ts = m?.redemptionDate?.unixTimestamp;
      const pznId = m?.pznAnalyticsId ? String(m.pznAnalyticsId) : undefined;
      const offerId = m?.offerId ? String(m.offerId) : undefined;
      return {
        enrolled_id: pznId || offerId || m.name || 'N/A',
        redemption_date: typeof ts === 'number' ? ts : undefined,
        redemption_date_iso: typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null,
        amount: m.amount,
        merchantName: m.name,
        name: m.name,
        status: m.status,
        offerId,
        pznAnalyticsId: pznId,
      };
    });
}

function flattenCard(raw, isSupplementary = false, mainIndex = 1, suppIndex = null) {
  const cardIndex = isSupplementary ? mainIndex + '-' + suppIndex : String(mainIndex);
  const description = raw?.product?.description || 'N/A';
  return {
    account_token: raw?.account_token || 'N/A',
    cardEnding: raw?.account?.display_account_number || 'N/A',
    relationship: raw?.account?.relationship || 'N/A',
    supplementary_index: raw?.account?.supplementary_index || 'N/A',
    account_status: Array.isArray(raw?.status?.account_status)
      ? raw.status.account_status[0]
      : raw?.status?.account_status || 'N/A',
    days_past_due: raw?.status?.days_past_due ?? 'N/A',
    account_setup_date: raw?.status?.account_setup_date || 'N/A',
    description,
    cardCategory: /\bBusiness\b/i.test(description) ? 'business' : 'personal',
    small_card_art: raw?.product?.small_card_art || 'N/A',
    embossed_name: raw?.profile?.embossed_name || 'N/A',
    cardIndex,
    isSupplementary,
  };
}

function isAccountActive(card) {
  const s = String(card?.account_status || '').toLowerCase();
  return s && !s.includes('canceled') && !s.includes('cancelled') && !s.includes('closed');
}

async function http(method, url, opts = {}) {
  const init = {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  if (res.status === 401 || res.status === 403) {
    const err = new Error('HTTP ' + res.status + ': ' + res.statusText);
    err.status = res.status;
    err.sessionExpired = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('HTTP ' + res.status + ': ' + (text.slice(0, 200) || res.statusText));
    err.status = res.status;
    throw err;
  }
  return res;
}

async function postJson(url, body, headers = {}) {
  const r = await http('POST', url, { body, headers });
  return r.json();
}

async function getJson(url, headers = {}) {
  const r = await http('GET', url, { headers });
  return r.json();
}

async function postHub(body) {
  return postJson(URLS.offersHub, body, HUB_HEADERS);
}

async function fetchMemberRaw() {
  return getJson(URLS.member);
}

async function fetchCards() {
  const data = await fetchMemberRaw();
  if (!data || !Array.isArray(data.accounts)) {
    throw new Error('Invalid /member response: missing accounts array');
  }
  const out = [];
  let i = 1;
  for (const acc of data.accounts) {
    out.push(flattenCard(acc, false, i, null));
    if (Array.isArray(acc.supplementary_accounts)) {
      for (const supp of acc.supplementary_accounts) {
        const sIdx = supp.account?.supplementary_index
          ? parseInt(supp.account.supplementary_index, 10)
          : 'N/A';
        out.push(flattenCard(supp, true, i, sIdx));
      }
    }
    i++;
  }
  return out;
}

async function fetchEligibleOffersForCard(accountToken, maxPages = DEFAULTS.offerPageLimit) {
  const offers = [];
  for (let p = 1; p <= maxPages; p++) {
    const pageKey = 'page' + p;
    let res;
    try {
      res = await postHub({
        accountNumberProxy: accountToken,
        locale: 'en-US',
        offerPage: pageKey,
        requestType: 'OFFERSHUB_LANDING',
      });
    } catch (err) {
      if (err.sessionExpired) throw err;
      break;
    }
    const list = res?.recommendedOffers?.offersList?.[pageKey];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const o of list) {
      if (o?.offerType === 'MERCHANT') offers.push(o);
    }
  }
  return offers;
}

async function fetchEnrolledOffersForCard(accountToken) {
  const res = await postHub({
    accountNumberProxy: accountToken,
    locale: 'en-US',
    requestType: 'ADDEDTOCARD_LANDING',
  });
  const list = res?.addedToCardViewAll?.offersList?.page1;
  return Array.isArray(list) ? list : [];
}

async function fetchRedeemedOffersForCard(accountToken, maxPages = DEFAULTS.offerPageLimit) {
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const pageKey = 'page' + p;
    const res = await postHub({
      accountNumberProxy: accountToken,
      locale: 'en-US',
      offerPage: pageKey,
      requestType: 'SAVINGS_LANDING',
    });
    const list = res?.offersSavingsViewAll?.savingsOffers?.offersList?.[pageKey];
    if (!Array.isArray(list) || list.length === 0) break;
    out.push(...list);
  }
  return out;
}

async function fetchBenefitsForCard(accountToken) {
  const body = [{ accountToken, locale: 'en-US', limit: 'ALL' }];
  const data = await postJson(URLS.benefits, body, { Accept: '*/*' });
  const trackers = [];
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!Array.isArray(entry?.trackers)) continue;
      for (const t of entry.trackers) {
        trackers.push({
          benefitId: t.benefitId,
          sorBenefitId: t.sorBenefitId,
          isPromotion: t.isPromotion,
          category: t.category,
          periodStartDate: t.periodStartDate,
          periodEndDate: t.periodEndDate,
          trackerDuration: t.trackerDuration,
          benefitName: t.benefitName,
          status: t.status,
          terms: t.terms,
          tracker: t.tracker
            ? {
                targetAmount: parseFloat(t.tracker.targetAmount) || 0,
                spentAmount: parseFloat(t.tracker.spentAmount) || 0,
                remainingAmount: parseFloat(t.tracker.remainingAmount) || 0,
                targetUnit: t.tracker.targetUnit,
                targetCurrency: t.tracker.targetCurrency,
                targetCurrencySymbol: t.tracker.targetCurrencySymbol,
              }
            : null,
          progress: t.progress
            ? {
                title: t.progress.title,
                message: t.progress.message,
                usedLabel: t.progress.usedLabel,
                togoLabel: t.progress.togoLabel,
                totalRedeemedYearToDate: t.progress.totalRedeemedYearToDate,
              }
            : null,
        });
      }
    }
  }
  return trackers;
}

async function inBatches(items, batchSize, delayMs, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const batchOut = await Promise.all(slice.map(fn));
    out.push(...batchOut);
    if (i + batchSize < items.length && delayMs > 0) await sleep(delayMs);
  }
  return out;
}

function dedupeOffers(perCardEntries) {
  const map = new Map();
  for (const entry of perCardEntries) {
    const { accountToken, eligible, enrolled } = entry;
    const upsert = (rawList, bucket) => {
      for (const raw of rawList) {
        const norm = normalizeOffer(raw);
        if (!norm.source_id || norm.source_id === 'N/A') continue;
        if (!map.has(norm.source_id)) {
          map.set(norm.source_id, {
            ...norm,
            eligibleCards: [],
            enrolledCards: [],
          });
        }
        const slot = map.get(norm.source_id);
        const list = bucket === 'eligible' ? slot.eligibleCards : slot.enrolledCards;
        if (!list.includes(accountToken)) list.push(accountToken);
      }
    };
    upsert(eligible || [], 'eligible');
    upsert(enrolled || [], 'enrolled');
  }
  return Array.from(map.values());
}

function compareOffers(a, b, key) {
  const num = (v) => (v == null ? -Infinity : parseFloat(String(v).replace(/[$,%\s]/g, '')));
  switch (key) {
    case 'reward':
    case 'threshold':
    case 'percentage':
      return num(a[key]) - num(b[key]);
    case 'expiry_date': {
      const av = a.expiry_date || '9999-12-31';
      const bv = b.expiry_date || '9999-12-31';
      return av.localeCompare(bv);
    }
    case 'eligibleCount':
      return (a.eligibleCards?.length || 0) - (b.eligibleCards?.length || 0);
    case 'enrolledCount':
      return (a.enrolledCards?.length || 0) - (b.enrolledCards?.length || 0);
    case 'merchant':
    case 'name':
      return String(a.name || '').localeCompare(String(b.name || ''));
    case 'category':
      return String(a.category || '').localeCompare(String(b.category || ''));
    case 'achievement_type':
      return String(a.achievement_type || '').localeCompare(String(b.achievement_type || ''));
    case 'pointType':
      return String(a.pointType || '').localeCompare(String(b.pointType || ''));
    default:
      return 0;
  }
}

function sortOffers(offers, key, dir = 'desc') {
  if (!key || !SAFE_SORT_KEYS.has(key)) return offers;
  const sign = dir === 'asc' ? 1 : -1;
  return offers.slice().sort((a, b) => sign * compareOffers(a, b, key));
}

function categoryMatches(offerCategory, want) {
  if (!want) return true;
  const oc = String(offerCategory || '').toLowerCase();
  const target = String(want).toLowerCase();
  if (oc === target || oc.includes(target)) return true;
  const aliases = CATEGORY_ALIASES[target] || [target];
  return aliases.some((a) => oc.includes(a));
}

function fuzzyMatch(offer, query) {
  if (!query) return true;
  const q = String(query).toLowerCase();
  const hay =
    (offer.name || '') +
    '\n' +
    (offer.short_description || '') +
    '\n' +
    (offer.category || '') +
    '\n' +
    (offer.redemption_types || '');
  return hay.toLowerCase().includes(q);
}

async function isOfferEnrolled(accountToken, offerId) {
  try {
    const raw = await fetchEnrolledOffersForCard(accountToken);
    return raw.some((o) => o?.offerId === offerId);
  } catch {
    return false;
  }
}

async function enrollOfferOnce(accountToken, offerId, mode = 'safe') {
  try {
    const boost = String(mode).toLowerCase() === 'boost';
    const url = boost ? URLS.enrollLegacy : URLS.enrollV2;
    const body = boost
      ? {
          accountNumberProxy: accountToken,
          identifier: offerId,
          locale: 'en-US',
          requestDateTimeWithOffset: getDateTimeWithOffset(),
          userOffset: getUserOffset(),
        }
      : {
          accountNumberProxy: accountToken,
          enrollmentTrigger: 'OFFERSHUB_TILE',
          locale: 'en-US',
          offerId,
          offerUnencrypted: false,
          requestType: 'OFFERSHUB_ENROLLMENT',
          synchronizeOnly: false,
        };
    const res = await postJson(url, body, HUB_HEADERS);
    const success = boost
      ? Boolean(res?.isEnrolled)
      : String(res?.status?.purpose || '').toUpperCase() === 'SUCCESS';
    const rawMessage =
      (boost ? res?.explanationMessage || res?.message : res?.status?.message) ||
      (success ? 'Enrolled' : 'Enroll failed');

    // Amex returns generic `purpose: "FAILURE"` for duplicate enrollments instead of
    // "already enrolled". Two signals tell us it's actually a duplicate:
    //   (1) res.recommendedOffers.userNotification.title contains "already been added" (fast path)
    //   (2) the offer is in ADDEDTOCARD_LANDING for this card (slower fallback, extra round-trip)
    if (!success && /failure|issue/i.test(rawMessage)) {
      const hint = String(res?.recommendedOffers?.userNotification?.title || '');
      const fastDuplicate = /already been added|already enrolled/i.test(hint);
      const verifiedDuplicate = fastDuplicate || (await isOfferEnrolled(accountToken, offerId));
      if (verifiedDuplicate) {
        return {
          offerId,
          accountToken,
          result: false,
          mode: boost ? 'boost' : 'safe',
          duplicate: true,
          explanationMessage:
            hint || 'Already enrolled (verified via ADDEDTOCARD_LANDING)',
          raw: res,
        };
      }
    }

    return {
      offerId,
      accountToken,
      result: success,
      mode: boost ? 'boost' : 'safe',
      duplicate: false,
      explanationMessage: rawMessage,
      raw: res,
    };
  } catch (err) {
    return {
      offerId,
      accountToken,
      result: false,
      mode,
      duplicate: false,
      explanationMessage: err.message,
      sessionExpired: !!err.sessionExpired,
      error: err.message,
    };
  }
}

async function refreshOffersAcrossCards({ cards, throttleMs, batchSize, skipPatterns }) {
  const activeCards = cards.filter(isAccountActive);
  const skipFns = (skipPatterns || []).map((p) => String(p).toLowerCase());
  const perCard = await inBatches(
    activeCards,
    batchSize,
    throttleMs,
    async (card) => {
      const [eligible, enrolled] = await Promise.all([
        fetchEligibleOffersForCard(card.account_token).catch((e) => {
          if (e.sessionExpired) throw e;
          return [];
        }),
        fetchEnrolledOffersForCard(card.account_token).catch((e) => {
          if (e.sessionExpired) throw e;
          return [];
        }),
      ]);
      return { accountToken: card.account_token, eligible, enrolled };
    },
  );
  let offers = dedupeOffers(perCard);
  if (skipFns.length) {
    offers = offers.filter(
      (o) => !skipFns.some((s) => String(o.name || '').toLowerCase().includes(s)),
    );
  }
  return { offers, perCard, activeCards };
}

function summarize(cards, offers) {
  const today = new Date();
  const cutoff = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const expiringSoon = offers
    .filter((o) => o.expiry_date && o.expiry_date <= cutoff)
    .slice()
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const byCategory = {};
  for (const o of offers) {
    const key = o.category || 'Other';
    if (!byCategory[key]) byCategory[key] = { count: 0, eligibleCount: 0, enrolledCount: 0 };
    byCategory[key].count++;
    if ((o.eligibleCards || []).length) byCategory[key].eligibleCount++;
    if ((o.enrolledCards || []).length) byCategory[key].enrolledCount++;
  }
  const topRewards = sortOffers(
    offers.filter((o) => o.reward),
    'reward',
    'desc',
  ).slice(0, 10);
  const eligibleTotal = offers.reduce((n, o) => n + (o.eligibleCards?.length || 0), 0);
  const enrolledTotal = offers.reduce((n, o) => n + (o.enrolledCards?.length || 0), 0);
  return {
    cardCount: cards.length,
    activeCardCount: cards.filter(isAccountActive).length,
    distinctOffers: offers.length,
    eligibleSlotsAcrossCards: eligibleTotal,
    enrolledSlotsAcrossCards: enrolledTotal,
    byCategory,
    expiringSoon: expiringSoon.slice(0, 25),
    topRewards,
  };
}

export default defineSkill({
  getDashboard: fn({
    summary:
      'Complete dashboard snapshot. ★ primary. Returns { cards[], offers[], stats{byCategory, topRewards, expiringSoon}, redeemedSamples? }. Each offer is deduplicated across cards with eligibleCards[] and enrolledCards[] account_token arrays. Sorted by reward desc by default.',
    input: z.object({
      includeRedeemed: z
        .boolean()
        .optional()
        .describe('If true, also fetches redeemed history (SAVINGS_LANDING) for the first active card. Slow.'),
      includeBenefits: z
        .boolean()
        .optional()
        .describe('If true, fetches benefit trackers (Platinum/Gold credits) for every active card.'),
      sortBy: z
        .enum(['reward', 'threshold', 'percentage', 'expiry_date', 'category', 'name', 'eligibleCount'])
        .optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      skipPatterns: z
        .array(z.string())
        .optional()
        .describe('Substrings to skip in merchant name (case-insensitive). e.g. ["dell"]'),
      throttleMs: z.number().int().min(0).max(10000).optional(),
      batchSize: z.number().int().min(1).max(10).optional(),
    }),
    examples: [
      { args: {} },
      { args: { sortBy: 'reward', sortOrder: 'desc', includeBenefits: true } },
    ],
    handler: async (args = {}) => {
      const cards = await fetchCards();
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: args.throttleMs ?? DEFAULTS.fetchBatchDelayMs,
        batchSize: args.batchSize ?? DEFAULTS.fetchBatchSize,
        skipPatterns: args.skipPatterns,
      });
      const sorted = sortOffers(offers, args.sortBy || 'reward', args.sortOrder || 'desc');
      const stats = summarize(cards, sorted);
      const result = { cards, offers: sorted, stats };
      if (args.includeBenefits) {
        const trackers = await inBatches(
          cards.filter(isAccountActive),
          DEFAULTS.fetchBatchSize,
          DEFAULTS.fetchBatchDelayMs,
          async (c) => ({
            account_token: c.account_token,
            cardEnding: c.cardEnding,
            description: c.description,
            trackers: await fetchBenefitsForCard(c.account_token).catch(() => []),
          }),
        );
        result.benefits = trackers;
      }
      if (args.includeRedeemed) {
        const first = cards.find(isAccountActive);
        if (first) {
          result.redeemedSamples = normalizeRedeemed(
            await fetchRedeemedOffersForCard(first.account_token).catch(() => []),
          );
        }
      }
      return result;
    },
  }),

  listCards: fn({
    summary:
      'Enumerate all cards on the logged-in Amex account from /api/servicing/v1/member. Returns CardRow[] = { account_token, cardEnding, description, relationship ("BASIC"|"SUPP"|...), account_status, isSupplementary, embossed_name, ... }.',
    input: z.object({
      includeInactive: z.boolean().optional().describe('Include canceled/closed cards. Default false.'),
    }),
    examples: [{ args: {} }],
    handler: async ({ includeInactive } = {}) => {
      const cards = await fetchCards();
      return includeInactive ? cards : cards.filter(isAccountActive);
    },
  }),

  listEligibleOffers: fn({
    summary:
      'Paginated eligible-offers feed (OFFERSHUB_LANDING) for one card. Returns normalized offer[] sans dedup (use listAllEligibleOffers for the across-cards merged view).',
    input: z.object({
      accountToken: z.string().describe('From listCards()[].account_token'),
      maxPages: z.number().int().min(1).max(20).optional(),
    }),
    examples: [{ args: { accountToken: '<token>' } }],
    handler: async ({ accountToken, maxPages }) => {
      const raw = await fetchEligibleOffersForCard(accountToken, maxPages ?? DEFAULTS.offerPageLimit);
      return raw.map(normalizeOffer);
    },
  }),

  listEnrolledOffers: fn({
    summary:
      'Already-enrolled offers for one card (ADDEDTOCARD_LANDING). This is the "what offers do I have" answer. Returns normalized offer[].',
    input: z.object({ accountToken: z.string() }),
    examples: [{ args: { accountToken: '<token>' } }],
    handler: async ({ accountToken }) => {
      const raw = await fetchEnrolledOffersForCard(accountToken);
      return raw.map(normalizeOffer);
    },
  }),

  listAllEligibleOffers: fn({
    summary:
      'Eligible offers across every active card, deduplicated by source_id (pznAnalyticsId||offerId). Each row carries eligibleCards[] of account_tokens. Sortable.',
    input: z.object({
      accountTokens: z.array(z.string()).optional().describe('Subset of cards. Default: all active.'),
      sortBy: z
        .enum(['reward', 'threshold', 'percentage', 'expiry_date', 'category', 'name', 'eligibleCount'])
        .optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      throttleMs: z.number().int().min(0).max(10000).optional(),
      batchSize: z.number().int().min(1).max(10).optional(),
    }),
    examples: [{ args: { sortBy: 'reward', sortOrder: 'desc' } }],
    handler: async (args = {}) => {
      let cards = await fetchCards();
      if (args.accountTokens?.length) {
        const want = new Set(args.accountTokens);
        cards = cards.filter((c) => want.has(c.account_token));
      }
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: args.throttleMs ?? DEFAULTS.fetchBatchDelayMs,
        batchSize: args.batchSize ?? DEFAULTS.fetchBatchSize,
      });
      const eligibleOnly = offers.filter((o) => (o.eligibleCards || []).length > 0);
      return sortOffers(eligibleOnly, args.sortBy || 'reward', args.sortOrder || 'desc');
    },
  }),

  listAllEnrolledOffers: fn({
    summary:
      'Enrolled offers across every active card. Supports groupBy:"category" to answer "what offers do I have for each category".',
    input: z.object({
      accountTokens: z.array(z.string()).optional(),
      groupBy: z.enum(['category', 'merchant', 'card', 'none']).optional(),
      throttleMs: z.number().int().min(0).max(10000).optional(),
      batchSize: z.number().int().min(1).max(10).optional(),
    }),
    examples: [{ args: { groupBy: 'category' } }],
    handler: async (args = {}) => {
      let cards = await fetchCards();
      if (args.accountTokens?.length) {
        const want = new Set(args.accountTokens);
        cards = cards.filter((c) => want.has(c.account_token));
      }
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: args.throttleMs ?? DEFAULTS.fetchBatchDelayMs,
        batchSize: args.batchSize ?? DEFAULTS.fetchBatchSize,
      });
      const enrolledOnly = offers.filter((o) => (o.enrolledCards || []).length > 0);
      const groupBy = args.groupBy || 'category';
      if (groupBy === 'none') return enrolledOnly;
      const groups = {};
      for (const o of enrolledOnly) {
        let key;
        if (groupBy === 'category') key = o.category || 'Other';
        else if (groupBy === 'merchant') key = o.name || 'Other';
        else if (groupBy === 'card') {
          for (const tok of o.enrolledCards) {
            const card = cards.find((c) => c.account_token === tok);
            const k = card ? `${card.description} (-${card.cardEnding})` : tok;
            (groups[k] ||= []).push(o);
          }
          continue;
        }
        (groups[key] ||= []).push(o);
      }
      return { groups, count: enrolledOnly.length };
    },
  }),

  listRedeemedOffers: fn({
    summary:
      'Historical redemptions (SAVINGS_LANDING) for one card. Returns RedeemedRow[] = { enrolled_id, merchantName, amount, redemption_date (unix ts), redemption_date_iso, status, offerId }.',
    input: z.object({
      accountToken: z.string(),
      maxPages: z.number().int().min(1).max(20).optional(),
    }),
    examples: [{ args: { accountToken: '<token>' } }],
    handler: async ({ accountToken, maxPages }) => {
      const raw = await fetchRedeemedOffersForCard(accountToken, maxPages ?? DEFAULTS.offerPageLimit);
      return normalizeRedeemed(raw);
    },
  }),

  getOfferDetails: fn({
    summary:
      'Long description + terms for one offer. Tries ADDEDTOCARD_LANDING first (more reliable when enrolled), falls back to OFFERSHUB_LANDING page1.',
    input: z.object({
      accountToken: z.string(),
      offerId: z.string(),
    }),
    examples: [{ args: { accountToken: '<token>', offerId: '<offerId>' } }],
    handler: async ({ accountToken, offerId }) => {
      const enrolled = await fetchEnrolledOffersForCard(accountToken);
      const inEnrolled = enrolled.find((o) => o.offerId === offerId);
      if (inEnrolled) {
        return {
          source: 'ADDEDTOCARD_LANDING',
          terms: inEnrolled.terms?.details || inEnrolled.terms || null,
          long_description: inEnrolled.longDescription || null,
          offer: normalizeOffer(inEnrolled),
        };
      }
      const res = await postHub({
        accountNumberProxy: accountToken,
        locale: 'en-US',
        offerPage: 'page1',
        requestType: 'OFFERSHUB_LANDING',
      });
      const list = res?.recommendedOffers?.offersList?.page1;
      const hit = Array.isArray(list) ? list.find((o) => o.offerId === offerId) : null;
      if (hit) {
        return {
          source: 'OFFERSHUB_LANDING',
          terms: hit.terms?.details || hit.terms || null,
          long_description: hit.longDescription || null,
          offer: normalizeOffer(hit),
        };
      }
      return { source: null, terms: null, long_description: null, offer: null };
    },
  }),

  searchOffers: fn({
    summary:
      'Fuzzy substring search across merchant name, description, category and redemption types. Refreshes the all-cards offer map and filters.',
    input: z.object({
      query: z.string().min(1),
      status: z.enum(['eligible', 'enrolled', 'any']).optional(),
      category: z.string().optional(),
      sortBy: z
        .enum(['reward', 'threshold', 'percentage', 'expiry_date', 'category', 'name', 'eligibleCount'])
        .optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
    examples: [{ args: { query: 'hilton', status: 'eligible', sortBy: 'reward' } }],
    handler: async (args) => {
      const cards = await fetchCards();
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: DEFAULTS.fetchBatchDelayMs,
        batchSize: DEFAULTS.fetchBatchSize,
      });
      const status = args.status || 'any';
      const filtered = offers.filter((o) => {
        if (!fuzzyMatch(o, args.query)) return false;
        if (args.category && !categoryMatches(o.category, args.category)) return false;
        if (status === 'eligible' && !(o.eligibleCards || []).length) return false;
        if (status === 'enrolled' && !(o.enrolledCards || []).length) return false;
        return true;
      });
      return sortOffers(filtered, args.sortBy || 'reward', args.sortOrder || 'desc');
    },
  }),

  getOffersByCategory: fn({
    summary:
      'Filter the across-cards offer pool by category. Recognised categories: Travel, Hotel, Dining, Shopping, Entertainment, Business, Digital, Airport Benefits.',
    input: z.object({
      category: z.string().describe('Free-form. Matches case-insensitively against offer.category with alias expansion.'),
      status: z.enum(['eligible', 'enrolled', 'any']).optional(),
      sortBy: z
        .enum(['reward', 'threshold', 'percentage', 'expiry_date', 'category', 'name', 'eligibleCount'])
        .optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
    examples: [
      { args: { category: 'Dining', status: 'eligible' } },
      { args: { category: 'Hotel', status: 'enrolled' } },
    ],
    handler: async (args) => {
      const cards = await fetchCards();
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: DEFAULTS.fetchBatchDelayMs,
        batchSize: DEFAULTS.fetchBatchSize,
      });
      const status = args.status || 'any';
      const filtered = offers.filter((o) => {
        if (!categoryMatches(o.category, args.category)) return false;
        if (status === 'eligible' && !(o.eligibleCards || []).length) return false;
        if (status === 'enrolled' && !(o.enrolledCards || []).length) return false;
        return true;
      });
      return sortOffers(filtered, args.sortBy || 'reward', args.sortOrder || 'desc');
    },
  }),

  enrollOffer: fn({
    summary:
      "Claim one offer for one card via CreateOffersHubEnrollment.web.v1 (or legacy in 'boost' mode). Returns { offerId, accountToken, result, mode, explanationMessage }.",
    input: z.object({
      accountToken: z.string(),
      offerId: z.string(),
      mode: z
        .enum(['safe', 'boost'])
        .optional()
        .describe('"safe" (default) = OFFERSHUB v2 endpoint. "boost" = legacy CreateCardAccountOfferEnrollment.v1; can bypass single-card restrictions but has higher account-flag risk.'),
    }),
    examples: [{ args: { accountToken: '<token>', offerId: '<offerId>' } }],
    handler: async ({ accountToken, offerId, mode }) => enrollOfferOnce(accountToken, offerId, mode || 'safe'),
  }),

  enrollAllOffers: fn({
    summary:
      'Sequentially enroll every eligible offer for each card (or subset). Throttled. Returns { added, skipped, failed, sessionExpired, results[], status }.',
    input: z.object({
      accountTokens: z.array(z.string()).optional().describe('Cards to enroll on. Default: all active.'),
      sortBy: z
        .enum(['reward', 'threshold', 'percentage', 'expiry_date', 'eligibleCount'])
        .optional()
        .describe('Order in which offers are attempted. Default reward desc.'),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      filter: z
        .object({
          category: z.string().optional(),
          minRewardUSD: z.number().optional(),
          minPercentage: z.number().optional(),
          merchantContains: z.string().optional(),
          excludeMerchantContains: z.array(z.string()).optional(),
        })
        .optional(),
      throttleMs: z.number().int().min(500).max(10000).optional().describe('Default 1500ms between enrollments. Lower = ban risk.'),
      mode: z.enum(['safe', 'boost']).optional(),
      maxConsecutiveFailures: z.number().int().min(1).max(20).optional(),
      dryRun: z.boolean().optional().describe('If true, return the planned (offerId, accountToken) pairs without enrolling.'),
    }),
    examples: [
      { args: { sortBy: 'reward', sortOrder: 'desc', throttleMs: 1500 } },
      { args: { filter: { minRewardUSD: 5 }, dryRun: true } },
    ],
    handler: async (args = {}) => {
      const throttleMs = args.throttleMs ?? DEFAULTS.enrollThrottleMs;
      const mode = args.mode || 'safe';
      const maxFails = args.maxConsecutiveFailures ?? DEFAULTS.enrollMaxConsecutiveFailures;

      let cards = await fetchCards();
      if (args.accountTokens?.length) {
        const want = new Set(args.accountTokens);
        cards = cards.filter((c) => want.has(c.account_token));
      }
      const { offers } = await refreshOffersAcrossCards({
        cards,
        throttleMs: DEFAULTS.fetchBatchDelayMs,
        batchSize: DEFAULTS.fetchBatchSize,
      });

      const f = args.filter || {};
      const num = (s) => (s == null ? null : parseFloat(String(s).replace(/[$,%\s]/g, '')));
      const passes = (o) => {
        if (!o.offerId || o.offerId === 'N/A') return false;
        if (f.category && !categoryMatches(o.category, f.category)) return false;
        if (f.minRewardUSD != null && (num(o.reward) ?? 0) < f.minRewardUSD) return false;
        if (f.minPercentage != null && (num(o.percentage) ?? 0) < f.minPercentage) return false;
        if (f.merchantContains && !String(o.name || '').toLowerCase().includes(f.merchantContains.toLowerCase())) return false;
        if (f.excludeMerchantContains?.length) {
          const lname = String(o.name || '').toLowerCase();
          if (f.excludeMerchantContains.some((s) => lname.includes(String(s).toLowerCase()))) return false;
        }
        return true;
      };

      const planned = sortOffers(offers.filter(passes), args.sortBy || 'reward', args.sortOrder || 'desc');
      const pairs = [];
      for (const o of planned) {
        for (const tok of o.eligibleCards) pairs.push({ accountToken: tok, offerId: o.offerId, offerName: o.name });
      }
      if (args.dryRun) return { plannedCount: pairs.length, plan: pairs };

      const results = [];
      let added = 0;
      let skipped = 0;
      let failed = 0;
      let consecutiveFailures = 0;
      let sessionExpired = false;

      for (const pair of pairs) {
        const r = await enrollOfferOnce(pair.accountToken, pair.offerId, mode);
        r.offerName = pair.offerName;
        results.push(r);
        if (r.sessionExpired) {
          sessionExpired = true;
          break;
        }
        if (r.result) {
          added++;
          consecutiveFailures = 0;
        } else if (r.duplicate || /already enrolled/i.test(r.explanationMessage || '')) {
          skipped++;
          consecutiveFailures = 0;
        } else {
          failed++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFails) {
            return {
              status: 'rate_limited',
              added,
              skipped,
              failed,
              sessionExpired,
              results,
            };
          }
        }
        await sleep(throttleMs);
      }
      return {
        status: sessionExpired ? 'session_expired' : 'ok',
        added,
        skipped,
        failed,
        sessionExpired,
        results,
      };
    },
  }),

  enrollSelective: fn({
    summary:
      'Enroll an explicit list of (accountToken, offerId) pairs. Same throttling + reporting as enrollAllOffers but no implicit fan-out.',
    input: z.object({
      assignments: z
        .array(z.object({ accountToken: z.string(), offerId: z.string() }))
        .min(1),
      throttleMs: z.number().int().min(500).max(10000).optional(),
      mode: z.enum(['safe', 'boost']).optional(),
    }),
    examples: [
      { args: { assignments: [{ accountToken: '<tok>', offerId: '<offerId>' }] } },
    ],
    handler: async (args) => {
      const throttleMs = args.throttleMs ?? DEFAULTS.enrollThrottleMs;
      const mode = args.mode || 'safe';
      const results = [];
      let added = 0;
      let skipped = 0;
      let failed = 0;
      let sessionExpired = false;
      for (const { accountToken, offerId } of args.assignments) {
        const r = await enrollOfferOnce(accountToken, offerId, mode);
        results.push(r);
        if (r.sessionExpired) {
          sessionExpired = true;
          break;
        }
        if (r.result) added++;
        else if (r.duplicate || /already enrolled/i.test(r.explanationMessage || '')) skipped++;
        else failed++;
        await sleep(throttleMs);
      }
      return {
        status: sessionExpired ? 'session_expired' : 'ok',
        added,
        skipped,
        failed,
        sessionExpired,
        results,
      };
    },
  }),

  getBenefitTrackers: fn({
    summary:
      'Platinum/Gold credit trackers per card via ReadBestLoyaltyBenefitsTrackers.v1. Returns BenefitRow[] = { benefitName, category, tracker.{targetAmount, spentAmount, remainingAmount}, periodEndDate, status }.',
    input: z.object({
      accountTokens: z.array(z.string()).optional(),
    }),
    examples: [{ args: {} }],
    handler: async (args = {}) => {
      let cards = await fetchCards();
      cards = cards.filter((c) => isAccountActive(c) && c.relationship === 'BASIC');
      if (args.accountTokens?.length) {
        const want = new Set(args.accountTokens);
        cards = cards.filter((c) => want.has(c.account_token));
      }
      return inBatches(cards, DEFAULTS.fetchBatchSize, DEFAULTS.fetchBatchDelayMs, async (c) => ({
        account_token: c.account_token,
        cardEnding: c.cardEnding,
        description: c.description,
        trackers: await fetchBenefitsForCard(c.account_token).catch(() => []),
      }));
    },
  }),

  getAccountBalance: fn({
    summary:
      'Balance + pending transaction summary for one card. Returns { balanceData, pTransactionData } from /api/servicing/v1/financials/{balances,transaction_summary}.',
    input: z.object({ accountToken: z.string() }),
    examples: [{ args: { accountToken: '<token>' } }],
    handler: async ({ accountToken }) => {
      const headers = { account_tokens: accountToken };
      const [balanceData, pTransactionData] = await Promise.all([
        getJson(URLS.balance, headers),
        getJson(URLS.pendingBalance, headers),
      ]);
      return { balanceData, pTransactionData };
    },
  }),

  getCardOffersSummary: fn({
    summary:
      'One-card overview: eligible/enrolled counts, breakdown by category, top-reward offer, soonest expiry. Faster than getDashboard when you only need one card.',
    input: z.object({ accountToken: z.string() }),
    examples: [{ args: { accountToken: '<token>' } }],
    handler: async ({ accountToken }) => {
      const [rawElig, rawEnr] = await Promise.all([
        fetchEligibleOffersForCard(accountToken),
        fetchEnrolledOffersForCard(accountToken),
      ]);
      const elig = rawElig.map(normalizeOffer);
      const enr = rawEnr.map(normalizeOffer);
      const byCat = {};
      for (const o of enr) (byCat[o.category || 'Other'] ||= []).push(o.name);
      const sortedElig = sortOffers(elig, 'reward', 'desc');
      const sortedExpiry = elig
        .filter((o) => o.expiry_date)
        .slice()
        .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
      return {
        eligibleCount: elig.length,
        enrolledCount: enr.length,
        topReward: sortedElig[0] || null,
        expiringSoonest: sortedExpiry[0] || null,
        enrolledByCategory: byCat,
        eligibleOffers: sortedElig,
        enrolledOffers: enr,
      };
    },
  }),
});
