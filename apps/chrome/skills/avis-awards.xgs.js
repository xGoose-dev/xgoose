// ==XGooseSkill==
// @name        avis-awards
// @namespace   avis
// @version     0.1.0
// @description Avis car-rental price scanner across 621 bundled AWD codes plus user-supplied codes. Same-origin against avis.com /web/reservation/vehicles. Mirrors uscardforum #496996 / greasyfork 576502 (v2.2).
// @match       *://www.avis.com/*
// @detect      location.hostname === 'www.avis.com'
// @run-at      document_idle
// @connect     <self>
// @primary     scanPrices
// @keyword     avis
// @keyword     car rental
// @keyword     AWD
// @keyword     discount code
// @keyword     rental
// @keyword     AARP
// @keyword     COSTCO TRAVEL
// @keyword     FlyerTalk AWD
// @keyword     汽车租赁
// @keyword     租车折扣
// ==/XGooseSkill==

/**
 * Avis car-rental price scanner across 621 bundled AWD codes plus user-supplied codes. Same-origin against avis.com /web/reservation/vehicles. Mirrors uscardforum #496996 / greasyfork 576502 (v2.2).
 *
 * Migrated from webagent v0.1; runtime preserved verbatim. Per-fn input
 * schemas are intentionally widened to z.any() — refine with concrete Zod
 * schemas in a follow-up (see the original SKILL.md for parameter types).
 * # Avis AWD Price Scanner — Schema Reference
 * > **Read this BEFORE calling any function.** Every entrypoint takes a single options object. The skill loads on `www.avis.com` and POSTs same-origin with the user's session cookies (`credentials: 'include'`). The user must already be on a vehicle-availability page (URL contains `pickup_location_code=...`) — otherwise the skill needs the booking parameters passed in explicitly. Some bundled AWD codes are corporate/partner codes that Avis may reject at counter without ID, and some include forced CDW that can void the credit-card primary insurance. **Use the result for price discovery, not blanket booking.** See uscardforum #496996 for community discussion.
 * ## AWD code identifier
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const BUNDLED_AWD = [{ "code": "A017600", "company": "", "isCo": false }, { "code": "A017690", "company": "", "isCo": false }, { "code": "A047900", "company": "", "isCo": false }, { "code": "A059900", "company": "PETSMART INC.", "isCo": true }, { "code": "A072200", "company": "", "isCo": false }, { "code": "A074800", "company": "", "isCo": false }, { "code": "A074801", "company": "", "isCo": false }, { "code": "A0764800", "company": "", "isCo": false }, { "code": "A076600", "company": "", "isCo": false }, { "code": "A078400", "company": "", "isCo": false }, { "code": "A108300", "company": "COSTCO TRAVEL", "isCo": true }, { "code": "A108303", "company": "WAREHOUSE CATALOG (D)", "isCo": true }, { "code": "A108325", "company": "SPRING/SUMMER CATALOG 99 (D)", "isCo": true }, { "code": "A108326", "company": "COSTCO.COM (D)", "isCo": true }, { "code": "A108335", "company": "COSTCO CAR CARD (D)", "isCo": true }, { "code": "A108353", "company": "COSTCO.COM NEW (D)", "isCo": true }, { "code": "A108373", "company": "COSTCO CASH CARD", "isCo": true }, { "code": "A108379", "company": "CASH CARD LOCATIONS", "isCo": true }, { "code": "A108386", "company": "POS US TO EMEA", "isCo": true }, { "code": "A108393", "company": "DECEMBER MVM", "isCo": true }, { "code": "A108396", "company": "COSTCO JULY 2013 MVM", "isCo": true }, { "code": "A113400", "company": "STATE OF FLORIDA DEPT MGMT SV", "isCo": true }, { "code": "A114300", "company": "", "isCo": false }, { "code": "A126000", "company": "", "isCo": false }, { "code": "A126900", "company": "", "isCo": false }, { "code": "A139300", "company": "PFIZER", "isCo": true }, { "code": "A148890", "company": "", "isCo": false }, { "code": "A153700", "company": "", "isCo": false }, { "code": "A153710", "company": "", "isCo": false }, { "code": "A153720", "company": "", "isCo": false }, { "code": "A153722", "company": "", "isCo": false }, { "code": "A153799", "company": "", "isCo": false }, { "code": "A158500", "company": "", "isCo": false }, { "code": "A170100", "company": "", "isCo": false }, { "code": "A1772004", "company": "USAA VOICE CHANNEL", "isCo": true }, { "code": "A177204", "company": "USAA VOICE CHANNEL", "isCo": true }, { "code": "A177232", "company": "USAA PARTNER PAGE (D)", "isCo": true }, { "code": "A177250", "company": "USAA MOBILE SITE", "isCo": true }, { "code": "A177252", "company": "USAA PROMO UP TO 35% OFF", "isCo": true }, { "code": "A177253", "company": "USAA GAP OFFER", "isCo": true }, { "code": "A180300", "company": "", "isCo": false }, { "code": "A191000", "company": "UNITED PARCEL SERVICE", "isCo": true }, { "code": "A191009", "company": "UNITED PARCEL SERVICE - MURRAY", "isCo": true }, { "code": "A205700", "company": "", "isCo": false }, { "code": "A266700", "company": "HARVARD UNIVERSITY", "isCo": true }, { "code": "A271500", "company": "", "isCo": false }, { "code": "A275900", "company": "", "isCo": false }, { "code": "A282800", "company": "", "isCo": false }, { "code": "A288111", "company": "", "isCo": false }, { "code": "A298840", "company": "", "isCo": false }, { "code": "A298847", "company": "", "isCo": false }, { "code": "A304700", "company": "", "isCo": false }, { "code": "A304780", "company": "", "isCo": false }, { "code": "A333316", "company": "", "isCo": false }, { "code": "A359800", "company": "AARP/NRTA", "isCo": true }, { "code": "A359807", "company": "AARP.ORG", "isCo": true }, { "code": "A359811", "company": "AARP ONLINE PROMO", "isCo": true }, { "code": "A359866", "company": "AARP.ORG", "isCo": true }, { "code": "A382900", "company": "", "isCo": false }, { "code": "A398500", "company": "", "isCo": false }, { "code": "A415900", "company": "", "isCo": false }, { "code": "A415914", "company": "", "isCo": false }, { "code": "A432123", "company": "", "isCo": false }, { "code": "A433301", "company": "", "isCo": false }, { "code": "A440000", "company": "", "isCo": false }, { "code": "A442100", "company": "DELOITTE", "isCo": true }, { "code": "A444491", "company": "", "isCo": false }, { "code": "A451300", "company": "", "isCo": false }, { "code": "A451348", "company": "", "isCo": false }, { "code": "A460200", "company": "", "isCo": false }, { "code": "A469100", "company": "", "isCo": false }, { "code": "A487190", "company": "ARAMARK CORP ALP (D)", "isCo": true }, { "code": "A501100", "company": "", "isCo": false }, { "code": "A514190", "company": "STATE OF COLORADO ALP (D)", "isCo": true }, { "code": "A515100", "company": "HEWLETT-PACKARD ENTERPRISE", "isCo": true }, { "code": "A515190", "company": "HEWLETT PACKARD ENT ALP (D)", "isCo": true }, { "code": "A541254", "company": "", "isCo": false }, { "code": "A552300", "company": "", "isCo": false }, { "code": "A555084", "company": "", "isCo": false }, { "code": "A555095", "company": "", "isCo": false }, { "code": "A555100", "company": "", "isCo": false }, { "code": "A555500", "company": "", "isCo": false }, { "code": "A555501", "company": "", "isCo": false }, { "code": "A555502", "company": "", "isCo": false }, { "code": "A555513", "company": "", "isCo": false }, { "code": "A555590", "company": "", "isCo": false }, { "code": "A563100", "company": "", "isCo": false }, { "code": "A600000", "company": "", "isCo": false }, { "code": "A603800", "company": "CAPGEMINI AMERICA, INC.", "isCo": true }, { "code": "A606000", "company": "", "isCo": false }, { "code": "A606094", "company": "", "isCo": false }, { "code": "A631800", "company": "", "isCo": false }, { "code": "A637200", "company": "", "isCo": false }, { "code": "A637400", "company": "", "isCo": false }, { "code": "A648300", "company": "", "isCo": false }, { "code": "A668600", "company": "TEXTRON INC", "isCo": true }, { "code": "A674600", "company": "", "isCo": false }, { "code": "A679100", "company": "", "isCo": false }, { "code": "A6791000", "company": "", "isCo": false }, { "code": "A686200", "company": "", "isCo": false }, { "code": "A696600", "company": "", "isCo": false }, { "code": "A6966000", "company": "", "isCo": false }, { "code": "A699800", "company": "", "isCo": false }, { "code": "A708200", "company": "", "isCo": false }, { "code": "A730400", "company": "", "isCo": false }, { "code": "A733315", "company": "", "isCo": false }, { "code": "A735600", "company": "", "isCo": false }, { "code": "A756900", "company": "", "isCo": false }, { "code": "A7569000", "company": "", "isCo": false }, { "code": "A7895000", "company": "", "isCo": false }, { "code": "A791500", "company": "", "isCo": false }, { "code": "A822799", "company": "", "isCo": false }, { "code": "A872800", "company": "WASHINGTON UNIVERSITY", "isCo": true }, { "code": "A888812", "company": "", "isCo": false }, { "code": "A888813", "company": "", "isCo": false }, { "code": "A972200", "company": "", "isCo": false }, { "code": "A980000", "company": "", "isCo": false }, { "code": "A999900", "company": "", "isCo": false }, { "code": "A999901", "company": "", "isCo": false }, { "code": "A999902", "company": "", "isCo": false }, { "code": "B021600", "company": "", "isCo": false }, { "code": "B021615", "company": "", "isCo": false }, { "code": "B116009", "company": "", "isCo": false }, { "code": "B116099", "company": "", "isCo": false }, { "code": "B123600", "company": "AT&T SERVICES INC", "isCo": true }, { "code": "B136099", "company": "", "isCo": false }, { "code": "B149870", "company": "", "isCo": false }, { "code": "B169699", "company": "", "isCo": false }, { "code": "B204400", "company": "VISA U.S.A. INC.", "isCo": true }, { "code": "B254700", "company": "", "isCo": false }, { "code": "B257500", "company": "", "isCo": false }, { "code": "B270898", "company": "", "isCo": false }, { "code": "B292100", "company": "", "isCo": false }, { "code": "B323091", "company": "", "isCo": false }, { "code": "B335100", "company": "", "isCo": false }, { "code": "B381920", "company": "", "isCo": false }, { "code": "B401511", "company": "", "isCo": false }, { "code": "B405200", "company": "", "isCo": false }, { "code": "B406700", "company": "", "isCo": false }, { "code": "B406790", "company": "", "isCo": false }, { "code": "B444000", "company": "", "isCo": false }, { "code": "B449700", "company": "", "isCo": false }, { "code": "B469278", "company": "", "isCo": false }, { "code": "B505100", "company": "", "isCo": false }, { "code": "B638829", "company": "", "isCo": false }, { "code": "B723700", "company": "", "isCo": false }, { "code": "B723712", "company": "", "isCo": false }, { "code": "B769704", "company": "", "isCo": false }, { "code": "B771000", "company": "", "isCo": false }, { "code": "B7710000", "company": "", "isCo": false }, { "code": "B790000", "company": "", "isCo": false }, { "code": "B790073", "company": "", "isCo": false }, { "code": "B790082", "company": "", "isCo": false }, { "code": "B868700", "company": "", "isCo": false }, { "code": "B869232", "company": "", "isCo": false }, { "code": "B900000", "company": "", "isCo": false }, { "code": "B908200", "company": "", "isCo": false }, { "code": "B920508", "company": "RTX CORPORATE(D)", "isCo": true }, { "code": "B920513", "company": "RTX FLAT ONE WAY (D)", "isCo": true }, { "code": "B935200", "company": "", "isCo": false }, { "code": "B935221", "company": "", "isCo": false }, { "code": "B973000", "company": "", "isCo": false }, { "code": "B999000", "company": "", "isCo": false }, { "code": "B999900", "company": "", "isCo": false }, { "code": "B9999000", "company": "", "isCo": false }, { "code": "C005100", "company": "", "isCo": false }, { "code": "C005180", "company": "", "isCo": false }, { "code": "C025558", "company": "", "isCo": false }, { "code": "C031529", "company": "", "isCo": false }, { "code": "C062090", "company": "BOMBARDIER INC. ALP (D)", "isCo": true }, { "code": "C066983", "company": "", "isCo": false }, { "code": "C070127", "company": "", "isCo": false }, { "code": "C076700", "company": "", "isCo": false }, { "code": "C078400", "company": "", "isCo": false }, { "code": "C105600", "company": "", "isCo": false }, { "code": "C136400", "company": "", "isCo": false }, { "code": "C144800", "company": "", "isCo": false }, { "code": "C229100", "company": "", "isCo": false }, { "code": "C280613", "company": "", "isCo": false }, { "code": "C289800", "company": "", "isCo": false }, { "code": "C302100", "company": "", "isCo": false }, { "code": "C326000", "company": "", "isCo": false }, { "code": "C327201", "company": "", "isCo": false }, { "code": "C327300", "company": "", "isCo": false }, { "code": "C327301", "company": "", "isCo": false }, { "code": "C327302", "company": "", "isCo": false }, { "code": "C356672", "company": "", "isCo": false }, { "code": "C360418", "company": "", "isCo": false }, { "code": "C682300", "company": "", "isCo": false }, { "code": "C682368", "company": "", "isCo": false }, { "code": "C846790", "company": "BELL CANADA ENTERPRISES ALP", "isCo": true }, { "code": "C857500", "company": "COSTCO CDA MEMBERSHIP ASSOCIAT", "isCo": true }, { "code": "C857501", "company": "XL-COSTCO CDA REGULAR MEMBERS", "isCo": true }, { "code": "C857541", "company": "COSTCO.CA NEW", "isCo": true }, { "code": "D0005297", "company": "", "isCo": false }, { "code": "D0005927", "company": "", "isCo": false }, { "code": "D0008400", "company": "", "isCo": false }, { "code": "D002807", "company": "", "isCo": false }, { "code": "D004951", "company": "", "isCo": false }, { "code": "D005150", "company": "", "isCo": false }, { "code": "D0052091", "company": "", "isCo": false }, { "code": "D005261", "company": "", "isCo": false }, { "code": "D005279", "company": "", "isCo": false }, { "code": "D005291", "company": "", "isCo": false }, { "code": "D005295", "company": "", "isCo": false }, { "code": "D005297", "company": "", "isCo": false }, { "code": "D005298", "company": "", "isCo": false }, { "code": "D005591", "company": "", "isCo": false }, { "code": "D005620", "company": "", "isCo": false }, { "code": "D0059027", "company": "", "isCo": false }, { "code": "D005927", "company": "", "isCo": false }, { "code": "D008400", "company": "", "isCo": false }, { "code": "D0084000", "company": "", "isCo": false }, { "code": "D008490", "company": "", "isCo": false }, { "code": "D086532", "company": "", "isCo": false }, { "code": "D086533", "company": "", "isCo": false }, { "code": "D086553", "company": "", "isCo": false }, { "code": "D086689", "company": "", "isCo": false }, { "code": "D087633", "company": "", "isCo": false }, { "code": "D103900", "company": "", "isCo": false }, { "code": "D130903", "company": "", "isCo": false }, { "code": "D134100", "company": "", "isCo": false }, { "code": "D302003", "company": "", "isCo": false }, { "code": "D331000", "company": "", "isCo": false }, { "code": "D392900", "company": "", "isCo": false }, { "code": "D433300", "company": "", "isCo": false }, { "code": "D436100", "company": "", "isCo": false }, { "code": "D444600", "company": "", "isCo": false }, { "code": "D453800", "company": "", "isCo": false }, { "code": "D454000", "company": "", "isCo": false }, { "code": "D454006", "company": "", "isCo": false }, { "code": "D459000", "company": "", "isCo": false }, { "code": "D468800", "company": "", "isCo": false }, { "code": "D472600", "company": "", "isCo": false }, { "code": "D486600", "company": "", "isCo": false }, { "code": "D487000", "company": "", "isCo": false }, { "code": "D488900", "company": "", "isCo": false }, { "code": "D490100", "company": "SALESFORCE", "isCo": true }, { "code": "D496201", "company": "", "isCo": false }, { "code": "D702700", "company": "", "isCo": false }, { "code": "D730300", "company": "", "isCo": false }, { "code": "D732700", "company": "", "isCo": false }, { "code": "D752500", "company": "", "isCo": false }, { "code": "D802300", "company": "", "isCo": false }, { "code": "D833357", "company": "", "isCo": false }, { "code": "D866300", "company": "", "isCo": false }, { "code": "D900888", "company": "", "isCo": false }, { "code": "D923800", "company": "", "isCo": false }, { "code": "D935900", "company": "", "isCo": false }, { "code": "D972200", "company": "", "isCo": false }, { "code": "E027237", "company": "", "isCo": false }, { "code": "E034800", "company": "", "isCo": false }, { "code": "E034803", "company": "", "isCo": false }, { "code": "E034815", "company": "", "isCo": false }, { "code": "E153702", "company": "", "isCo": false }, { "code": "E400000", "company": "", "isCo": false }, { "code": "E400024", "company": "", "isCo": false }, { "code": "E806868", "company": "", "isCo": false }, { "code": "E838102", "company": "", "isCo": false }, { "code": "E838111", "company": "", "isCo": false }, { "code": "E838118", "company": "", "isCo": false }, { "code": "E838122", "company": "", "isCo": false }, { "code": "E888804", "company": "", "isCo": false }, { "code": "E888810", "company": "", "isCo": false }, { "code": "F982700", "company": "", "isCo": false }, { "code": "F982900", "company": "", "isCo": false }, { "code": "F983000", "company": "", "isCo": false }, { "code": "F999303", "company": "", "isCo": false }, { "code": "F999720", "company": "", "isCo": false }, { "code": "G009000", "company": "", "isCo": false }, { "code": "G028900", "company": "", "isCo": false }, { "code": "G298100", "company": "", "isCo": false }, { "code": "G417400", "company": "", "isCo": false }, { "code": "G417900", "company": "", "isCo": false }, { "code": "G540700", "company": "", "isCo": false }, { "code": "G600004", "company": "", "isCo": false }, { "code": "G624400", "company": "MD7", "isCo": true }, { "code": "G639300", "company": "", "isCo": false }, { "code": "G833700", "company": "", "isCo": false }, { "code": "G833800", "company": "", "isCo": false }, { "code": "G883000", "company": "", "isCo": false }, { "code": "G930700", "company": "IBM INC", "isCo": true }, { "code": "H017208", "company": "", "isCo": false }, { "code": "H020580", "company": "", "isCo": false }, { "code": "H055100", "company": "", "isCo": false }, { "code": "H228200", "company": "", "isCo": false }, { "code": "H349300", "company": "", "isCo": false }, { "code": "H749900", "company": "", "isCo": false }, { "code": "H774000", "company": "", "isCo": false }, { "code": "H811101", "company": "", "isCo": false }, { "code": "H811102", "company": "", "isCo": false }, { "code": "H854900", "company": "", "isCo": false }, { "code": "H855900", "company": "", "isCo": false }, { "code": "H876000", "company": "", "isCo": false }, { "code": "H876503", "company": "", "isCo": false }, { "code": "H877100", "company": "", "isCo": false }, { "code": "J046300", "company": "", "isCo": false }, { "code": "J096489", "company": "", "isCo": false }, { "code": "J097790", "company": "", "isCo": false }, { "code": "J098440", "company": "", "isCo": false }, { "code": "J312300", "company": "", "isCo": false }, { "code": "J323400", "company": "", "isCo": false }, { "code": "J464700", "company": "", "isCo": false }, { "code": "J626300", "company": "", "isCo": false }, { "code": "J659136", "company": "", "isCo": false }, { "code": "J818577", "company": "", "isCo": false }, { "code": "J866489", "company": "", "isCo": false }, { "code": "J867208", "company": "", "isCo": false }, { "code": "J868025", "company": "", "isCo": false }, { "code": "J868801", "company": "", "isCo": false }, { "code": "J881604", "company": "", "isCo": false }, { "code": "J906658", "company": "", "isCo": false }, { "code": "J907644", "company": "", "isCo": false }, { "code": "J933700", "company": "", "isCo": false }, { "code": "J946780", "company": "", "isCo": false }, { "code": "J953708", "company": "", "isCo": false }, { "code": "J991952", "company": "", "isCo": false }, { "code": "J993619", "company": "", "isCo": false }, { "code": "J993686", "company": "", "isCo": false }, { "code": "J998516", "company": "", "isCo": false }, { "code": "K006790", "company": "YAHOO ALP(D)", "isCo": true }, { "code": "K019300", "company": "", "isCo": false }, { "code": "K019370", "company": "", "isCo": false }, { "code": "K019375", "company": "", "isCo": false }, { "code": "K020500", "company": "", "isCo": false }, { "code": "K024300", "company": "", "isCo": false }, { "code": "K024400", "company": "", "isCo": false }, { "code": "K024439", "company": "", "isCo": false }, { "code": "K024700", "company": "", "isCo": false }, { "code": "K024701", "company": "", "isCo": false }, { "code": "K024705", "company": "", "isCo": false }, { "code": "K024713", "company": "", "isCo": false }, { "code": "K115600", "company": "", "isCo": false }, { "code": "K1156000", "company": "", "isCo": false }, { "code": "K163324", "company": "", "isCo": false }, { "code": "K197800", "company": "", "isCo": false }, { "code": "K197825", "company": "", "isCo": false }, { "code": "K199005", "company": "", "isCo": false }, { "code": "K199060", "company": "", "isCo": false }, { "code": "K202100", "company": "", "isCo": false }, { "code": "K214028", "company": "", "isCo": false }, { "code": "K250544", "company": "", "isCo": false }, { "code": "K255700", "company": "", "isCo": false }, { "code": "K305600", "company": "", "isCo": false }, { "code": "K305700", "company": "", "isCo": false }, { "code": "K305800", "company": "", "isCo": false }, { "code": "K306000", "company": "", "isCo": false }, { "code": "K312601", "company": "", "isCo": false }, { "code": "K319300", "company": "", "isCo": false }, { "code": "K353927", "company": "", "isCo": false }, { "code": "K444404", "company": "", "isCo": false }, { "code": "K444413", "company": "", "isCo": false }, { "code": "K444414", "company": "", "isCo": false }, { "code": "K448125", "company": "", "isCo": false }, { "code": "K462601", "company": "", "isCo": false }, { "code": "K488100", "company": "", "isCo": false }, { "code": "K501300", "company": "", "isCo": false }, { "code": "K5188000", "company": "", "isCo": false }, { "code": "K563500", "company": "", "isCo": false }, { "code": "K666403", "company": "", "isCo": false }, { "code": "K747902", "company": "", "isCo": false }, { "code": "K774100", "company": "", "isCo": false }, { "code": "K816401", "company": "", "isCo": false }, { "code": "K817100", "company": "", "isCo": false }, { "code": "K817125", "company": "", "isCo": false }, { "code": "K817165", "company": "", "isCo": false }, { "code": "K817200", "company": "", "isCo": false }, { "code": "K817421", "company": "", "isCo": false }, { "code": "K817600", "company": "", "isCo": false }, { "code": "K817625", "company": "", "isCo": false }, { "code": "K817700", "company": "", "isCo": false }, { "code": "K850100", "company": "", "isCo": false }, { "code": "K850800", "company": "", "isCo": false }, { "code": "K851000", "company": "", "isCo": false }, { "code": "K860600", "company": "", "isCo": false }, { "code": "K933001", "company": "", "isCo": false }, { "code": "L093590", "company": "", "isCo": false }, { "code": "L123443", "company": "", "isCo": false }, { "code": "L149332", "company": "", "isCo": false }, { "code": "L237904", "company": "", "isCo": false }, { "code": "L240430", "company": "", "isCo": false }, { "code": "L282800", "company": "", "isCo": false }, { "code": "L298400", "company": "", "isCo": false }, { "code": "L332364", "company": "", "isCo": false }, { "code": "L358190", "company": "", "isCo": false }, { "code": "L463685", "company": "", "isCo": false }, { "code": "L556800", "company": "", "isCo": false }, { "code": "L628000", "company": "", "isCo": false }, { "code": "L628400", "company": "", "isCo": false }, { "code": "M401401", "company": "", "isCo": false }, { "code": "M401402", "company": "", "isCo": false }, { "code": "M401403", "company": "", "isCo": false }, { "code": "M401404", "company": "", "isCo": false }, { "code": "M646600", "company": "", "isCo": false }, { "code": "N070001", "company": "", "isCo": false }, { "code": "N085400", "company": "", "isCo": false }, { "code": "N086300", "company": "", "isCo": false }, { "code": "N711304", "company": "", "isCo": false }, { "code": "N743700", "company": "", "isCo": false }, { "code": "N744100", "company": "", "isCo": false }, { "code": "N744200", "company": "", "isCo": false }, { "code": "N744300", "company": "", "isCo": false }, { "code": "N744400", "company": "", "isCo": false }, { "code": "N744410", "company": "", "isCo": false }, { "code": "N744440", "company": "", "isCo": false }, { "code": "N744900", "company": "", "isCo": false }, { "code": "O094710", "company": "", "isCo": false }, { "code": "O253100", "company": "", "isCo": false }, { "code": "O253300", "company": "", "isCo": false }, { "code": "O377103", "company": "", "isCo": false }, { "code": "O377111", "company": "", "isCo": false }, { "code": "O377168", "company": "", "isCo": false }, { "code": "O387100", "company": "", "isCo": false }, { "code": "O568200", "company": "", "isCo": false }, { "code": "O705700", "company": "", "isCo": false }, { "code": "O705800", "company": "", "isCo": false }, { "code": "O706000", "company": "", "isCo": false }, { "code": "O706200", "company": "", "isCo": false }, { "code": "O706300", "company": "", "isCo": false }, { "code": "O714611", "company": "", "isCo": false }, { "code": "O855700", "company": "", "isCo": false }, { "code": "O855800", "company": "", "isCo": false }, { "code": "O855801", "company": "", "isCo": false }, { "code": "O855900", "company": "", "isCo": false }, { "code": "P188000", "company": "", "isCo": false }, { "code": "P203701", "company": "", "isCo": false }, { "code": "P2201035", "company": "", "isCo": false }, { "code": "P220135", "company": "", "isCo": false }, { "code": "P223200", "company": "", "isCo": false }, { "code": "P271899", "company": "", "isCo": false }, { "code": "P382630", "company": "", "isCo": false }, { "code": "P400000", "company": "", "isCo": false }, { "code": "P4000000", "company": "", "isCo": false }, { "code": "P468600", "company": "", "isCo": false }, { "code": "P469100", "company": "", "isCo": false }, { "code": "P469101", "company": "", "isCo": false }, { "code": "P682400", "company": "", "isCo": false }, { "code": "P6824002", "company": "", "isCo": false }, { "code": "P682402", "company": "", "isCo": false }, { "code": "P725600", "company": "", "isCo": false }, { "code": "P768700", "company": "", "isCo": false }, { "code": "P786700", "company": "", "isCo": false }, { "code": "Q014978", "company": "", "isCo": false }, { "code": "Q177800", "company": "", "isCo": false }, { "code": "Q180430", "company": "", "isCo": false }, { "code": "Q273400", "company": "", "isCo": false }, { "code": "Q280100", "company": "", "isCo": false }, { "code": "Q304401", "company": "", "isCo": false }, { "code": "Q3197067", "company": "", "isCo": false }, { "code": "Q319767", "company": "", "isCo": false }, { "code": "Q324386", "company": "", "isCo": false }, { "code": "Q336600", "company": "", "isCo": false }, { "code": "Q339400", "company": "", "isCo": false }, { "code": "S018500", "company": "", "isCo": false }, { "code": "S032500", "company": "", "isCo": false }, { "code": "S046600", "company": "", "isCo": false }, { "code": "S056700", "company": "", "isCo": false }, { "code": "S057600", "company": "", "isCo": false }, { "code": "S199400", "company": "", "isCo": false }, { "code": "S320500", "company": "BOEING COMPANY", "isCo": true }, { "code": "S333701", "company": "", "isCo": false }, { "code": "S607800", "company": "", "isCo": false }, { "code": "S654600", "company": "", "isCo": false }, { "code": "S692200", "company": "", "isCo": false }, { "code": "S705900", "company": "", "isCo": false }, { "code": "S728000", "company": "", "isCo": false }, { "code": "S754600", "company": "", "isCo": false }, { "code": "S767700", "company": "", "isCo": false }, { "code": "S780700", "company": "", "isCo": false }, { "code": "S789500", "company": "", "isCo": false }, { "code": "S829900", "company": "", "isCo": false }, { "code": "T111949", "company": "", "isCo": false }, { "code": "T237599", "company": "", "isCo": false }, { "code": "T314299", "company": "", "isCo": false }, { "code": "T432662", "company": "", "isCo": false }, { "code": "T706699", "company": "", "isCo": false }, { "code": "T757205", "company": "", "isCo": false }, { "code": "T765700", "company": "WESALUTE", "isCo": true }, { "code": "T788599", "company": "", "isCo": false }, { "code": "T844211", "company": "", "isCo": false }, { "code": "T910400", "company": "", "isCo": false }, { "code": "U194783", "company": "", "isCo": false }, { "code": "U405347", "company": "", "isCo": false }, { "code": "U497593", "company": "", "isCo": false }, { "code": "U606753", "company": "", "isCo": false }, { "code": "U704363", "company": "", "isCo": false }, { "code": "U840893", "company": "", "isCo": false }, { "code": "U861800", "company": "", "isCo": false }, { "code": "U8792001", "company": "", "isCo": false }, { "code": "U915590", "company": "", "isCo": false }, { "code": "V125600", "company": "", "isCo": false }, { "code": "V206061", "company": "", "isCo": false }, { "code": "V531165", "company": "", "isCo": false }, { "code": "V655435", "company": "", "isCo": false }, { "code": "W000400", "company": "", "isCo": false }, { "code": "W0911098", "company": "", "isCo": false }, { "code": "W2091198", "company": "", "isCo": false }, { "code": "W222853", "company": "", "isCo": false }, { "code": "W300012", "company": "", "isCo": false }, { "code": "W300013", "company": "", "isCo": false }, { "code": "W3194021", "company": "", "isCo": false }, { "code": "W319421", "company": "", "isCo": false }, { "code": "W329700", "company": "", "isCo": false }, { "code": "W550714", "company": "", "isCo": false }, { "code": "W661100", "company": "", "isCo": false }, { "code": "W662100", "company": "", "isCo": false }, { "code": "W819200", "company": "", "isCo": false }, { "code": "W925817", "company": "", "isCo": false }, { "code": "W925828", "company": "", "isCo": false }, { "code": "W925880", "company": "", "isCo": false }, { "code": "X018184", "company": "", "isCo": false }, { "code": "X025800", "company": "", "isCo": false }, { "code": "X048301", "company": "", "isCo": false }, { "code": "X0602000", "company": "", "isCo": false }, { "code": "X133557", "company": "", "isCo": false }, { "code": "X147801", "company": "", "isCo": false }, { "code": "X154043", "company": "", "isCo": false }, { "code": "X212600", "company": "", "isCo": false }, { "code": "X352100", "company": "", "isCo": false }, { "code": "X400270", "company": "", "isCo": false }, { "code": "X416929", "company": "", "isCo": false }, { "code": "X420076", "company": "", "isCo": false }, { "code": "X444436", "company": "", "isCo": false }, { "code": "X474200", "company": "", "isCo": false }, { "code": "X602000", "company": "", "isCo": false }, { "code": "X602090", "company": "", "isCo": false }, { "code": "X612849", "company": "", "isCo": false }, { "code": "X762674", "company": "", "isCo": false }, { "code": "X801848", "company": "", "isCo": false }, { "code": "X846850", "company": "", "isCo": false }, { "code": "X848306", "company": "", "isCo": false }, { "code": "X966353", "company": "", "isCo": false }, { "code": "X992288", "company": "", "isCo": false }, { "code": "Y126501", "company": "", "isCo": false }, { "code": "Y126506", "company": "", "isCo": false }, { "code": "Y257236", "company": "", "isCo": false }, { "code": "Y341767", "company": "", "isCo": false }, { "code": "Y346538", "company": "", "isCo": false }, { "code": "Y490870", "company": "", "isCo": false }, { "code": "Z001181", "company": "", "isCo": false }, { "code": "Z007789", "company": "", "isCo": false }, { "code": "Z047500", "company": "", "isCo": false }, { "code": "Z048005", "company": "", "isCo": false }, { "code": "Z063929", "company": "", "isCo": false }, { "code": "Z162842", "company": "", "isCo": false }, { "code": "Z251177", "company": "", "isCo": false }, { "code": "Z284372", "company": "", "isCo": false }, { "code": "Z305719", "company": "", "isCo": false }, { "code": "Z333300", "company": "", "isCo": false }, { "code": "Z364310", "company": "", "isCo": false }, { "code": "Z387740", "company": "", "isCo": false }, { "code": "Z413606", "company": "", "isCo": false }, { "code": "Z4589019", "company": "", "isCo": false }, { "code": "Z482798", "company": "", "isCo": false }, { "code": "Z549275", "company": "", "isCo": false }, { "code": "Z638700", "company": "", "isCo": false }, { "code": "Z639873", "company": "", "isCo": false }, { "code": "Z652297", "company": "", "isCo": false }, { "code": "Z784187", "company": "", "isCo": false }, { "code": "Z870001", "company": "", "isCo": false }, { "code": "Z921610", "company": "", "isCo": false }, { "code": "Z994400", "company": "", "isCo": false }, { "code": "M111900", "company": "", "isCo": false }, { "code": "N218301", "company": "", "isCo": false }, { "code": "N218302", "company": "", "isCo": false }, { "code": "N218303", "company": "", "isCo": false }, { "code": "D189700", "company": "", "isCo": false }, { "code": "D189800", "company": "", "isCo": false }, { "code": "D189900", "company": "", "isCo": false }, { "code": "P999000", "company": "", "isCo": false }, { "code": "F982800", "company": "", "isCo": false }, { "code": "F982600", "company": "", "isCo": false }, { "code": "K817118", "company": "", "isCo": false }, { "code": "J093000", "company": "", "isCo": false }, { "code": "J093100", "company": "", "isCo": false }, { "code": "S761000", "company": "", "isCo": false }, { "code": "S213800", "company": "", "isCo": false }, { "code": "M613600", "company": "", "isCo": false }, { "code": "N047500", "company": "", "isCo": false }, { "code": "O388700", "company": "", "isCo": false }, { "code": "M613700", "company": "", "isCo": false }, { "code": "W029300", "company": "", "isCo": false }, { "code": "C076800", "company": "", "isCo": false }, { "code": "R304300", "company": "", "isCo": false }, { "code": "N749700", "company": "", "isCo": false }, { "code": "N750400", "company": "", "isCo": false }, { "code": "N749800", "company": "", "isCo": false }, { "code": "N750600", "company": "", "isCo": false }, { "code": "Y328000", "company": "", "isCo": false }, { "code": "L162300", "company": "", "isCo": false }, { "code": "N852701", "company": "", "isCo": false }, { "code": "J000500", "company": "", "isCo": false }, { "code": "J000600", "company": "", "isCo": false }, { "code": "H798500", "company": "", "isCo": false }, { "code": "O568400", "company": "", "isCo": false }, { "code": "O568500", "company": "", "isCo": false }, { "code": "O568600", "company": "", "isCo": false }, { "code": "K317300", "company": "", "isCo": false }, { "code": "N014600", "company": "", "isCo": false }, { "code": "N521100", "company": "", "isCo": false }, { "code": "M619100", "company": "", "isCo": false }, { "code": "O697100", "company": "", "isCo": false }, { "code": "K079300", "company": "", "isCo": false }, { "code": "U890601", "company": "", "isCo": false }, { "code": "U890602", "company": "", "isCo": false }, { "code": "U890603", "company": "", "isCo": false }, { "code": "X258000", "company": "", "isCo": false }, { "code": "X126900", "company": "", "isCo": false }, { "code": "X130700", "company": "", "isCo": false }, { "code": "X135900", "company": "", "isCo": false }, { "code": "K376500", "company": "", "isCo": false }, { "code": "X753100", "company": "", "isCo": false }, { "code": "X753500", "company": "", "isCo": false }, { "code": "X753700", "company": "", "isCo": false }, { "code": "X753900", "company": "", "isCo": false }, { "code": "Y795000", "company": "", "isCo": false }, { "code": "E191400", "company": "", "isCo": false }, { "code": "E059801", "company": "", "isCo": false }, { "code": "E059802", "company": "", "isCo": false }, { "code": "N645801", "company": "", "isCo": false }, { "code": "W645601", "company": "", "isCo": false }];
function bundledAwdCodes() {
  return BUNDLED_AWD.slice();
}
__name(bundledAwdCodes, "bundledAwdCodes");
function pad2(n) {
  const s = String(n);
  return s.length === 1 ? "0" + s : s;
}
__name(pad2, "pad2");
function parseBookingFromUrl() {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const p = new URLSearchParams(window.location.search);
  const pickup = p.get("pickup_location_code");
  if (!pickup) return null;
  return {
    pickupLocation: pickup,
    dropoffLocation: p.get("return_location_code") || pickup,
    pickupDate: `${p.get("pickup_year")}-${pad2(p.get("pickup_month") || 1)}-${pad2(p.get("pickup_day") || 1)}`,
    pickupTime: `${pad2(p.get("pickup_hour") || 10)}:${pad2(p.get("pickup_minute") || 0)}`,
    dropoffDate: `${p.get("return_year")}-${pad2(p.get("return_month") || 1)}-${pad2(p.get("return_day") || 1)}`,
    dropoffTime: `${pad2(p.get("return_hour") || 10)}:${pad2(p.get("return_minute") || 0)}`,
    age: parseInt(p.get("age") || "25", 10) || 25,
    countryOfResidence: p.get("residency_value") || "US"
  };
}
__name(parseBookingFromUrl, "parseBookingFromUrl");
function resolveBooking(opts) {
  if (opts.parseFromUrl !== false) {
    const fromUrl = parseBookingFromUrl();
    if (fromUrl) return fromUrl;
  }
  return opts.booking ?? null;
}
__name(resolveBooking, "resolveBooking");
function uuidV4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
__name(uuidV4, "uuidV4");
async function rawFetch(booking, awdCode) {
  const sp = new URLSearchParams({
    "context.locale": "en-US",
    "context.domainCountry": "US",
    "context.correlationIdentifier": uuidV4(),
    device: "WEB"
  });
  const body = {
    pickupLocation: booking.pickupLocation,
    dropoffLocation: booking.dropoffLocation,
    pickupDate: booking.pickupDate,
    pickupTime: booking.pickupTime,
    dropoffDate: booking.dropoffDate,
    dropoffTime: booking.dropoffTime,
    age: booking.age ?? 25,
    discountCodes: [{ type: "PARTNER", value: awdCode }],
    priceView: "AWD_CODE",
    countryOfResidence: booking.countryOfResidence ?? "US"
  };
  const r = await fetch(`https://www.avis.com/web/reservation/vehicles?${sp.toString()}`, {
    method: "POST",
    credentials: "include",
    cache: "no-cache",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "accept-language": "en-US"
    },
    body: JSON.stringify(body)
  });
  if (r.status === 403 || r.status === 429) {
    return { status: "rate_limited", httpStatus: r.status };
  }
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    const text = (await r.text()).slice(0, 800);
    if (/captcha|access denied|hold-and-prove/i.test(text)) {
      return { status: "captcha_required", httpStatus: r.status };
    }
    return { status: "http_error", httpStatus: r.status, data: { textPreview: text } };
  }
  if (!r.ok) {
    return { status: "http_error", httpStatus: r.status };
  }
  return { status: "ok", data: await r.json() };
}
__name(rawFetch, "rawFetch");
function processVehicles(data) {
  const out = {};
  for (const v of data?.vehicles ?? []) {
    if (v?.vehicleAvailability !== "AVAILABLE" || !v.lowestPrice) continue;
    const total = parseFloat(String(v.lowestPrice));
    if (!Number.isFinite(total)) continue;
    const perDayRaw = v.price?.[0]?.perDayPrice;
    const currency = v.price?.[0]?.currency ?? "USD";
    out[v.vehicleCode] = {
      vehicleCode: v.vehicleCode,
      vehicleType: v.vehicleType ?? "",
      model: v.description ?? v.vehicleModel ?? "",
      totalPrice: total,
      perDayPrice: perDayRaw != null ? parseFloat(String(perDayRaw)) : null,
      currency
    };
  }
  return out;
}
__name(processVehicles, "processVehicles");
function jitter(ms) {
  return ms + Math.random() * ms * 0.4;
}
__name(jitter, "jitter");
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
__name(sleep, "sleep");
const CACHE_PREFIX = "awd-scan-";
function cacheKey(b) {
  return `${CACHE_PREFIX}${b.pickupLocation}|${b.dropoffLocation}|${b.pickupDate}|${b.dropoffDate}`;
}
__name(cacheKey, "cacheKey");
function saveCache(booking, rows, vehicleClasses) {
  if (typeof localStorage === "undefined") return;
  const payload = JSON.stringify({ ts: Date.now(), booking, rows, vehicleClasses });
  localStorage.setItem(cacheKey(booking), payload);
}
__name(saveCache, "saveCache");
function loadCachedScan(p) {
  if (!p?.pickupLocation || !p?.dropoffLocation || !p?.pickupDate || !p?.dropoffDate) {
    throw new Error("avis-awards.loadCachedScan: pass {pickupLocation, dropoffLocation, pickupDate, dropoffDate}");
  }
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(cacheKey(p));
  if (!raw) return null;
  const obj = JSON.parse(raw);
  return {
    ts: obj.ts,
    ageMs: Date.now() - obj.ts,
    booking: obj.booking,
    rows: obj.rows ?? [],
    vehicleClasses: obj.vehicleClasses ?? []
  };
}
__name(loadCachedScan, "loadCachedScan");
function buildCodeList(p) {
  if (p.awdCodes?.length) {
    return p.awdCodes.map((code) => {
      const known = BUNDLED_AWD.find((e) => e.code === code);
      return known ?? { code, company: "(custom)", isCo: false };
    });
  }
  let base;
  switch (p.filter ?? "all") {
    case "co":
      base = BUNDLED_AWD.filter((e) => e.isCo);
      break;
    case "non-co":
      base = BUNDLED_AWD.filter((e) => !e.isCo);
      break;
    default:
      base = BUNDLED_AWD.slice();
  }
  if (p.extraCodes?.length) {
    const seen = new Set(base.map((e) => e.code));
    for (const code of p.extraCodes) {
      if (!seen.has(code)) {
        base.push({ code, company: "(custom)", isCo: false });
        seen.add(code);
      }
    }
  }
  return base;
}
__name(buildCodeList, "buildCodeList");
async function searchSinglePrice(p) {
  if (!p?.awdCode) throw new Error("avis-awards.searchSinglePrice: `awdCode` is required");
  const booking = resolveBooking(p);
  if (!booking) {
    throw new Error("avis-awards.searchSinglePrice: pass `booking` or open a vehicle-availability page so the URL has pickup_location_code");
  }
  const r = await rawFetch(booking, p.awdCode);
  if (r.status === "rate_limited") return { status: "rate_limited", awdCode: p.awdCode, vehicles: {} };
  if (r.status === "captcha_required") return { status: "captcha_required", awdCode: p.awdCode, vehicles: {} };
  if (r.status === "http_error") return { status: "no_availability", awdCode: p.awdCode, vehicles: {}, raw: r.data };
  const vehicles = processVehicles(r.data);
  return {
    status: Object.keys(vehicles).length ? "ok" : "no_availability",
    awdCode: p.awdCode,
    vehicles,
    raw: r.data
  };
}
__name(searchSinglePrice, "searchSinglePrice");
async function scanPrices(p = {}) {
  const booking = resolveBooking(p);
  if (!booking) {
    return {
      status: "no_booking_context",
      rows: [],
      failedCodes: [],
      scanned: 0,
      vehicleClasses: [],
      booking: {
        pickupLocation: "",
        dropoffLocation: "",
        pickupDate: "",
        pickupTime: "",
        dropoffDate: "",
        dropoffTime: ""
      }
    };
  }
  const codes = buildCodeList(p);
  const delayMs = Math.max(50, p.delayMs ?? 500);
  const threshold = Math.max(1, p.rateLimitThreshold ?? 3);
  const rows = [];
  const failedCodes = [];
  const seenClasses = /* @__PURE__ */ new Map();
  let consecutiveErrors = 0;
  let status = "ok";
  for (let i = 0; i < codes.length; i++) {
    if (p.signal?.aborted) break;
    const entry = codes[i];
    const r = await rawFetch(booking, entry.code);
    if (r.status === "captcha_required") {
      status = "captcha_required";
      failedCodes.push(entry.code);
      break;
    }
    if (r.status === "rate_limited" || r.status === "http_error") {
      failedCodes.push(entry.code);
      consecutiveErrors++;
      if (consecutiveErrors >= threshold) {
        status = "rate_limited";
        break;
      }
    } else {
      consecutiveErrors = 0;
      const vehicles = processVehicles(r.data);
      if (Object.keys(vehicles).length) {
        rows.push({ awdCode: entry.code, company: entry.company, isCo: entry.isCo, vehicles });
        for (const v of Object.values(vehicles)) {
          if (!seenClasses.has(v.vehicleCode)) {
            seenClasses.set(v.vehicleCode, { code: v.vehicleCode, type: v.vehicleType, model: v.model });
          }
        }
      }
    }
    if (i < codes.length - 1) await sleep(jitter(delayMs));
  }
  const vehicleClasses = Array.from(seenClasses.values());
  saveCache(booking, rows, vehicleClasses);
  return { status, rows, failedCodes, scanned: codes.length, vehicleClasses, booking };
}
__name(scanPrices, "scanPrices");

export default defineSkill({
  bundledAwdCodes: fn({
    summary: "621 hand-curated codes from FT + Avis partners.",
    input: z.any().optional(),
    handler: async (params) => bundledAwdCodes(params),
  }),
  loadCachedScan: fn({
    summary: "localStorage cache (matches user-script key scheme).",
    input: z.any().optional(),
    handler: async (params) => loadCachedScan(params),
  }),
  scanPrices: fn({
    summary: "★ main entry. 1-shot scan across many AWD codes.",
    input: z.any().optional(),
    handler: async (params) => scanPrices(params),
  }),
  searchSinglePrice: fn({
    summary: "one quote for one AWD code.",
    input: z.any().optional(),
    handler: async (params) => searchSinglePrice(params),
  }),
});

