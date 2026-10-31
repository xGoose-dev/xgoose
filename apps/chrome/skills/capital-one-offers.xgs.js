// ==XGooseSkill==
// @name        capital-one-offers
// @namespace   c1o
// @version     0.1.1
// @description Capital One Shopping (web) + Capital One Offers (miles) feed scraper. Same-origin against capitaloneshopping.com / capitaloneoffers.com. Lifted from uscardforum #493086 / Capital-One-Offers-Ultimate-API-Scraper v45.1.
// @match       *://capitaloneshopping.com/*
// @match       *://*.capitaloneshopping.com/*
// @match       *://capitaloneoffers.com/*
// @match       *://*.capitaloneoffers.com/*
// @detect      /(capitaloneshopping|capitaloneoffers)\.com$/.test(location.hostname)
// @run-at      document_idle
// @connect     <self>
// @primary     listAllOffers
// @keyword     capital one
// @keyword     C1
// @keyword     C1S
// @keyword     C1O
// @keyword     Capital One Shopping
// @keyword     Capital One Offers
// @keyword     VX miles
// @keyword     cashback
// @keyword     返现
// @keyword     信用卡返现
// @keyword     美卡论坛 c1
// ==/XGooseSkill==

/**
 * Capital One Shopping (web) + Capital One Offers (miles) feed scraper. Same-origin against capitaloneshopping.com / capitaloneoffers.com. Lifted from uscardforum #493086 / Capital-One-Offers-Ultimate-API-Scraper v45.1.
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # Capital One Offers — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object (or none). The skill loads on `capitaloneshopping.com` and `capitaloneoffers.com` and uses `credentials: 'include'` for both. Web offers (`listAllOffers`) work without logging in but get more personalized when you do; miles offers (`listMilesOffers`) require a captured token from being on `capitaloneoffers.com/feed/...` at least once. **Gmail integration is intentionally out of scope** — the v45.1 userscript pairs with a Google Apps Script for that, but a browser skill can't deploy serverless functions. If the user wants email offers, they should keep using the userscript directly.
 * ## Property identifier — `offerId`
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const TOKEN_STORAGE_KEY = "c1o_miles_token";
function stableHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h ^ s.charCodeAt(i);
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}
__name(stableHash, "stableHash");
function detectReward(text) {
  const t = String(text);
  const pct = t.match(/\b(\d[\d,]*(?:\.\d+)?)\s*%/);
  if (pct) return { kind: "percent", amount: Number(pct[1].replace(/,/g, "")) };
  const xMiles = t.match(/(\d{1,3}(?:\.\d+)?)x\s*miles?/i);
  if (xMiles) return { kind: "miles", amount: Number(xMiles[1]) };
  const cash = t.match(/\b(?:get|earn|receive|save)\s+(?:up to\s+)?\$(\d[\d,]*(?:\.\d+)?)/i)
    || t.match(/\$(\d[\d,]*(?:\.\d+)?)\s+(?:back|cash\s*back|statement credit|off)\b/i)
    || t.match(/^\s*\$(\d[\d,]*(?:\.\d+)?)\s*$/);
  if (cash) return { kind: "cash", amount: Number(cash[1].replace(/,/g, "")) };
  if (/miles?/i.test(t)) return { kind: "miles", amount: null };
  return { kind: "unknown", amount: null };
}
__name(detectReward, "detectReward");
function makeRow(merchant, reward, exclusions, href, source) {
  const r = detectReward(reward);
  return {
    offerId: stableHash(`${source}|${merchant.toLowerCase()}|${reward.slice(0, 80)}`),
    merchant,
    reward,
    rewardKind: r.kind,
    rewardAmount: r.amount,
    exclusions,
    href,
    source
  };
}
__name(makeRow, "makeRow");
function dedupe(rows) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.offerId)) continue;
    seen.add(r.offerId);
    out.push(r);
  }
  return out;
}
__name(dedupe, "dedupe");
function captureMilesToken() {
  if (typeof location === "undefined") return { token: null };
  if (!location.hostname.includes("capitaloneoffers.com")) {
    return { token: null };
  }
  const m = location.pathname.match(/^\/feed\/([^/?#]+)/);
  if (!m) return { token: null };
  const token = m[1];
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
  }
  return { token };
}
__name(captureMilesToken, "captureMilesToken");
function readMilesToken() {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}
__name(readMilesToken, "readMilesToken");
async function listAllOffers(params) {
  if (!params || typeof params !== "object") {
    throw new Error("capital-one-offers.listAllOffers: pass {state, zipcode, pages?}");
  }
  if (!params.state || !params.zipcode) {
    throw new Error("capital-one-offers.listAllOffers: state and zipcode are required (US 2-letter + 5-digit ZIP)");
  }
  const cap = Math.max(1, params.pages ?? 25);
  let nextPageToken = null;
  let pagesFetched = 0;
  const collected = [];
  let cursorExhausted = false;
  let status = "ok";
  while (pagesFetched < cap) {
    if (params.signal?.aborted) {
      status = "partial";
      break;
    }
    const body = JSON.stringify({
      contentProps: {
        pagination: nextPageToken ? { limit: 100, nextPageToken } : { limit: 100 }
      },
      context: {
        location: { state: params.state, zipcode: params.zipcode }
      }
    });
    const r = await fetch("https://capitaloneshopping.com/api/v1/feed", {
      method: "POST",
      credentials: "include",
      cache: "no-cache",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body
    });
    if (!r.ok) {
      status = "rate_limited";
      break;
    }
    const data = await r.json().catch(() => ({}));
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length && !nextPageToken) {
      status = "rate_limited";
      break;
    }
    for (const item of items) {
      const merchant = String(item?.merchantName ?? item?.merchantDisplayText ?? "Unknown");
      const reward = String(item?.stats?.cashbackV2 ?? item?.stats?.miles ?? "");
      const exclusions = String(item?.stats?.exclusionsText ?? "None");
      const href = typeof item?.href === "string" ? item.href : null;
      collected.push(makeRow(merchant, reward, exclusions, href, "web"));
    }
    pagesFetched++;
    nextPageToken = data?.pagination?.nextPageToken ?? null;
    if (!nextPageToken) {
      cursorExhausted = true;
      break;
    }
  }
  return { status, offers: dedupe(collected), pagesFetched, cursorExhausted };
}
__name(listAllOffers, "listAllOffers");
function dfsCollect(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) dfsCollect(v, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.merchantTLD && (node.buttonText || node.rateText)) {
    const reward = String(node.buttonText || node.rateText || "");
    if (/mile/i.test(reward)) {
      const tld = String(node.merchantTLD);
      const merchant = tld.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
      out.push(makeRow(merchant, reward, "\u{1F4B3} VX Card", null, "miles"));
    }
  }
  for (const v of Object.values(node)) dfsCollect(v, out);
}
__name(dfsCollect, "dfsCollect");
async function listMilesOffers() {
  if (typeof location !== "undefined" && !location.hostname.includes("capitaloneoffers.com")) {
    return { status: "wrong_origin", offers: [], token: null };
  }
  captureMilesToken();
  const token = readMilesToken();
  if (!token) {
    return { status: "miles_token_expired", offers: [], token: null };
  }
  const r = await fetch(
    `https://capitaloneoffers.com/feed/${encodeURIComponent(token)}?contentSlug=ease-web-l1&_data=routes%2Ffeed.%24accountReferenceId`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-cache",
      headers: { Accept: "application/json", "x-remix-fetch": "yes" }
    }
  );
  if (r.status === 401 || r.status === 403 || r.status === 302) {
    return { status: "miles_token_expired", offers: [], token };
  }
  if (!r.ok) {
    return { status: "miles_token_expired", offers: [], token };
  }
  const data = await r.json().catch(() => ({}));
  const collected = [];
  dfsCollect(data, collected);
  return { status: "ok", offers: dedupe(collected), token };
}
__name(listMilesOffers, "listMilesOffers");
async function getMerchantOffers(params) {
  if (!params?.merchant) throw new Error("capital-one-offers.getMerchantOffers: `merchant` is required");
  const includeWeb = params.includeWeb !== false;
  const includeMiles = params.includeMiles !== false;
  const m = params.merchant.toLowerCase();
  let web = [];
  let miles = [];
  if (includeWeb) {
    if (!params.state || !params.zipcode) {
      throw new Error("capital-one-offers.getMerchantOffers: pass state + zipcode when includeWeb is true (default)");
    }
    const r = await listAllOffers({ state: params.state, zipcode: params.zipcode });
    web = r.offers.filter((o) => o.merchant.toLowerCase().includes(m));
  }
  if (includeMiles) {
    const r = await listMilesOffers();
    miles = r.offers.filter((o) => o.merchant.toLowerCase().includes(m));
  }
  return { merchant: params.merchant, web, miles };
}
__name(getMerchantOffers, "getMerchantOffers");
function absolutize(href) {
  if (/^https?:\/\//.test(href)) return href;
  return `https://capitaloneshopping.com${href.startsWith("/") ? "" : "/"}${href}`;
}
__name(absolutize, "absolutize");
async function activateOffer(params) {
  if (!params?.offerId) throw new Error("capital-one-offers.activateOffer: `offerId` is required");
  if (params.offer?.href) return { status: "ok", url: absolutize(params.offer.href) };
  return { status: "no_url", url: null };
}
__name(activateOffer, "activateOffer");
async function listShoppingTrips() {
  return {
    status: "endpoint_unknown",
    trips: [],
    note: "Shopping Trips JSON endpoint URL has not been published. See uscardforum #458175 for the manual F12 technique. Capture the `trip*` request from DevTools and add the URL + body shape to this skill to enable this function."
  };
}
__name(listShoppingTrips, "listShoppingTrips");

export default defineSkill({
  activateOffer: fn({
    summary: "build the activation URL from an offerId.",
    input: z.any().optional(),
    handler: async (params) => activateOffer(params),
  }),
  captureMilesToken: fn({
    summary: "call once on /feed/{token} to persist the token to sessionStorage.",
    input: z.any().optional(),
    handler: async (params) => captureMilesToken(params),
  }),
  getMerchantOffers: fn({
    summary: "group offers across web + miles for one merchant.",
    input: z.any().optional(),
    handler: async (params) => getMerchantOffers(params),
  }),
  listAllOffers: fn({
    summary: "★ main entry. Web feed crawl across pages.",
    input: z.any().optional(),
    handler: async (params) => listAllOffers(params),
  }),
  listMilesOffers: fn({
    summary: "uses captured /feed/{token}; returns 'miles_token_expired' if missing.",
    input: z.any().optional(),
    handler: async (params) => listMilesOffers(params),
  }),
  listShoppingTrips: fn({
    summary: "placeholder; endpoint URL needs RE.",
    input: z.any().optional(),
    handler: async (params) => listShoppingTrips(params),
  }),
});

