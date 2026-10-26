import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const requiredSecrets={chrome:['CWS_CLIENT_ID','CWS_CLIENT_SECRET','CWS_REFRESH_TOKEN','CWS_PUBLISHER_ID','CWS_EXTENSION_ID'],edge:['EDGE_CLIENT_ID','EDGE_API_KEY','EDGE_PRODUCT_ID']};
export async function submitStore({store,zip,credentials,notes='',fetchImpl=fetch,wait=sleep}) {
 if(!requiredSecrets[store])throw Error('Choose chrome or edge');
 for(const key of requiredSecrets[store])if(!credentials[key])throw Error(`Missing ${key}; no upload was attempted`);
 const request=async(url,options={})=>{
  const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`Store API returned HTTP ${response.status}; inspect the store dashboard. No automatic withdrawal/retry.`);
  return response;
 };
 if(store==='chrome'){
  const tokenResponse=await request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:credentials.CWS_CLIENT_ID,client_secret:credentials.CWS_CLIENT_SECRET,refresh_token:credentials.CWS_REFRESH_TOKEN,grant_type:'refresh_token'})});
  const token=(await tokenResponse.json()).access_token;if(!token)throw Error('OAuth response did not contain an access token');
  const name=`publishers/${encodeURIComponent(credentials.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(credentials.CWS_EXTENSION_ID)}`;
  const headers={authorization:`Bearer ${token}`};
  let upload=await(await request(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,{method:'POST',headers:{...headers,'content-type':'application/zip'},body:zip})).json();
  for(let n=0;['IN_PROGRESS','UPLOAD_IN_PROGRESS'].includes(upload.uploadState)&&n<60;n++){
   await wait(10000);const status=await(await request(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,{headers})).json();upload={uploadState:status.lastAsyncUploadState};
  }
  if(!['SUCCEEDED','SUCCESS'].includes(upload.uploadState))throw Error(`Chrome upload did not succeed: ${upload.uploadState??'unknown'}`);
  const result=await(await request(`https://chromewebstore.googleapis.com/v2/${name}:publish`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({publishType:'DEFAULT_PUBLISH'})})).json();
  if(!['PENDING_REVIEW','PUBLISHED','STAGED'].includes(result.state))throw Error(`Chrome submission state was not confirmed: ${result.state??'unknown'}`);
  return {store,stage:result.state==='PUBLISHED'?'published':'submitted-for-review',state:result.state};
 }
 const base=`https://api.addons.microsoftedge.microsoft.com/v1/products/${encodeURIComponent(credentials.EDGE_PRODUCT_ID)}`;
 const headers={authorization:`ApiKey ${credentials.EDGE_API_KEY}`,'X-ClientID':credentials.EDGE_CLIENT_ID};
 const operation=async(response,path)=>{
  const location=response.headers.get('location');if(!location)throw Error('Missing Edge operation ID');
  const id=location.split('/').filter(Boolean).at(-1);if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Invalid Edge operation ID');
  for(let n=0;n<60;n++){
   const state=await(await request(`${base}/${path}/${encodeURIComponent(id)}`,{headers})).json();
   if(state.status==='Succeeded')return state;
   if(state.status==='Failed'||state.errorCode)throw Error(`Edge operation failed: ${state.errorCode||'see dashboard'}`);
   if(state.status!=='InProgress')throw Error('Unknown Edge operation state');
   await wait(10000);
  }
  throw Error('Edge operation still pending; inspect the dashboard before retrying');
 };
 await operation(await request(`${base}/submissions/draft/package`,{method:'POST',headers:{...headers,'content-type':'application/zip'},body:zip}),'submissions/draft/package/operations');
 const result=await operation(await request(`${base}/submissions`,{method:'POST',headers:{...headers,'content-type':'text/plain'},body:notes}),'submissions/operations');
 return {store,stage:'submitted-for-review',operationId:result.id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [store,path,notesPath]=process.argv.slice(2);const result=await submitStore({store,zip:await readFile(path),credentials:process.env,notes:notesPath?await readFile(notesPath,'utf8'):''});console.log(JSON.stringify(result,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
