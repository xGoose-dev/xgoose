import {send} from '@/shared/messages';

export async function capturePageImages(args:{tabId?:number;selector?:string;fullPage?:boolean}, signal?:AbortSignal) {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const request = send('sw:capture_page',{...args,requestId});
  if(!signal) return request;
  return new Promise<Awaited<typeof request>>((resolve,reject) => {
    const stopped = () => {
      void send('sw:capture_abort',{requestId}).catch(error => console.warn('[xgoose:screenshot] cancellation failed',error));
      reject(signal.reason);
    };
    signal.addEventListener('abort',stopped,{once:true});
    request.then(resolve,reject).finally(() => signal.removeEventListener('abort',stopped));
    if(signal.aborted) stopped();
  });
}
