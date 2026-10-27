import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedModelText, clearStoredResults, resultBudgetBytes, setResultBudget, storeResult} from '../packages/core/src/resultStore.ts';
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

test('result_query tolerates missing fields and invalid regexes and stays within the budget', async () => {
  setResultBudget(200_000);
  const query = createResultQueryTool();
  const exec = (input: any) => query.definition.execute({path: '', offset: 0, limit: 200, ...input} as any, {} as any) as any;
  storeResult('mixed', {posts: [{post_number: 1, text: 'a [b'}, {post_number: 2}], meta: {body: 'y'.repeat(200_000)}, huge: [{body: 'z'.repeat(200_000)}, {body: 'small'}]});
  assert.deepEqual((await exec({id: 'mixed', path: 'posts', fields: ['post_number', 'text']})).items, [{post_number: 1, text: 'a [b'}, {post_number: 2}]);
  assert.equal((await exec({id: 'mixed', path: 'posts', match: '[b'})).matched, 1);
  const value = await exec({id: 'mixed', path: 'meta'});
  assert.equal(value.truncated, true);
  assert.ok(value.value.length <= resultBudgetBytes() / 2);
  const page = await exec({id: 'mixed', path: 'huge'});
  assert.equal(page.item_truncated, true);
  assert.equal(page.items.length, 1);
  assert.ok(JSON.stringify(page.items).length <= resultBudgetBytes() / 2 + 16);
  assert.equal(page.next_offset, 1);
  await assert.rejects(async () => exec({id: 'mixed', path: 'nope'}), /Path "nope" does not exist/);
  clearStoredResults();
  await assert.rejects(async () => exec({id: 'mixed'}), /No stored result/);
});

test('every successful js_exec result can be queried by its resultId', async () => {
  Object.assign(globalThis as any, {window: {addEventListener() {}}, location: {origin: 'https://forum.example'}});
  const {jsExecModelOutput} = await import('../packages/page-controller/src/tools/jsExec.ts');
  setResultBudget(200_000);
  const shown = JSON.parse(jsExecModelOutput({ok: true, result: {rows: [1, 2, 3]}, resultId: 'small-exec'})[0].text);
  assert.equal(shown.resultId, 'small-exec');
  const page = await createResultQueryTool().definition.execute({id: 'small-exec', path: 'rows', offset: 1, limit: 1} as any, {} as any) as any;
  assert.deepEqual(page.items, [2]);
});

test('js_exec handles also point at the page-side result store', () => {
  setResultBudget(20_000);
  const value = {posts};
  const out = JSON.parse(boundedModelText(value, JSON.stringify(value), {id: 'exec-1', pageHandle: true}));
  assert.match(out.next, /xgoose\.results\["exec-1"\]/);
});
