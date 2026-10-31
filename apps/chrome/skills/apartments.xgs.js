// ==XGooseSkill==
// @name apartments
// @namespace apartments
// @version 0.1.1
// @description apartments.com property search and details using the current website session.
// @match *://www.apartments.com/*
// @match *://apartments.com/*
// @primary searchProperties
// @keyword real estate
// @keyword rentals
// @keyword 买房
// @keyword 租房
// ==/XGooseSkill==

// src/real-estate/apartments.xgs.js
import { defineSkill } from "@xgoose/skill";

// src/real-estate/access.js
import { fn } from "@xgoose/skill";
import { z } from "zod";
var empty = z.object({});
var urlInput = z.object({ url: z.string().optional() });
var queue = Promise.resolve();
var last = 0;
async function request(url) {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin) throw Error("Open this skill on " + target.origin);
  const job = queue.then(async () => {
    await new Promise((r) => setTimeout(r, Math.max(0, 1e3 - (Date.now() - last))));
    last = Date.now();
    const response = await fetch(target.href, { credentials: "include" });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${target.pathname}`);
    return response.text();
  });
  queue = job.catch(() => {
  });
  return job;
}
function json(text2) {
  return JSON.parse(text2.replace(/^\s*\{\}&&/, ""));
}
async function page(url) {
  if (!url || new URL(url, location.href).href === location.href) return document;
  return new DOMParser().parseFromString(await request(url), "text/html");
}
function next(doc) {
  const el = doc.querySelector("script#__NEXT_DATA__");
  if (!el) throw Error("Page did not return __NEXT_DATA__; open the URL in the browser.");
  return JSON.parse(el.textContent).props.pageProps;
}
var text = (doc, selector) => {
  const el = doc.querySelector(selector);
  if (!el) return null;
  const clone = el.cloneNode(true);
  for (const script of clone.querySelectorAll("script,style")) script.remove();
  return clone.textContent.replace(/\s+/g, " ").trim() || null;
};
function schemas(doc) {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((el) => {
    try {
      const v = JSON.parse(el.textContent);
      return Array.isArray(v) ? v : v["@graph"] || [v];
    } catch {
      return [];
    }
  });
}
var photos = /* @__PURE__ */ new Map();
function propertyResult(url, data, images = []) {
  const urls = [...new Set(images.filter(Boolean))];
  photos.set(url, urls);
  return { url, ...data, images: urls.map((url2, i) => ({ image: i + 1, url: url2 })), readImages: urls.length ? `readPropertyImages({url:${JSON.stringify(url)},images:[N]})` : void 0 };
}
function entry(summary, input, handler, args = {}) {
  return fn({ summary, input, examples: [{ args }], handler: (raw = {}) => handler(input.parse(raw)) });
}
function imageFunction() {
  return entry("Return selected original property photos for the extension background to attach pixels.", z.object({ url: z.string(), images: z.array(z.number().int().positive()).default([1]) }), ({ url, images }) => ({ imageContext: { requested: true, delivery: "urls_only_until_host_attaches", images: images.map((image) => ({ image, url: photos.get(url)[image - 1] })) } }));
}
function searchState(p) {
  return p.searchPageState || p.cat1 && p || p.componentProps?.searchPageState;
}
function zillowResults(p, url) {
  const s = searchState(p);
  if (!s?.cat1) throw Error("No Zillow searchPageState in this response");
  return { url, queryState: s.queryState, listings: s.cat1.searchResults?.listResults || [], total: s.cat1.searchList?.totalResultCount ?? s.categoryTotals?.cat1?.totalResultCount, pagination: s.cat1.searchList?.pagination };
}
var zillowFunctions = {
  searchProperties: entry("Search sale/rental/sold listings using Zillow SSR and region-pinned searchQueryState.", z.object({ location: z.string(), status: z.enum(["for_sale", "for_rent", "sold"]).default("for_sale"), minPrice: z.number().optional(), maxPrice: z.number().optional(), beds: z.number().optional(), baths: z.number().optional(), page: z.number().int().positive().default(1), sort: z.enum(["priorityscore", "pricea", "priced", "days"]).default("priorityscore") }), async (a) => {
    const base = "/homes/" + encodeURIComponent(a.location.trim()) + "_rb/";
    const resolved = next(await page(base));
    const state = searchState(resolved);
    if (!state?.queryState?.regionSelection?.length) throw Error("Location was not resolved; open the Zillow search page for this location.");
    const filterState = { sortSelection: { value: a.sort } };
    if (a.status !== "for_sale") {
      for (const key of ["isForSaleByAgent", "isForSaleByOwner", "isNewConstruction", "isComingSoon", "isAuction", "isForSaleForeclosure"]) filterState[key] = { value: false };
      filterState[a.status === "for_rent" ? "isForRent" : "isRecentlySold"] = { value: true };
    }
    if (a.minPrice !== void 0 || a.maxPrice !== void 0) filterState.price = { ...a.minPrice !== void 0 ? { min: a.minPrice } : {}, ...a.maxPrice !== void 0 ? { max: a.maxPrice } : {} };
    if (a.beds !== void 0) filterState.beds = { min: a.beds };
    if (a.baths !== void 0) filterState.baths = { min: a.baths };
    const query = { ...state.queryState, usersSearchTerm: a.location, filterState, pagination: { currentPage: a.page }, isListVisible: true, isMapVisible: false };
    const url = new URL(base, location.origin);
    url.searchParams.set("searchQueryState", JSON.stringify(query));
    return zillowResults(next(await page(url.href)), url.href);
  }, { location: "Chicago, IL", status: "for_rent", maxPrice: 2500 }),
  getProperty: entry("Read property facts, price/tax history and photos from a Zillow homedetails URL.", urlInput, async ({ url = location.href }) => {
    const p = next(await page(url));
    const raw = p.gdpClientCache ?? p.componentProps?.gdpClientCache;
    const cache = typeof raw === "string" ? JSON.parse(raw) : raw;
    const property = Object.values(cache || {}).find((v) => v?.property)?.property;
    if (!property) throw Error("No property record returned for this URL");
    return propertyResult(url, { property }, (property.responsivePhotos || []).map((p2) => p2.url || p2.mixedSources?.jpeg?.at(-1)?.url));
  }),
  readPropertyImages: imageFunction()
};
async function stingray(path) {
  const value = json(await request(path));
  if (value.resultCode !== void 0 && value.resultCode !== 0) throw Error(value.errorMessage || `Redfin resultCode ${value.resultCode}`);
  return value.payload;
}
var redfinFunctions = {
  resolveLocation: entry("Resolve a city, ZIP, neighborhood or address with Redfin autocomplete.", z.object({ query: z.string() }), async ({ query }) => {
    const payload = await stingray("/stingray/do/location-autocomplete?" + new URLSearchParams({ location: query, start: "0", count: "1", v: "2", iss: "false", ooa: "true", mrs: "false" }));
    const types = { neighborhood: 1, zipcode: 2, county: 5, city: 6 };
    return { ...payload, regions: (payload.sections || []).filter((section) => section.name === "Places").flatMap((section) => section.rows || []).map((row) => {
      const [prefix, id] = row.id.split("_");
      const kind = row.url?.match(/^\/(city|zipcode|neighborhood|county)\//)?.[1];
      return { ...row, regionId: Number(id), regionType: types[kind] ?? Number(prefix) };
    }) };
  }, { query: "Chicago, IL" }),
  searchProperties: entry("Search Redfin for-sale listings by an explicit region ID/type from resolveLocation. GIS supports for-sale here.", z.object({ regionId: z.number(), regionType: z.number(), minPrice: z.number().optional(), maxPrice: z.number().optional(), beds: z.number().optional(), baths: z.number().optional(), limit: z.number().int().min(1).max(350).default(40) }), async (a) => {
    const q = new URLSearchParams({ al: "1", num_homes: String(a.limit), region_id: String(a.regionId), region_type: String(a.regionType), sf: "1,2,3,5,6,7", start: "0", status: "9", uipt: "1,2,3,4,5,6,7,8", v: "8" });
    for (const [field, key] of [["minPrice", "min_price"], ["maxPrice", "max_price"], ["beds", "num_beds"], ["baths", "num_baths"]]) if (a[field] !== void 0) q.set(key, String(a[field]));
    return { source: location.origin + "/stingray/api/gis?" + q, payload: await stingray("/stingray/api/gis?" + q) };
  }, { regionId: 29470, regionType: 6 }),
  getProperty: entry("Resolve a canonical Redfin property URL and read above/below-the-fold facts and history.", urlInput, async ({ url = location.href }) => {
    const path = new URL(url, location.origin).pathname;
    const ids = await stingray("/stingray/api/home/details/initialInfo?path=" + encodeURIComponent(path));
    const q = new URLSearchParams({ propertyId: String(ids.propertyId), listingId: String(ids.listingId), accessLevel: "1" });
    return { url, aboveTheFold: await stingray("/stingray/api/home/details/aboveTheFold?" + q), belowTheFold: await stingray("/stingray/api/home/details/belowTheFold?" + q) };
  })
};
var apartmentsFunctions = {
  searchProperties: entry("Read an Apartments.com city/filter/page URL; preserve native next-page links.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const listings = [...doc.querySelectorAll("article.placard[data-listingid]")].map((el) => ({ id: el.getAttribute("data-listingid"), url: el.querySelector("a.property-link")?.href || el.getAttribute("data-url"), name: text(el, ".property-title"), address: text(el, ".property-address"), price: text(el, ".property-pricing") || [...el.querySelectorAll(".priceTextBox")].map((x) => x.textContent.trim()).join(" / ") || null, beds: text(el, ".property-beds") || [...el.querySelectorAll(".bedTextBox")].map((x) => x.textContent.trim()).join(" / ") || null, offers: [...el.querySelectorAll(".bedRentBox")].map((x) => ({ beds: text(x, ".bedTextBox"), price: text(x, ".priceTextBox") })), summary: text(el, ".property-description") }));
    if (!listings.length && !doc.querySelector("#placardContainer")) throw Error("Search page did not contain rental listings; open the URL in the browser.");
    return { url, listings, next: doc.querySelector('a[aria-label="Next"], a[aria-label="Next Page"], .paging a.next')?.getAttribute("href") || null };
  }),
  getProperty: entry("Read rental pricing, floor-plan/unit text, amenities, reviews and structured property data.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const data = schemas(doc);
    const name = text(doc, "#propertyName");
    if (!name && !data.length) throw Error("No apartment property returned");
    return propertyResult(url, { name, address: text(doc, ".propertyAddressContainer"), pricing: text(doc, ".rentInfoDetail"), floorPlans: text(doc, "#pricingView"), amenities: text(doc, "#amenitiesSection"), reviews: text(doc, "#reviewsSection"), rating: text(doc, ".averageRating"), fees: text(doc, "#feesSection"), structuredData: data }, [...doc.querySelectorAll(".aspectRatioImage img")].map((el) => el.getAttribute("src")));
  }),
  readPropertyImages: imageFunction()
};
var realtorFunctions = {
  searchProperties: entry("Read Realtor city/filter/page URL; current search uses React Router loader data, fetched SSR uses Next data.", urlInput, async ({ url = location.href }) => {
    const doc = await page(url);
    const live = doc === document ? window.__reactRouterDataRouter?.state?.loaderData?.srp?.search?.value : null;
    const p = live ? null : next(doc);
    const data = live || p.initialReduxState?.searchResults || p.searchResults;
    if (!data) throw Error("No Realtor search payload; open the URL in the browser then call again.");
    return { url, data };
  }),
  getProperty: entry("Read Realtor listing facts, description, fees, history and photos from the detail-page hydration.", urlInput, async ({ url = location.href }) => {
    const p = next(await page(url));
    const property = p.initialReduxState?.propertyDetails;
    if (!property) throw Error("No Realtor propertyDetails in response");
    return { url, property };
  })
};

// src/real-estate/apartments.xgs.js
var apartments_xgs_default = defineSkill(apartmentsFunctions, { instructions: "Run on apartments.com. URL inputs use native site search filters and pagination. Photo handlers delegate image pixels to the extension background." });
export {
  apartments_xgs_default as default
};
