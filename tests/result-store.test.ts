import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedModelText, resultBudgetBytes, setResultBudget} from '../packages/core/src/resultStore.ts';
import {createResultQueryTool} from '../packages/core/src/tools/resultQuery.ts';

const posts = Array.from({length: 400}, (_, i) => ({post_number: i + 1, username: `u${i}`, text: `${i % 7 ? 'other' : 'Uber Eats 改 payment'} ${'x'.repeat(400)}`}));

test('results within the window budget are returned in full', () => {
  setResultBudget(200_000);
  assert.equal(resultBudgetBytes(), 90_000);
  const text = JSON.stringify({posts: posts.slice(0, 20)});
  assert.equal(boundedModelText({}, text), text);
});

test('oversized results are stored and can be filtered and paged with result_query', async () => {
  setResultBudget(200_000);
  const value = {posts};
  const out = JSON.parse(boundedModelText(value, JSON.stringify(value), {id: 'thread-1'}));
  assert.equal(out.oversized, true);
  assert.equal(out.resultId, 'thread-1');
  assert.equal(out.shape.posts, 'array(400)');
  assert.match(out.next, /result_query/);
  const query = createResultQueryTool();
  const page = await query.definition.execute({id: 'thread-1', path: 'posts', match: '改 payment', fields: ['post_number', 'username'], offset: 0, limit: 200} as any, {} as any) as any;
  assert.equal(page.total, 400);
  assert.equal(page.matched, 58);
  assert.deepEqual(page.items[1], {post_number: 8, username: 'u7'});
  assert.equal(page.next_offset, null);
  await assert.rejects(async () => query.definition.execute({id: 'missing', path: '', offset: 0, limit: 10} as any, {} as any), /No stored result/);
});

test('js_exec handles also point at the page-side result store', () => {
  setResultBudget(20_000);
  const value = {posts};
  const out = JSON.parse(boundedModelText(value, JSON.stringify(value), {id: 'exec-1', pageHandle: true}));
  assert.match(out.next, /xgoose\.results\["exec-1"\]/);
});
