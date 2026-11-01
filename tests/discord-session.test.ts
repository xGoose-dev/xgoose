import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';

const source = readFileSync(new URL('../apps/chrome/skills/discord.xgs.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default defineSkill', 'globalThis.skill=defineSkill');
function fixture(status = 200) {
  const calls: any[] = [];
  const context: any = {
    z, URL, Date, Promise, setTimeout,
    location: new URL('https://discord.com/channels/123/456'),
    fn: (spec: any) => spec,
    defineSkill: (spec: any) => Object.fromEntries(Object.entries(spec).map(([key, value]: any) => [key, value.handler])),
    __xgoose: {
      getNetworkRequests: () => [{id: 1, url: 'https://discord.com/api/v10/users/@me'}],
      getNetworkRequestDetail: () => ({req: {authorization: 'fixture-session', cookie: 'omit-me'}}),
    },
    fetch: async (url: string, options: any) => {
      calls.push({url, options});
      return new Response(JSON.stringify(status === 429 ? {message: 'Slow down', retry_after: 30} : [{id: '123', name: 'Fixture server'}]), {status});
    },
  };
  runInNewContext(source, context);
  return {skill: context.skill, calls};
}

test('Discord reads reuse observed session headers and API version without exposing them in results', async () => {
  const {skill, calls} = fixture();
  const result = await skill.listGuilds({limit: 1});
  assert.equal(result.guilds[0].name, 'Fixture server');
  assert.equal(new URL(calls[0].url).pathname, '/api/v10/users/@me/guilds');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers.authorization, 'fixture-session');
  assert.equal(calls[0].options.headers.cookie, undefined);
  assert.equal(JSON.stringify(result).includes('fixture-session'), false);
});

test('Discord preserves an HTTP failure and stops subsequent calls during the server cooldown', async () => {
  const {skill, calls} = fixture(429);
  await assert.rejects(skill.listGuilds({}), (error: any) => error.status === 429 && error.body.retry_after === 30);
  await assert.rejects(skill.listGuilds({}), (error: any) => error.status === 429 && error.retryAfterMs > 0);
  assert.equal(calls.length, 1);
});
