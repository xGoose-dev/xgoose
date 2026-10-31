// ==XGooseSkill==
// @name youtube
// @namespace youtube
// @version 0.2.1
// @description YouTube search, captions, comments, channels, personal feeds, community posts, live chat, heatmaps, storyboard images and frame reading.
// @match https://www.youtube.com/*
// @match https://youtube.com/*
// @primary getVideo
// @keyword YouTube
// @keyword 视频
// @keyword 字幕
// @connect <self>
// @connect youtubeanalytics.googleapis.com
// ==/XGooseSkill==
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';

// Uses the web client's observed endpoint payloads and continuation tokens.
// Transcript structure reference: https://github.com/LuanRT/YouTube.js/blob/main/src/parser/youtube/TranscriptInfo.ts
const cache = new Map();
const text = v => typeof v === 'string' ? v : v?.simpleText ?? v?.runs?.map(r=>r.text).join('') ?? v?.content ?? '';
function nodes(value,key) {
 const found=[];
 function walk(v){if(!v||typeof v!=='object')return;if(v[key])found.push(v[key]);for(const item of Object.values(v))walk(item);}
 walk(value);return found;
}
function videoId(value) {
 if(!value)return new URL(location.href).searchParams.get('v') || location.pathname.match(/\/(?:shorts|live|embed)\/([^/?]+)/)?.[1];
 if(!value.includes('/')&&!value.includes('?'))return value;
 const u=new URL(value);return u.searchParams.get('v') || u.pathname.split('/').pop();
}
const videoUrl=(id,seconds)=>`https://www.youtube.com/watch?v=${encodeURIComponent(id)}${seconds===undefined?'':`&t=${Math.floor(seconds)}s`}`;
function embedded(html,name) {
 const match=new RegExp(`(?:var\\s+)?${name}\\s*=\\s*`).exec(html);
 if(!match)return undefined;
 const start=match.index+match[0].length;let depth=0,quoted=false,escaped=false;
 for(let i=start;i<html.length;i++){
  const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(html.slice(start,i+1));
 }
}
async function page(id) {
 if(cache.has(id))return cache.get(id);
 const current=videoId();let player,data;
 if(id===current){player=window.ytInitialPlayerResponse;data=window.ytInitialData;}
 if(player?.videoDetails?.videoId!==id){
  const response=await fetch(videoUrl(id),{credentials:'include'});if(!response.ok)throw Error(`watch HTTP ${response.status}`);
  const html=await response.text();player=embedded(html,'ytInitialPlayerResponse');data=embedded(html,'ytInitialData');
 }
 const result={player,data};if(player?.videoDetails)cache.set(id,result);return result;
}
async function api(endpoint,body) {
 const context=window.ytcfg.get('INNERTUBE_CONTEXT');
 const headers={'Content-Type':'application/json','X-Youtube-Client-Name':String(window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME')||1),'X-Youtube-Client-Version':context.client.clientVersion};
 if(context.client.visitorData)headers['X-Goog-Visitor-Id']=context.client.visitorData;
 const sid=(document.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('SAPISID='))?.slice(8);
 if(sid){
  const timestamp=Math.floor(Date.now()/1000),bytes=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));
  headers.Authorization=`SAPISIDHASH ${timestamp}_${[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}`;
  headers['X-Goog-Authuser']=String(window.ytcfg.get('SESSION_INDEX')||0);
  if(context.user?.onBehalfOfUser)headers['X-Goog-PageId']=context.user.onBehalfOfUser;
 }
 const response=await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`,{method:'POST',credentials:'include',headers,body:JSON.stringify({context,...body})});
 if(!response.ok)throw Error(`${endpoint} HTTP ${response.status}`);return response.json();
}
function cursor(value){
 function pageOnly(v){if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='commentThreadRenderer').map(([k,item])=>[k,Array.isArray(item)?item.map(pageOnly):pageOnly(item)]));}
 const command=nodes(pageOnly(value),'continuationItemRenderer')[0]?.continuationEndpoint;
 return command?{token:command.continuationCommand.token,endpoint:command.commandMetadata?.webCommandMetadata?.apiUrl?.replace('/youtubei/v1/','')||'browse'}:null;
}
const continueWith=c=>api(c.endpoint,{continuation:c.token});
function cards(data) {
 const out=[];
 function walk(v){
  if(!v||typeof v!=='object')return;
  for(const [key,item] of Object.entries(v)){
   if(['videoRenderer','playlistVideoRenderer','gridVideoRenderer','compactVideoRenderer'].includes(key))out.push({videoId:item.videoId,title:text(item.title),channel:text(item.ownerText||item.shortBylineText),duration:text(item.lengthText),published:text(item.publishedTimeText),views:text(item.viewCountText),thumbnail:item.thumbnail?.thumbnails?.at(-1)?.url,url:videoUrl(item.videoId),position:text(item.index)});
   else if(key==='lockupViewModel'&&['LOCKUP_CONTENT_TYPE_VIDEO','LOCKUP_CONTENT_TYPE_SHORT'].includes(item.contentType)){
    const meta=item.metadata?.lockupMetadataViewModel,watch=nodes(item,'watchEndpoint')[0],position=watch?.index;
    out.push({videoId:item.contentId,title:text(meta?.title),metadata:nodes(meta,'text').map(text).filter(Boolean),thumbnail:nodes(item.contentImage,'sources')[0]?.at(-1)?.url,url:videoUrl(item.contentId),position:position===undefined?undefined:position+1});
   }else walk(item);
  }
 }
 walk(data);return out;
}
async function getVideo({video:input}={}) {
 const id=videoId(input),{player,data}=await page(id),d=player?.videoDetails;
 if(!d)return {videoId:id,status:player?.playabilityStatus?.status||'unavailable',reason:player?.playabilityStatus?.reason};
 const micro=player.microformat?.playerMicroformatRenderer;
 return {videoId:id,url:videoUrl(id),title:d.title,channel:{id:d.channelId,name:d.author},description:d.shortDescription,durationSeconds:Number(d.lengthSeconds),views:d.viewCount,published:micro?.publishDate,live:d.isLiveContent,
 chapters:nodes(data,'chapterRenderer').map(c=>({title:text(c.title),startSeconds:Number(c.timeRangeStartMillis)/1000,url:videoUrl(id,Number(c.timeRangeStartMillis)/1000)})),
 captions:(player.captions?.playerCaptionsTracklistRenderer?.captionTracks||[]).map(t=>({language:t.languageCode,name:text(t.name),autoGenerated:t.kind==='asr'})),thumbnail:d.thumbnail?.thumbnails?.at(-1)?.url,readThumbnail:`readThumbnail({video:"${id}"})`};
}
async function searchVideos(a) {
 const data=a.cursor?await continueWith(a.cursor):await api('search',{query:a.query,...(a.params?{params:a.params}:{})});
 return {videos:cards(data),channels:nodes(data,'channelRenderer').map(c=>({id:c.channelId,name:text(c.title),description:text(c.descriptionSnippet)})),filters:nodes(data,'searchFilterRenderer').map(f=>({label:text(f.label),params:f.navigationEndpoint?.searchEndpoint?.params})),cursor:cursor(data)};
}
async function transcript(id,language) {
 const key=`${id}:${language||'default'}`;if(cache.has(key))return cache.get(key);
 const {data}=await page(id);
 const endpoint=nodes(data,'getTranscriptEndpoint')[0];
 if(!endpoint)return transcriptFromPage(id,language,'网页初始数据未包含字幕入口');
 let raw;
 try{raw=await api('get_transcript',{params:endpoint.params});}catch(error){const result=await transcriptFromPage(id,language,String(error.message));if(result.status==='ok')cache.set(key,result);return result;}
 let languages=nodes(raw,'transcriptFooterRenderer').flatMap(f=>f.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems||[]).map(t=>({language:t.title,params:t.continuation||t.serviceEndpoint?.getTranscriptEndpoint?.params,selected:t.selected}));
 if(language){const target=languages.find(t=>text(t.language)===language);if(!target)throw Error(`字幕语言未找到；可选：${languages.map(t=>text(t.language)).join(', ')}`);if(!target.selected)raw=await api('get_transcript',{params:target.params});languages=languages.map(t=>({...t,selected:t===target}));}
 const segments=nodes(raw,'transcriptSegmentRenderer').map(s=>({startSeconds:Number(s.startMs)/1000,endSeconds:Number(s.endMs)/1000,text:text(s.snippet),url:videoUrl(id,Number(s.startMs)/1000)}));
 const result={status:segments.length?'ok':'unavailable',languages:languages.map(t=>({language:text(t.language),selected:t.selected})),segments};
 if(segments.length)cache.set(key,result);return result;
}
async function getTranscript(a={}) {
 const id=videoId(a.video),all=await transcript(id,a.language),offset=a.offset||0,limit=a.limit||80;
 if(all.next||all.status!=='ok')return {videoId:id,...all};
 const selected=all.segments.filter(s=>(a.startSeconds===undefined||s.endSeconds>=a.startSeconds)&&(a.endSeconds===undefined||s.startSeconds<=a.endSeconds));
 return {videoId:id,status:all.status,languages:all.languages,totalSegments:selected.length,segments:selected.slice(offset,offset+limit),nextOffset:offset+limit<selected.length?offset+limit:null};
}
async function searchTranscript(a) {
 const id=videoId(a.video),all=await transcript(id,a.language),query=a.query.toLocaleLowerCase(),context=a.contextSegments??1;
 if(all.next||all.status!=='ok')return {videoId:id,...all,...(all.next?{next:{skill:'youtube',function:'searchTranscript',args:a}}:{})};
 const indices=new Set();all.segments.forEach((s,i)=>{if(s.text.toLocaleLowerCase().includes(query))for(let j=Math.max(0,i-context);j<=Math.min(all.segments.length-1,i+context);j++)indices.add(j);});
 const matched=[...indices].sort((a,b)=>a-b),offset=a.offset||0,limit=a.limit||30;
 return {videoId:id,status:all.status,totalMatches:matched.length,segments:matched.slice(offset,offset+limit).map(i=>all.segments[i]),nextOffset:offset+limit<matched.length?offset+limit:null};
}
async function getComments(a={}) {
 const id=videoId(a.video);let data;
 if(a.cursor)data=await continueWith(a.cursor);
 else {
  const initial=(await page(id)).data;
  const section=nodes(initial,'itemSectionRenderer').find(s=>s.sectionIdentifier==='comment-item-section'||s.targetId==='comments-section');
  const c=cursor(section);if(!c)return {status:'unavailable',comments:[]};data=await continueWith(c);
  const menus=nodes(data,'sortFilterSubMenuRenderer').flatMap(m=>m.subMenuItems||[]);
  const selected=menus.find(m=>a.order==='newest'?/newest|最新/i.test(m.title):m.selected);
  if(a.order==='newest'&&!selected)throw Error('当前评论响应没有最新排序入口');
  if(selected?.serviceEndpoint?.continuationCommand)data=await api('next',{continuation:selected.serviceEndpoint.continuationCommand.token});
 }
 const entities=nodes(data,'commentEntityPayload'),byId=new Map(entities.map(e=>[e.properties?.commentId,e]));
 const comments=nodes(data,'commentThreadRenderer').map(t=>{
  const legacy=t.comment?.commentRenderer,view=t.commentViewModel?.commentViewModel;
  const entity=byId.get(view?.commentId)||entities.find(e=>e.key===view?.commentKey);
  return {id:legacy?.commentId||view?.commentId,text:text(legacy?.contentText)||entity?.properties?.content?.content,author:text(legacy?.authorText)||entity?.author?.displayName,published:text(legacy?.publishedTimeText)||entity?.properties?.publishedTime,likes:text(legacy?.voteCount)||entity?.toolbar?.likeCountNotliked,replies:cursor(t.replies)};
 });
 const replies=nodes(data,'commentRenderer').map(c=>({id:c.commentId,text:text(c.contentText),author:text(c.authorText),published:text(c.publishedTimeText)}));
 const modernReplies=entities.map(e=>({id:e.properties?.commentId,text:e.properties?.content?.content,author:e.author?.displayName,published:e.properties?.publishedTime}));
 return {status:'ok',comments:comments.length?comments:replies.length?replies:modernReplies,cursor:cursor(data)};
}
async function getChannel(a) {
 const data=a.cursor?await continueWith(a.cursor):await api('browse',{browseId:a.channelId,...(a.params?{params:a.params}:{})});
 return {metadata:data.metadata?.channelMetadataRenderer, videos:cards(data),posts:posts(data),tabs:nodes(data,'tabRenderer').map(t=>({title:t.title,selected:t.selected,endpoint:t.endpoint?.browseEndpoint})),cursor:cursor(data)};
}
async function getPlaylist(a) {
 const id=a.playlistId.includes('list=')?new URL(a.playlistId).searchParams.get('list'):a.playlistId;
 const data=a.cursor?await continueWith(a.cursor):await api('browse',{browseId:`VL${id}`});
 return {playlistId:id,title:text(data.metadata?.playlistMetadataRenderer?.title),videos:cards(data),cursor:cursor(data)};
}
async function seekTo(a) {
 const id=videoId(a.video),current=videoId();
 if(current!==id)return {status:'navigation_required',url:videoUrl(id,a.seconds),next:{skill:'youtube',function:'seekTo',args:a}};
 const player=document.querySelector('video');player.currentTime=a.seconds;
 await new Promise(resolve=>{if(!player.seeking)return resolve();player.addEventListener('seeked',resolve,{once:true});});
 player.pause();return {videoId:id,seconds:player.currentTime,url:videoUrl(id,player.currentTime),readFrame:'screenshot_page({selector:"#movie_player"})'};
}
async function readThumbnail(a={}) {
 const video=await getVideo(a);return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:[{image:1,url:video.thumbnail}]}};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(read,ms=8000){const end=Date.now()+ms;do{const result=read();if(result)return result;await delay(200);}while(Date.now()<end);return null;}
function navigate(url,fn,args){return {status:'navigation_required',url,next:{skill:'youtube',function:fn,args}};}
function clockSeconds(value){return value.trim().split(':').reduce((n,v)=>n*60+Number(v),0);}
async function transcriptFromPage(id,language,apiError){
 if(videoId()!==id)return navigate(videoUrl(id),'getTranscript',{video:id,language});
 let panel=document.querySelector('ytd-transcript-renderer');
 if(!panel){
  const findButton=()=>[...document.querySelectorAll('button, ytd-button-renderer')].find(e=>/^(show transcript|显示转录文稿|显示文字稿|顯示轉錄稿)$/i.test(e.textContent.trim()));
  let button=findButton();
  if(!button){const expand=document.querySelector('#description-inline-expander #expand');if(expand){expand.click();button=await waitFor(findButton,2000);}}
  if(!button)return {status:'transcript_ui_required',videoId:id,apiError,segments:[],languages:[],hint:'在视频简介中展开 Show transcript，再调用 getTranscript。'};
  button.click();panel=await waitFor(()=>document.querySelector('ytd-transcript-renderer'));
 }
 if(!panel)return {status:'loading',segments:[],languages:[],apiError};
 const menu=panel.querySelector('ytd-menu-renderer'),selected=menu?.textContent?.trim();
 if(language&&selected&&!selected.includes(language))return {status:'language_selection_required',language,currentLanguage:selected,segments:[],languages:[],hint:'在字幕面板中选择目标语言，再继续读取。'};
 const rows=await waitFor(()=>{const list=[...panel.querySelectorAll('ytd-transcript-segment-renderer')];return list.length?list:null;});
 const segments=(rows||[]).map(row=>({startSeconds:clockSeconds(row.querySelector('.segment-timestamp')?.textContent||'0'),text:row.querySelector('.segment-text')?.textContent?.trim()||''}));
 segments.forEach((segment,i)=>{segment.endSeconds=segments[i+1]?.startSeconds??Number(document.querySelector('video')?.duration||segment.startSeconds);segment.url=videoUrl(id,segment.startSeconds);});
 return {status:segments.length?'ok':'loading',source:'page_transcript',languages:selected?[{language:selected,selected:true}]:[],segments};
}
function playlists(data){return nodes(data,'lockupViewModel').filter(x=>x.contentType==='LOCKUP_CONTENT_TYPE_PLAYLIST').map(x=>({id:x.contentId,title:text(x.metadata?.lockupMetadataViewModel?.title),url:`https://www.youtube.com/playlist?list=${x.contentId}`})).concat(nodes(data,'playlistRenderer').map(x=>({id:x.playlistId,title:text(x.title),url:`https://www.youtube.com/playlist?list=${x.playlistId}`})));}
async function getFeed(a={}){
 const ids={home:'FEwhat_to_watch',subscriptions:'FEsubscriptions',history:'FEhistory',library:'FElibrary',playlists:'FEplaylist_aggregation',channels:'FEchannels',courses:'FEcourses_destination'};
 const data=a.cursor?await continueWith(a.cursor):await api('browse',{browseId:ids[a.feed||'home']});
 return {feed:a.feed||'home',videos:cards(data),playlists:playlists(data),channels:nodes(data,'guideEntryRenderer').map(x=>({title:text(x.formattedTitle),channelId:x.navigationEndpoint?.browseEndpoint?.browseId})),messages:nodes(data,'messageRenderer').map(x=>text(x.text)),cursor:cursor(data)};
}
async function getPersonalPlaylist(a={}){return getPlaylist({playlistId:a.kind==='liked'?'LL':'WL',cursor:a.cursor});}
async function getNotifications(a={}){
 const data=await api('notification/get_notification_menu',{notificationsMenuRequestType:'NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX',...(a.cursor?{continuation:a.cursor.token}:{})});
 return {notifications:nodes(data,'notificationRenderer').map(n=>({text:text(n.shortMessage),published:text(n.sentTimeText),read:n.read,url:n.navigationEndpoint?.watchEndpoint?videoUrl(n.navigationEndpoint.watchEndpoint.videoId):n.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url})),cursor:cursor(data)};
}
function posts(data){return nodes(data,'backstagePostRenderer').map(p=>({id:p.postId,text:text(p.contentText),author:text(p.authorText),published:text(p.publishedTimeText),images:nodes(p,'backstageImageRenderer').map(i=>i.image?.thumbnails?.at(-1)?.url).filter(Boolean),poll:nodes(p,'pollRenderer').map(x=>({choices:x.choices?.map(c=>({text:text(c.text),votes:text(c.voteRatio)})),totalVotes:text(x.totalVotes)})),url:`https://www.youtube.com/post/${p.postId}`}));}
async function getCommunity(a){
 if(a.postId){
  const url=`https://www.youtube.com/post/${a.postId}`;
  const response=await fetch(url,{credentials:'include'});if(!response.ok)throw Error(`post HTTP ${response.status}`);
  const data=embedded(await response.text(),'ytInitialData');const section=nodes(data,'itemSectionRenderer').find(x=>/comment/i.test(x.sectionIdentifier||x.targetId||''));return {posts:posts(data),commentsCursor:cursor(section),cursor:cursor(data)};
 }
 const channel=await getChannel(a);
 const tab=channel.tabs.find(t=>/posts|community|社区|社群|貼文|帖子/i.test(t.title));
 if(!a.params&&!a.cursor&&tab?.endpoint?.params)return getCommunity({...a,params:tab.endpoint.params});
 return {channelId:a.channelId,posts:channel.posts,cursor:channel.cursor};
}
async function getRelated(a={}){const data=a.cursor?await continueWith(a.cursor):await api('next',{videoId:videoId(a.video)});return {videos:cards(data),cursor:cursor(data)};}
async function getLiveChat(a={}){
 const id=videoId(a.video);let continuation=a.cursor;
 if(!continuation){
  const {data}=await page(id),chat=nodes(data,'liveChatRenderer')[0];
  if(!chat)return {status:'unavailable',messages:[]};
  const c=Object.values(chat.continuations?.[0]||{})[0];
  continuation={token:c.continuation,endpoint:chat.isReplay?'live_chat/get_live_chat_replay':'live_chat/get_live_chat'};
 }
 const raw=await continueWith(continuation),chat=raw.continuationContents?.liveChatContinuation;
 if(!chat)return {status:'ended',messages:[]};
 const messages=[];
 for(const type of ['liveChatTextMessageRenderer','liveChatPaidMessageRenderer','liveChatMembershipItemRenderer'])for(const m of nodes(chat,type))messages.push({id:m.id,type,author:text(m.authorName),text:text(m.message||m.headerSubtext),timestampUsec:m.timestampUsec,amount:text(m.purchaseAmountText)});
 const c=Object.values(chat.continuations?.[0]||{})[0];
 return {status:'ok',messages:messages.sort((a,b)=>Number(a.timestampUsec)-Number(b.timestampUsec)),removed:nodes(chat,'markChatItemAsDeletedAction').map(x=>x.targetItemId),pollAfterMs:c?.timeoutMs,cursor:c?{token:c.continuation,endpoint:continuation.endpoint}:null};
}
async function getHeatmap(a={}){const {data}=await page(videoId(a.video));return {videoId:videoId(a.video),markers:nodes(data,'heatMarkerRenderer').map(m=>({startSeconds:Number(m.timeRangeStartMillis)/1000,durationSeconds:Number(m.markerDurationMillis)/1000,intensity:m.heatMarkerIntensityScoreNormalized}))};}
async function getStoryboards(a={}){
 const {player}=await page(videoId(a.video)),spec=player?.storyboards?.playerStoryboardSpecRenderer?.spec;
 if(!spec)return {videoId:videoId(a.video),boards:[]};
 const [template,...levels]=spec.split('|');
 return {videoId:videoId(a.video),boards:levels.map((value,level)=>{
  const [width,height,count,columns,rows,interval,name,sigh]=value.split('#'),url=new URL(template.replace('$L',String(level)).replace('$N',name));url.searchParams.set('sigh',sigh);
  return {level,width:Number(width),height:Number(height),count:Number(count),columns:Number(columns),rows:Number(rows),intervalMs:Number(interval),tileCount:Math.ceil(Number(count)/(Number(columns)*Number(rows))),template:url.href};
 }),readImages:`readStoryboard({video:"${videoId(a.video)}",level:N,tile:N})`};
}
async function readStoryboard(a){const board=(await getStoryboards(a)).boards.find(b=>b.level===a.level);return {imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:[{image:1,url:board.template.replace('$M',String(a.tile))}]},grid:{columns:board.columns,rows:board.rows,firstFrame:a.tile*board.columns*board.rows,intervalMs:board.intervalMs}};}
async function searchVideoTranscripts(a){
 const results=[];
 for(const video of a.videos)results.push(await searchTranscript({...a,video}));
 return {query:a.query,results,completed:results.filter(r=>r.status==='ok').length,requested:a.videos.length};
}
async function exportSubtitles(a={}){
 const id=videoId(a.video),all=await transcript(id,a.language);if(all.status!=='ok')return {...all,...(all.next?{next:{skill:'youtube',function:'exportSubtitles',args:a}}:{})};
 const stamp=seconds=>{const ms=Math.floor(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${a.format==='srt'?',':'.'}${String(ms%1000).padStart(3,'0')}`;};
 const body=all.segments.map((s,i)=>`${a.format==='srt'?i+1+'\n':''}${stamp(s.startSeconds)} --> ${stamp(s.endSeconds)}\n${s.text}`).join('\n\n');
 return {videoId:id,format:a.format||'vtt',text:(a.format==='srt'?'':'WEBVTT\n\n')+body};
}
async function getCreatorAnalytics(a){
 const query=new URLSearchParams({ids:`channel==${a.channelId||'MINE'}`,startDate:a.startDate,endDate:a.endDate,metrics:a.metrics.join(',')});
 if(a.dimensions?.length)query.set('dimensions',a.dimensions.join(','));
 if(a.filters)query.set('filters',a.filters);
 if(a.sort)query.set('sort',a.sort);
 const response=await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`,{headers:{Authorization:`Bearer ${a.accessToken}`}});
 if(!response.ok)throw Error(`YouTube Analytics HTTP ${response.status}`);
 const data=await response.json();return {columns:data.columnHeaders,rows:data.rows||[]};
}
const video=z.string().optional(),num=z.number().nonnegative().optional(),limit=z.number().int().positive().optional();
const continuation=z.object({token:z.string(),endpoint:z.string()}).optional();
const caption={video,language:z.string().optional(),offset:num,limit};
const entry=(summary,input,handler,args={})=>fn({summary,input,handler,examples:[{args}]});
export default defineSkill({
 getCreatorAnalytics:entry('自己的频道 Analytics 官方报表；accessToken 需有 YouTube Analytics OAuth 权限，网页 Cookie 不能代替。',z.object({accessToken:z.string(),channelId:z.string().optional(),startDate:z.string(),endDate:z.string(),metrics:z.array(z.string()),dimensions:z.array(z.string()).optional(),filters:z.string().optional(),sort:z.string().optional()}),getCreatorAnalytics,{startDate:'2026-10-01',endDate:'2026-10-30',metrics:['views'],dimensions:['day']}),
 getFeed:entry('首页、订阅动态、历史、资料库、个人列表、订阅频道和课程；使用当前登录会话。',z.object({feed:z.enum(['home','subscriptions','history','library','playlists','channels','courses']).optional(),cursor:continuation}),getFeed),
 getPersonalPlaylist:entry('稍后观看或喜欢的视频，保留原生续页。',z.object({kind:z.enum(['watchLater','liked']),cursor:continuation}),getPersonalPlaylist,{kind:'watchLater'}),
 getNotifications:entry('读取当前账号通知列表和续页。',z.object({cursor:continuation}),getNotifications),
 getCommunity:entry('频道社区帖子、图片和投票；也可直接读取 postId。',z.object({channelId:z.string().optional(),postId:z.string().optional(),params:z.string().optional(),cursor:continuation}),getCommunity),
 getRelated:entry('视频相关推荐及续页。',z.object({video,cursor:continuation}),getRelated),
 getLiveChat:entry('直播或回放聊天的单批消息；用 cursor 继续，遵循 pollAfterMs。',z.object({video,cursor:continuation}),getLiveChat),
 getHeatmap:entry('视频重复观看热区的时间范围与强度。',z.object({video}),getHeatmap),
 getStoryboards:entry('时间轴预览图的拼图层级、尺寸、时间间隔及读取提示。',z.object({video}),getStoryboards),
 readStoryboard:entry('通过后台读图通道读取指定预览拼图。',z.object({video,level:z.number().int().nonnegative(),tile:z.number().int().nonnegative()}),readStoryboard,{level:0,tile:0}),
 searchVideoTranscripts:entry('在指定多个视频的字幕中查找同一问题，逐视频报告覆盖情况。',z.object({...caption,videos:z.array(z.string()),query:z.string(),contextSegments:num}),searchVideoTranscripts,{videos:['VIDEO_ID'],query:'deployment'}),
 exportSubtitles:entry('将可用字幕导出为 SRT 或 VTT 文本。',z.object({video,language:z.string().optional(),format:z.enum(['srt','vtt']).optional()}),exportSubtitles,{format:'vtt'}),
 getVideo:entry('当前或指定视频的详情、章节及字幕语言。',z.object({video}),getVideo),
 searchVideos:entry('视频搜索；返回页面原生 filters 的 params，传入 params 应用筛选和排序；cursor 翻页。',z.object({query:z.string().optional(),params:z.string().optional(),cursor:continuation}),searchVideos,{query:'TypeScript tutorial'}),
 getTranscript:entry('按时间范围或 offset 读取带时间戳字幕；language 使用返回的语言名称。',z.object({...caption,startSeconds:num,endSeconds:num}),getTranscript),
 searchTranscript:entry('字幕关键词检索，返回命中上下文和时间链接。',z.object({...caption,query:z.string(),contextSegments:num}),searchTranscript,{query:'deployment'}),
 getComments:entry('评论按热门或最新读取；返回的 replies 和 cursor 可继续传入本函数。',z.object({video,order:z.enum(['top','newest']).optional(),cursor:continuation}),getComments),
 getChannel:entry('频道资料、视频与 tab 入口；channelId 使用 UC 开头 ID。',z.object({channelId:z.string().optional(),params:z.string().optional(),cursor:continuation}),getChannel),
 getPlaylist:entry('播放列表视频按实际顺序返回，包含 position 和续页 cursor。',z.object({playlistId:z.string(),cursor:continuation}),getPlaylist),
 seekTo:entry('定位并暂停当前视频；返回播放器局部截图的读图调用。',z.object({video,seconds:z.number().nonnegative()}),seekTo,{seconds:60}),
 readThumbnail:entry('读取视频缩略图像素。',z.object({video}),readThumbnail),
},{instructions:'通过 skill_call 调用。字幕保留时间戳，长内容通过 offset 继续；特定问题先 searchTranscript。搜索排序使用返回的 filters.params。看视频画面时先 seekTo，再执行返回的 readFrame；缩略图用 readThumbnail。navigation_required 时导航到 url 并执行 next。'});
