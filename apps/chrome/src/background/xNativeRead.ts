type XNavigation = { status: 'navigation_required'; operation: string; url: string };
type XRead = { ok: true; result: unknown } | { ok: false; error: string };

const searchFunctions = new Set(['searchPosts', 'searchUsers', 'getReplies', 'readObserved']);
const postFunctions = new Set(['getPost', 'getConversation', 'readObserved']);
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let pendingXRead = Promise.resolve<unknown>(undefined);

export function continueXNativeRead(
  sender: chrome.runtime.MessageSender, method: string, args: unknown, result: unknown, deadline: number,
): Promise<XRead> | undefined {
  const navigation = result as Partial<XNavigation> | null;
  if (navigation?.status !== 'navigation_required' || !navigation.url || !sender.url ||
      !URL.canParse(navigation.url) || !URL.canParse(sender.url)) return;
  const url = new URL(navigation.url);
  if (url.origin !== 'https://x.com' || url.origin !== new URL(sender.url).origin || url.username || url.password) return;
  const search = navigation.operation === 'SearchTimeline' && searchFunctions.has(method) &&
    url.pathname === '/search' && url.searchParams.has('q');
  const post = navigation.operation === 'TweetDetail' && postFunctions.has(method) &&
    /^\/i\/web\/status\/\d+$/.test(url.pathname);
  if (!search && !post) return;
  const operation = search ? 'SearchTimeline' : 'TweetDetail';
  const next = pendingXRead.then(() => readInBackground(url.href, operation, method, args, deadline, sender.tab?.windowId));
  pendingXRead = next.catch(() => undefined);
  return next;
}

async function readInBackground(
  url: string, operation: string, method: string, args: unknown, deadline: number, windowId?: number,
): Promise<XRead> {
  if (Date.now() >= deadline) return {ok:false,error:'Timed out waiting for the X read.'};
  const tab = await chrome.tabs.create({url:'about:blank', active:false, windowId});
  if (tab.id == null) return {ok:false,error:'Could not open the X page.'};
  const tabId = tab.id;
  try {
    await chrome.tabs.update(tabId, {url});
    const navigationDeadline = Math.min(deadline, Date.now()+12_000);
    while (Date.now() < navigationDeadline) {
      const current = await chrome.tabs.get(tabId);
      if (!current.url || current.url === 'about:blank' || current.pendingUrl || current.status === 'loading') {
        await pause(200);
        continue;
      }
      const pageUrl = new URL(current.url);
      if (pageUrl.origin !== 'https://x.com' || /^\/i\/(?:flow\/login|jf\/onboarding\/web)/.test(pageUrl.pathname)) {
        return {ok:false,error:'X redirected the read. Sign in on X and try again.'};
      }
      const [capture] = await chrome.scripting.executeScript({
        target:{tabId}, world:'MAIN', injectImmediately:true,
        func: (expected: string) => {
          if (globalThis.location.origin !== 'https://x.com') return;
          const bridge = (globalThis as any).__xgoose;
          return bridge?.getNetworkRequests?.({filter: '/i/api/graphql/[^/]+/' + expected + '(?:\\?|$)'})
            .filter((request: {status?:number}) => request.status != null).at(-1)?.status as number | undefined;
        },
        args:[operation],
      });
      if (typeof capture?.result === 'number' && capture.documentId) {
        if (capture.result < 200 || capture.result >= 300) return {ok:false,error:'X returned HTTP ' + capture.result + '.'};
        const target = {tabId,documentIds:[capture.documentId]};
        await chrome.scripting.executeScript({target, world:'MAIN', files:['skillRuntime.js','skills/x.xgs.js']});
        const remaining = Math.max(0, deadline-Date.now());
        const [completed] = await chrome.scripting.executeScript({
          target, world:'MAIN',
          func: async (name: string, input: unknown, ms: number): Promise<XRead> => {
            const skill = (globalThis as any).xgoose?.skills?.x;
            const callable = Object.hasOwn(skill ?? {}, name) ? skill[name] : undefined;
            if (globalThis.location.origin !== 'https://x.com' || typeof callable !== 'function') {
              return {ok:false,error:'The X skill is unavailable on this page.'};
            }
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                Promise.resolve(callable(input)).then(result=>({ok:true as const,result})),
                new Promise<{ok:false;error:string}>(resolve => {
                  timeout = setTimeout(()=>resolve({ok:false,error:'The X read timed out.'}),ms);
                }),
              ]);
            } catch (error) {
              return {ok:false,error:error instanceof Error ? error.message : String(error)};
            } finally {
              if (timeout !== undefined) clearTimeout(timeout);
            }
          },
          args:[method,args,remaining],
        });
        return completed?.result ?? {ok:false,error:'The X read returned no response.'};
      }
      await pause(250);
    }
    return {ok:false,error:'The X page did not produce the ' + operation + ' request.'};
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}
