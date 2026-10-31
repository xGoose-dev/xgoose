// ==XGooseSkill==
// @name         delta-awards
// @namespace    delta
// @version      0.1.1
// @description  Delta SkyMiles award offers through rm-offer-gql: miles, available seats, trip summaries, original price fields and multi-date searches in the current browser session.
// @match        https://www.delta.com/*
// @primary      searchOffers
// @keyword      Delta
// @keyword      DL
// @keyword      SkyMiles
// @keyword      达美
// @connect      offer-api-prd.delta.com
// ==/XGooseSkill==
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';
const ENDPOINT='https://offer-api-prd.delta.com/prd/rm-offer-gql';
// GraphQL field reference: https://github.com/jeremyyma/AwardFlightSearch
// Schema query reproduced under MIT, Copyright (c) 2026 Jeremy Ma.
/* Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
const QUERY="query ($offerSearchCriteria: OfferSearchCriteriaInput!) {\n  gqlSearchOffers(offerSearchCriteria: $offerSearchCriteria) {\n    gqlOffersSets {\n      trips {\n        tripId\n        originAirportCode\n        destinationAirportCode\n        scheduledDepartureLocalTs\n        stopCnt\n      }\n      offers {\n        offerId\n        soldOut\n        additionalOfferProperties { fareType soldOut unavailableForSale }\n        offerItems {\n          retailItems {\n            retailItemMetaData {\n              fareInformation {\n                availableSeatCnt\n                farePrice {\n                  totalFarePrice {\n                    milesEquivalentPrice { mileCnt }\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}";
const trip=z.object({origin:z.string(),destination:z.string(),date:z.string()});
const input=z.object({trips:z.array(trip).min(1),adults:z.number().int().min(1).max(9).optional(),fareType:z.string().optional(),nonstop:z.boolean().optional(),maxMiles:z.number().positive().optional(),minSeats:z.number().int().positive().optional(),page:z.number().int().positive().optional(),limit:z.number().int().positive().optional()});
const list=value=>Array.isArray(value)?value:value?[value]:[];
function captured() {
 const bridge=globalThis.__xgoose;
 const requests=bridge?.getNetworkRequests({filter:'rm-offer-gql',limit:30}) ?? [];
 for(const request of requests.reverse()){
  const raw=bridge.getNetworkRequestDetail(request.id,'body');
  const body=typeof raw==='string'?JSON.parse(raw):raw;
  if(body?.variables?.offerSearchCriteria && /gqlSearchOffers/.test(body.query ?? ''))return {body,headers:bridge.getNetworkRequestDetail(request.id,'headers')?.req ?? {},request};
 }
 return null;
}
function buildRequest(p,seed) {
 const body=seed ? JSON.parse(JSON.stringify(seed)) : {query:QUERY,variables:{offerSearchCriteria:{productGroups:[{productCategoryCode:'FLIGHTS'}],offersCriteria:{preferences:{refundableOnly:false,showGlobalRegionalUpgradeCertificate:true,excludeBrandTypes:[]},pricingCriteria:{priceableIn:['MILES']},flightRequestCriteria:{currentTripIndexId:'0',sortableOptionId:null,selectedOfferId:'',sortByBrandId:'MAIN',additionalCriteriaMap:{rollOutTag:'GBB'}}}}}};
 const criteria=body.variables.offerSearchCriteria,offers=criteria.offersCriteria;
 criteria.customers=Array.from({length:p.adults ?? 1},(_,i)=>({passengerTypeCode:'ADT',passengerId:String(i+1)}));
 offers.resultsPageNum=p.page ?? 1;offers.resultsPerRequestNum=p.limit ?? 30;
 offers.pricingCriteria={...offers.pricingCriteria,priceableIn:['MILES']};
 offers.preferences={...offers.preferences,nonStopOnly:p.nonstop ?? false};
 offers.flightRequestCriteria.searchOriginDestination=p.trips.map(trip=>({departureLocalTs:`${trip.date}T00:00:00`,origins:[{airportCode:trip.origin}],destinations:[{airportCode:trip.destination}]}));
 if(p.fareType)offers.flightRequestCriteria.sortByBrandId=p.fareType;
 return body;
}
function normalize(data,p={}) {
 if(data.errors?.length)throw new Error(data.errors.map(error=>error.message).join('; '));
 const sets=data.data?.gqlSearchOffers?.gqlOffersSets;
 if(!Array.isArray(sets))throw new Error('Delta response missing gqlSearchOffers.gqlOffersSets');
 const offers=[];
 for(const set of sets)for(const offer of set.offers ?? []){
  const properties=offer.additionalOfferProperties ?? {};
  if(offer.soldOut || properties.soldOut || properties.unavailableForSale)continue;
  if(p.fareType && properties.fareType!==p.fareType)continue;
  if(p.nonstop && (set.trips ?? []).some(trip=>trip.stopCnt>0))continue;
  for(const item of offer.offerItems ?? [])for(const retail of item.retailItems ?? [])for(const fare of list(retail.retailItemMetaData?.fareInformation))for(const price of list(fare.farePrice)){
   const total=price.totalFarePrice, miles=total?.milesEquivalentPrice?.mileCnt;
   if(miles==null || (p.maxMiles!=null && miles>p.maxMiles))continue;
   const seats=fare.availableSeatCnt ?? null;
   if(p.minSeats!=null && (seats==null || seats<p.minSeats))continue;
   offers.push({offerId:offer.offerId,fareType:properties.fareType,miles,seats,prices:price,trips:set.trips ?? []});
  }
 }
 return offers.sort((a,b)=>a.miles-b.miles);
}
async function searchOffers(p) {
 const seed=captured();
 const headers={'Content-Type':'application/json',accept:'application/json',airline:'DL',applicationid:'DC',channelid:'DCOM',authorization:'GUEST',transactionid:crypto.randomUUID(),'x-app-route':'search','x-app-type':'dcom-shop'};
 for(const [key,value] of Object.entries(seed?.headers ?? {}))if(['authorization','airline','applicationid','channelid','x-app-route','x-app-type'].includes(key.toLowerCase()))headers[key.toLowerCase()]=value;
 const response=await fetch(ENDPOINT,{method:'POST',credentials:'include',headers,body:JSON.stringify(buildRequest(p,seed?.body))});
 if(!response.ok)throw new Error(`Delta offers HTTP ${response.status}`);
 const offers=normalize(await response.json(),p);
 return {offers,trips:p.trips,adults:p.adults ?? 1,page:p.page ?? 1,source:ENDPOINT};
}
export default defineSkill({
 searchOffers:fn({summary:'Search one-way, return or multi-city SkyMiles offers; returns miles, seats and original price fields.',input,examples:[{args:{trips:[{origin:'ATL',destination:'LHR',date:'2026-12-01'}],adults:2}}],handler:searchOffers}),
 readCurrentOffers:fn({summary:'Read the most recent captured Delta offer response with its actual GraphQL price fields.',input:z.object({maxMiles:z.number().positive().optional(),minSeats:z.number().int().positive().optional()}),handler:p=>{const seed=captured();if(!seed)throw new Error('Run a Delta miles search on this page first.');const response=globalThis.__xgoose.getNetworkRequestDetail(seed.request.id,'response');const data=typeof response.body==='string'?JSON.parse(response.body):response.body;return {offers:normalize(data,p),source:ENDPOINT};}}),
 scanDates:fn({summary:'Search the same itinerary on several departure dates, preserving each return-leg offset.',input:input.extend({dates:z.array(z.string()),delayMs:z.number().nonnegative().optional()}),handler:async p=>{const results=[],start=Date.parse(p.trips[0].date);for(const date of p.dates){const shift=Date.parse(date)-start;const trips=p.trips.map(trip=>({...trip,date:new Date(Date.parse(trip.date)+shift).toISOString().slice(0,10)}));results.push({date,...await searchOffers({...p,trips})});if(p.delayMs)await new Promise(resolve=>setTimeout(resolve,p.delayMs));}return {results};}}),
 normalizeOffers:fn({summary:'Normalize a captured rm-offer-gql response, retaining its price fields.',input:z.object({data:z.any(),filters:input.partial().optional()}),handler:p=>({offers:normalize(p.data,p.filters)})}),
},{instructions:'积分价格、座位数和 prices 来自 Delta 实际报价。沿用页面已捕获的 gqlSearchOffers 查询可保留该页面请求的税费字段；初始查询提供 miles 和 seats。'});
