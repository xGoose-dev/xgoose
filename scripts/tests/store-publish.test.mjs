import test from 'node:test';
import assert from 'node:assert/strict';
import {submitStore} from '../store-publish.mjs';
const edge={EDGE_CLIENT_ID:'fixture-client',EDGE_API_KEY:'fixture-key',EDGE_PRODUCT_ID:'fixture-product'};
test('missing credentials do not upload a package',async()=>{
 let calls=0;await assert.rejects(submitStore({store:'edge',zip:Buffer.from('zip'),credentials:{},fetchImpl:()=>{calls++;}}),/Missing EDGE_CLIENT_ID/);assert.equal(calls,0);
});
test('Edge uploads once, polls, then submits notes as text',async()=>{
 const calls=[];const responses=[new Response(null,{status:202,headers:{location:'upload-id'}}),Response.json({status:'InProgress'}),Response.json({status:'Succeeded'}),new Response(null,{status:202,headers:{location:'publish-id'}}),Response.json({status:'Succeeded',id:'publish-id'})];
 const result=await submitStore({store:'edge',zip:Buffer.from('zip'),credentials:edge,notes:'Review fixture',wait:async()=>{},fetchImpl:async(url,options)=>{calls.push({url,options});return responses.shift();}});
 assert.equal(calls.length,5);assert.equal(calls.filter(c=>c.options.method==='POST').length,2);assert.equal(calls[3].options.body,'Review fixture');assert.equal(calls[3].options.headers['content-type'],'text/plain');assert.equal(result.stage,'submitted-for-review');
});
test('in-review Edge rejection stops without withdrawal or retry',async()=>{
 let calls=0;await assert.rejects(submitStore({store:'edge',zip:Buffer.from('zip'),credentials:edge,wait:async()=>{},fetchImpl:async()=>++calls===1?new Response(null,{status:202,headers:{location:'upload-id'}}):Response.json({status:'Failed',errorCode:'InProgressSubmission',message:'A submission is already in review.'})}),/InProgressSubmission: A submission is already in review\. A previous submission is still in review/);assert.equal(calls,2);
});
test('Chrome HTTP errors name the step and include the store explanation',async()=>{
 const credentials=Object.fromEntries(['CWS_CLIENT_ID','CWS_CLIENT_SECRET','CWS_REFRESH_TOKEN','CWS_PUBLISHER_ID','CWS_EXTENSION_ID'].map(k=>[k,'fixture']));
 const responses=[Response.json({access_token:'fixture-token'}),Response.json({error:{code:400,message:'Item is pending review and cannot be updated.'}},{status:400})];
 await assert.rejects(submitStore({store:'chrome',zip:Buffer.from('zip'),credentials,wait:async()=>{},fetchImpl:async()=>responses.shift()}),
  /^Error: Chrome upload returned HTTP 400: Item is pending review and cannot be updated\. A previous submission is still in review/);
});
test('Chrome uses v2, waits for async upload and then requests automatic publication',async()=>{
 const calls=[];const responses=[Response.json({access_token:'fixture-token'}),Response.json({uploadState:'IN_PROGRESS'}),Response.json({lastAsyncUploadState:'SUCCEEDED'}),Response.json({state:'PENDING_REVIEW'})];
 const credentials=Object.fromEntries(['CWS_CLIENT_ID','CWS_CLIENT_SECRET','CWS_REFRESH_TOKEN','CWS_PUBLISHER_ID','CWS_EXTENSION_ID'].map(k=>[k,'fixture']));
 const result=await submitStore({store:'chrome',zip:Buffer.from('zip'),credentials,wait:async()=>{},fetchImpl:async(url,options)=>{calls.push({url,options});return responses.shift();}});
 assert.match(calls[1].url,/upload\/v2\/publishers\/fixture\/items\/fixture:upload$/);assert.equal(calls[3].options.body,'{"publishType":"DEFAULT_PUBLISH"}');assert.equal(result.stage,'submitted-for-review');
});
test('Chrome service account signs a scoped short-lived assertion without a user refresh token',async()=>{
 const {generateKeyPairSync,verify}=await import('node:crypto');
 const {chromeAccessToken,missingStoreSecrets}=await import('../store-publish.mjs');
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const credentials={CWS_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',client_email:'publisher@fixture.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})}),CWS_PUBLISHER_ID:'publisher',CWS_EXTENSION_ID:'extension'};
 assert.deepEqual(missingStoreSecrets('chrome',credentials),[]);
 const token=await chromeAccessToken(credentials,async(url,options)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(options.body.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header,payload,signature]=options.body.get('assertion').split('.');
  const claims=JSON.parse(Buffer.from(payload,'base64url'));
  assert.equal(claims.iss,'publisher@fixture.iam.gserviceaccount.com');
  assert.equal(claims.scope,'https://www.googleapis.com/auth/chromewebstore');
  assert.equal(claims.aud,url);assert.equal(claims.exp-claims.iat,3600);
  assert.equal(verify('RSA-SHA256',Buffer.from(`${header}.${payload}`),publicKey,Buffer.from(signature,'base64url')),true);
  return Response.json({access_token:'fixture-token'});
 });
 assert.equal(token,'fixture-token');
});
