/** Public API transport for packaged readers. No cookies, credentials or arbitrary headers. */
export function publicReadAllowed(page:string,target:string):boolean{
 try{const source=new URL(page),url=new URL(target);
  if(source.protocol!=='https:'||url.protocol!=='https:'||url.username||url.password||url.port||target.length>4096)return false;
  if(['news.ycombinator.com','hn.algolia.com'].includes(source.hostname))return url.hostname==='hacker-news.firebaseio.com'&&/^\/v0\/(?:[a-z]+|item\/\d+|user\/[\w-]+)\.json$/.test(url.pathname)&&!url.search || url.hostname==='hn.algolia.com'&&/^\/api\/v1\/(?:search|search_by_date|items\/\d+)$/.test(url.pathname);
  if(['v2ex.com','www.v2ex.com'].includes(source.hostname))return ['sov2ex.com','www.sov2ex.com'].includes(url.hostname)&&url.pathname==='/api/search';
  return false;
 }catch{return false;}
}
