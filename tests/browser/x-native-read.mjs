import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

const invocations = [
  {operation: 'SearchTimeline', variables: {rawQuery: 'fixture', product: 'Latest', count: 4}},
  {operation: 'TweetDetail', variables: {focalTweetId: '123'}},
];
const calls = [], traffic = [], failures = [], navigations = [];
const nativeKey = operation => operation === 'SearchTimeline' ? 'search_by_raw_query' : 'threaded_conversation_with_injections_v2';
const frame = (delta, finish_reason = null) => 'data: '+JSON.stringify({choices: [{index: 0, delta, finish_reason}]})+'\n\n';
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls.push(JSON.parse(body));
  const args = invocations[calls.length-1];
  const delta = args ? {tool_calls: [{
    index: 0, id: 'x-native-'+calls.length, type: 'function',
    function: {name: 'skill_call', arguments: JSON.stringify({skill: 'x', function: 'readObserved', args})},
  }]} : {content: 'X fixture finished.'};
  res.writeHead(200, {'content-type': 'text/event-stream'});
  res.end(frame({role: 'assistant', ...delta})+frame({}, args ? 'tool_calls' : 'stop')+'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'xgoose-x-native-read-'));
const dist = resolve('apps/chrome/dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, args: ['--disable-extensions-except='+dist, '--load-extension='+dist],
});
context.setDefaultTimeout(22000);
try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const settings = await context.newPage();
  await settings.goto('chrome-extension://'+sw.url().split('/')[2]+'/options.html');
  await settings.evaluate(base => chrome.storage.local.set({
    'xgoose.settings': {provider: 'openai-compat', apiKeys: {'openai-compat': 'fixture'}, baseUrls: {'openai-compat': base},
      model: 'luna', analyticsEnabled: false, launcherVisibility: 'skill-sites'},
  }), 'http://127.0.0.1:'+server.address().port);
  assert.equal((await settings.evaluate(() => chrome.runtime.sendMessage({kind: 'sw:user_scripts_status'}))).enabled, false);
  context.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.origin === 'https://x.com') failures.push({path: url.pathname, error: request.failure()?.errorText});
  });
  await context.route('https://x.com/**', route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) navigations.push(url.pathname);
    if (url.pathname.startsWith('/i/api/graphql/')) {
      const operation = url.pathname.split('/').at(-1);
      traffic.push({operation, method: req.method(), body: req.method() === 'POST' ? req.postDataJSON() : null});
      return route.fulfill({json: {data: {[nativeKey(operation)]: {onlyNativeField: 'original-'+operation}}}});
    }
    if (url.pathname === '/fixture-native.js') {
      const operation = url.searchParams.get('operation');
      const variables = operation === 'SearchTimeline' ? {rawQuery: 'fixture', product: 'Latest'} : {focalTweetId: '123'};
      const query = new URLSearchParams({variables: JSON.stringify(variables), features: JSON.stringify({siteFeature: false})});
      return route.fulfill({contentType: 'application/javascript',
        body: 'fetch('+JSON.stringify('/i/api/graphql/current/'+operation+'?'+query)+',{headers:{authorization:"Bearer fixture","x-client-transaction-id":"native-get"}})'});
    }
    const operation = url.pathname === '/search' ? 'SearchTimeline' : url.pathname === '/i/web/status/123' ? 'TweetDetail' : '';
    const script = operation ? '<script src="/fixture-native.js?operation='+operation+'"></script>' : '';
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>X fixture</title><main>X browser entry</main>'+script});
  });
  const page = await context.newPage();
  await page.goto('https://x.com/home');
  await page.locator('.skill-chip').filter({hasText: 'x'}).waitFor({state: 'attached'});
  await page.locator('.toggle').click();
  await page.locator('.in-text').fill('Read raw search and post data');
  await page.locator('.btn-send').click();
  try {
    await page.waitForFunction(() => document.querySelector('#xgoose-root').shadowRoot.textContent.includes('X fixture finished.'), undefined, {timeout:40000});
  } catch (error) {
    const toolMessages = calls.flatMap(call => call.messages.filter(message => message.role === 'tool').map(message => String(message.content).slice(0, 300)));
    throw new Error(JSON.stringify({traffic, failures, navigations, toolMessages}), {cause:error});
  }
  assert.equal(calls.length, 3);
  const toolMessages = calls[2].messages.filter(message => message.role === 'tool').map(message => message.content);
  assert.deepEqual(toolMessages.map(message => {
    try { return JSON.parse(message); } catch { return message; }
  }), invocations.map(({operation}) => ({data: {[nativeKey(operation)]: {onlyNativeField: 'original-'+operation}}})),
  JSON.stringify({traffic, failures, toolMessages, navigations}));
  assert.deepEqual(traffic.map(({operation, method}) => [operation, method]),
    [['SearchTimeline', 'GET'], ['SearchTimeline', 'POST'], ['TweetDetail', 'GET'], ['TweetDetail', 'POST']]);
  assert.deepEqual(traffic[1].body, {variables: invocations[0].variables, features: {siteFeature: false}});
  assert.equal(page.url(), 'https://x.com/home');
  assert.equal(context.pages().filter(page => page.url().startsWith('https://x.com')).length, 1);
  console.log('X skill_call returned native search and post JSON from a cold X homepage.');
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, {recursive: true, force: true});
}
