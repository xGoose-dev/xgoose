// ==XGooseSkill==
// @name         united-awards
// @namespace    united
// @version      0.1.1
// @description  United MileagePlus award calendar: daily miles by cabin, original cash currencies, mixed-cabin indicators and multi-month scans through the browser session.
// @match        https://www.united.com/*
// @primary      searchCalendar
// @keyword      United
// @keyword      UA
// @keyword      MileagePlus
// @keyword      联航
// @connect      <self>
// ==/XGooseSkill==

// Request/response field reference: https://github.com/JadedOut/seatsaero/blob/master/core/united_api.py
// Implementation uses the current browser session, without exporting cookies.
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';
const ENDPOINT = 'https://www.united.com/api/flight/FetchAwardCalendar';
const CABINS = {'MIN-ECONOMY-SURP-OR-DISP':'economy','ECO-PREMIUM-DISP':'premium_economy','MIN-BUSINESS-SURP-OR-DISP':'business','MIN-BUSINESS-SURP-OR-DISP-NOT-MIXED':'business','MIN-FIRST-SURP-OR-DISP':'first','MIN-FIRST-SURP-OR-DISP-NOT-MIXED':'first'};
const input = z.object({origin:z.string(),destination:z.string(),departDate:z.string(),adults:z.number().int().min(1).max(9).optional(),cabin:z.enum(['economy','premium_economy','business','first']).optional(),nonstop:z.boolean().optional(),noMixedCabin:z.boolean().optional(),minSeats:z.number().int().positive().optional(),maxMiles:z.number().positive().optional()});
const clone = value => JSON.parse(JSON.stringify(value));
function captured(filter = "FetchAwardCalendar") {
 const bridge = globalThis.__xgoose;
 const request = bridge?.getNetworkRequests({filter,limit:20}).at(-1);
 if (!request) return null;
 const raw = bridge.getNetworkRequestDetail(request.id,'body');
 const headers = bridge.getNetworkRequestDetail(request.id,'headers')?.req ?? {};
 return {body: typeof raw === 'string' ? JSON.parse(raw) : raw, headers};
}
function buildRequest(p, seed) {
 const [year,month,day]=p.departDate.split('-').map(Number);
 const body=seed ? clone(seed) : {SearchTypeSelection:1,SortType:'bestmatches',SortTypeDescending:false,Trips:[{Index:1,TripIndex:1,SearchRadiusMilesOrigin:0,SearchRadiusMilesDestination:0,DepartTimeApprox:0,SearchFiltersIn:{FareFamily:'ECONOMY',AirportsStop:null,AirportsStopToAvoid:null,ShopIndicators:{IsTravelCreditsApplied:false,IsDoveFlow:true}}}],CartId:crypto.randomUUID(),NGRP:true,CalendarLengthOfStay:-1,PetCount:0,Characteristics:[{Code:'SOFT_LOGGED_IN',Value:false},{Code:'UsePassedCartId',Value:false}],FareType:'mixedtoggle',BuildHashValue:'true',BBXSolutionSetIdSelected:null,FlexibleDaysAfter:0,FlexibleDaysBefore:0};
 body.Trips=[{...body.Trips[0],Origin:p.origin,Destination:p.destination,DepartDate:p.departDate}];
 body.AwardTravel=true;body.CabinPreferenceMain=p.cabin ?? 'economy';
 body.PaxInfoList=Array.from({length:p.adults ?? 1},()=>({PaxType:1}));
 body.RecentSearchKey=`${p.origin}${p.destination}${month}/${day}/${year}`;
 body.CalendarFilters={...body.CalendarFilters,Filters:{...body.CalendarFilters?.Filters,PriceScheduleOptions:{...body.CalendarFilters?.Filters?.PriceScheduleOptions,Stops:1}}};
 return body;
}
function bookingUrl(p) {
 return `https://www.united.com/en/us/fsr/choose-flights?${new URLSearchParams({f:p.origin,t:p.destination,d:p.departDate,tt:'1',at:'1',sc:'7',px:String(p.adults ?? 1),taxng:'1',newHP:'true'})}`;
}
function isoDate(value) {
 if(value.includes('/')){const [m,d,y]=value.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
 return value.slice(0,10);
}
function normalize(data,p={}) {
 if(data.data?.Status !== 1) throw new Error(`United calendar Status=${data.data?.Status ?? 'missing'}`);
 const hits=[];
 for(const month of data.data.Calendar.Months)for(const week of month.Weeks)for(const day of week.Days){
  if(day.DayNotInThisMonth)continue;
  for(const solution of day.Solutions ?? []){
   const mileage=solution.Prices.find(price=>price.Currency==='MILES');
   if(!mileage)continue;
   const cabin=CABINS[solution.CabinType] ?? solution.CabinType;
   if(p.cabin && cabin!==p.cabin)continue;
   if(p.maxMiles!=null && mileage.Amount>p.maxMiles)continue;
   hits.push({date:isoDate(day.DateValue),cabin,cabinCode:solution.CabinType,nonMixed:solution.CabinType.endsWith('-NOT-MIXED'),awardType:solution.AwardType,miles:mileage.Amount,cash:solution.Prices.filter(price=>price.Currency!=='MILES').map(price=>({amount:price.Amount,currency:price.Currency})),bookingUrl:bookingUrl({...p,departDate:isoDate(day.DateValue)})});
  }
 }
 return hits.sort((a,b)=>a.date.localeCompare(b.date)||a.miles-b.miles);
}
async function request(p, detail = false) {
 const seed=captured(detail ? "FetchFlights|FetchAwardCalendar" : "FetchAwardCalendar");
 let token=Object.entries(seed?.headers ?? {}).find(([key])=>key.toLowerCase()==='x-authorization-api')?.[1];
 if(!token){
  const response=await fetch('/api/auth/anonymous-token',{credentials:'same-origin'});
  if(!response.ok)throw new Error(`United session HTTP ${response.status}`);
  const json=await response.json(), value=json.data?.token ?? json.token;
  token=`bearer ${typeof value==='string' ? value : value.hash}`;
 }
 const body = buildRequest(p,seed?.body);
 if(detail) body.CalendarLengthOfStay=0;
 const response=await fetch(detail ? ENDPOINT.replace('FetchAwardCalendar','FetchFlights') : ENDPOINT,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-authorization-api':token},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`United calendar HTTP ${response.status}`);
 return response.json();
}
async function searchCalendar(p) {
 const data=await request(p);
 return {origin:p.origin,destination:p.destination,adults:p.adults ?? 1,hits:normalize(data,p),source:ENDPOINT};
}
function seatCount(segment,code) {
 const entry=(segment.BookingClassAvailability ?? '').split('|').find(value=>value.replace(/\d+$/,'')===code);
 return entry ? Number(entry.match(/\d+$/)[0]) : null;
}
function normalizeFlights(json,p={}) {
 if(json.data?.Status!==1) throw new Error(`United flights Status=${json.data?.Status ?? 'missing'}`);
 const flights=[];
 for(const trip of json.data.Trips)for(const flight of trip.Flights){
  const segments=[flight,...(flight.Connections ?? [])];
  if(p.nonstop && segments.length!==1)continue;
  const fares=[];
  for(const product of flight.Products){
   const mileage=product.Prices.find(price=>price.Currency==='MILES');
   if(!mileage)continue;
   const cabin=CABINS[product.ProductType] ?? product.CabinType;
   if(p.cabin && cabin!==p.cabin)continue;
   if(p.maxMiles!=null && mileage.Amount>p.maxMiles)continue;
   const segmentProducts=segments.map(segment=>segment.Products.find(item=>item.ProductType===product.ProductType));
   const cabins=segmentProducts.map(item=>item?.CabinType).filter(Boolean);
   const mixedCabin=product.ProductType.endsWith('-NOT-MIXED') ? false : cabins.length===segments.length ? new Set(cabins).size>1 : null;
   if(p.noMixedCabin && mixedCabin!==false)continue;
   const counts=segments.map((segment,i)=>seatCount(segment,segmentProducts[i]?.BookingCode ?? product.BookingCode));
   const seats=counts.every(n=>n!==null) ? Math.min(...counts) : null;
   if(p.minSeats!=null && (seats===null || seats<p.minSeats))continue;
   fares.push({cabin,bookingCode:product.BookingCode,miles:mileage.Amount,cash:product.Prices.filter(price=>price.Currency!=='MILES').map(price=>({amount:price.Amount,currency:price.Currency})),mixedCabin,seats,segmentCabins:cabins});
  }
  if(!fares.length)continue;
  flights.push({origin:trip.Origin,destination:trip.Destination,date:trip.DepartDate,durationMinutes:flight.TravelMinutesTotal,fares,segments:segments.map(segment=>({flightNumber:`${segment.MarketingCarrier}${segment.FlightNumber}`,operatingCarrier:segment.OperatingCarrier,from:segment.Origin,to:segment.Destination,depart:segment.DepartDateTime,arrive:segment.DestinationDateTime,aircraft:segment.EquipmentDisclosures?.EquipmentDescription,connectionMinutes:segment.ConnectTimeMinutes ?? 0})),bookingUrl:bookingUrl({...p,departDate:trip.DepartDate})});
 }
 return {flights,page:json.data.PageCurrent,pageCount:json.data.PageCount};
}
export default defineSkill({
 findAwards:fn({summary:"Single-date flight details with segment cabins, booking codes, seats and taxes.",input,examples:[{args:{origin:"SFO",destination:"NRT",departDate:"2026-12-01",cabin:"business",noMixedCabin:true}}],handler:async p=>({...normalizeFlights(await request(p,true),p),source:ENDPOINT.replace("FetchAwardCalendar","FetchFlights")})}),
 normalizeFlights:fn({summary:"Parse a captured FetchFlights JSON response.",input:z.object({data:z.any(),filters:input.partial().optional()}),handler:p=>normalizeFlights(p.data,p.filters)}),
 searchCalendar:fn({summary:'Monthly award calendar with miles and cash in the actual response currencies.',input:input.omit({nonstop:true,noMixedCabin:true,minSeats:true}),examples:[{args:{origin:'SFO',destination:'NRT',departDate:'2026-12-01',adults:2,cabin:'business'}}],handler:searchCalendar}),
 scanMonths:fn({summary:'Sequential calendar scans; returns monthly hits with the route and requested passenger count.',input:input.omit({departDate:true,nonstop:true,noMixedCabin:true,minSeats:true}).extend({months:z.array(z.string()),delayMs:z.number().nonnegative().optional()}),examples:[{args:{origin:'EWR',destination:'LHR',months:['2026-12','2027-01']}}],handler:async p=>{const months=[];for(const month of p.months){months.push({month,...await searchCalendar({...p,departDate:`${month}-15`})});if(p.delayMs)await new Promise(resolve=>setTimeout(resolve,p.delayMs));}return {months};}}),
 normalizeCalendar:fn({summary:'Parse a captured FetchAwardCalendar JSON response.',input:z.object({data:z.any(),filters:input.partial().optional()}),handler:p=>({hits:normalize(p.data,p.filters)})}),
 bookingUrl:fn({summary:'Open a United award search for the route, date and passengers.',input,handler:bookingUrl}),
},{instructions:'日历返回按日期和舱位的积分价格；现金部分保持接口币种。使用当前 united.com 会话，可从页面最近一次日历请求沿用参数。'});
