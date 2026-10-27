import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteEvidence} from '../packages/core/src/websiteEvidence.ts';

test('Discourse list evidence keeps every topic as one line with reply counts and no user metadata', () => {
  const raw = {users: Array.from({length: 400}, (_, id) => ({id, avatar_template: 'unused'.repeat(40)})),
    topic_list: {per_page: 30, more_topics_url: '/latest?page=3', topics: [
      {id: 42, title: 'Recent discussion', created_at: '2026-10-25T14:39:34Z', last_posted_at: '2026-10-26T01:00:00Z', posts_count: 168, reply_count: 2, views: 900, tags: ['citi'], pinned: true},
      {id: 43, title: 'Another discussion', posts_count: 101, reply_count: 0, category_id: 7, slug: 'another-discussion'},
      {id: 44, title: 'No count supplied'},
    ]}};
  const original = JSON.stringify(raw);
  const projected = websiteEvidence(raw, 'https://forum.example') as any;
  assert.equal(projected.topic_url, 'https://forum.example/t/{id}');
  assert.equal(projected.more_topics_url, '/latest?page=3');
  assert.deepEqual(projected.topics, [
    '#42 Recent discussion · 167 replies · 900 views · 2026-10-25→2026-10-26 · [citi] · pinned',
    '#43 Another discussion · 100 replies',
    '#44 No count supplied',
  ]);
  assert.equal(projected.users, undefined);
  assert.equal(JSON.stringify(raw), original, 'The full tool result remains available for history/transcripts');
});

test('unrecognized skill results, errors and topic bodies remain intact', () => {
  for (const result of [null, 'text', {httpStatus:403}, {posts:[{text:'Full source body'}]},
    {topic_list:{topics:[{unexpected:'shape'}]}}]) assert.deepEqual(websiteEvidence(result, 'https://forum.example'), result);
});

test('thread posts become one line each, keeping floor, author, date changes, likes and non-adjacent reply targets', () => {
  const raw = {id: 42, origin: 'https://forum.example', title: 'Citi Uber', url: 'https://forum.example/t/citi-uber/42', status: 'ok',
    first_post_number: 1, last_post_number: 4, missing_post_ids: [], output_limited: false, complete: false, next_cursor: 'c2', hint: 'Bodies: posts[].text.',
    posts: [
      {id: 1, post_number: 1, username: 'op', created_at: '2026-10-01T08:30:12.000Z', like_count: 3, reply_to_post_number: null, url: 'https://forum.example/t/42/1', text: '首发', text_truncated: false, next_text_offset: null},
      {id: 2, post_number: 2, username: 'dp', created_at: '2026-10-01T09:00:00.000Z', like_count: 0, reply_to_post_number: 1, text: '改 payment 成功'},
      {id: 3, post_number: 3, username: 'q', created_at: '2026-10-02T09:00:00.000Z', reply_to_post_number: 1, text: '怎么改？'},
      {id: 4, post_number: 4, username: 'long', created_at: '2026-10-02T10:00:00.000Z', text: 'Part one', text_truncated: true, next_text_offset: 8},
    ]};
  const projected = websiteEvidence(raw, 'https://forum.example') as any;
  assert.deepEqual(projected.posts, [
    '#1 @op 2026-10-01 ♥3: 首发',
    '#2 @dp: 改 payment 成功',
    '#3 @q 2026-10-02 ↩#1: 怎么改？',
    '#4 @long: Part one …[continues at text_offset 8]',
  ]);
  assert.equal(projected.post_url, 'https://forum.example/t/citi-uber/42/{floor}');
  assert.deepEqual(Object.keys(projected).sort(), ['complete', 'hint', 'next_cursor', 'post_format', 'post_url', 'posts', 'title', 'url']);
});

test('reply targets stay visible across gaps and truncation without an offset is still marked', () => {
  const projected = websiteEvidence({posts: [
    {post_number: 5, username: 'a', text: 'first'},
    {post_number: 9, username: 'b', reply_to_post_number: 5, text: 'answers #5 across a gap'},
    {post_number: 10, username: 'c', reply_to_post_number: 9, text: 'Preview', text_truncated: true},
  ], url: 'https://forum.example/t/x/1', hint: 'First five posts only.'}, 'https://forum.example') as any;
  assert.deepEqual(projected.posts, ['#5 @a: first', '#9 @b ↩#5: answers #5 across a gap', '#10 @c: Preview …[truncated]']);
  assert.equal(projected.hint, 'First five posts only.');
});

test('search results keep each hit with its topic and floor and drop search bookkeeping', () => {
  const raw = {status: 'ok', total_topics: 1, total_posts: 1, hint: 'Search snippets only.',
    grouped_search_result: {term: 'citi uber', search_log_id: 99, more_full_page_results: true, post_ids: [5]},
    topics: [{id: 42, title: 'Citi Uber', posts_count: 89, created_at: '2026-09-30T00:00:00Z', category_id: 3}],
    posts: [{id: 5, topic_id: 42, post_number: 17, username: 'dp', created_at: '2026-10-03T00:00:00Z', like_count: 2, blurb: 'Uber Eats 5x 成功'}]};
  const projected = websiteEvidence(raw, 'https://forum.example') as any;
  assert.deepEqual(projected.topics, ['#42 Citi Uber · 88 replies · 2026-09-30']);
  assert.deepEqual(projected.posts, ['#42/17 @dp 2026-10-03 ♥2: Uber Eats 5x 成功']);
  assert.equal(projected.more_results, true);
  assert.equal(projected.hint, 'Search snippets only.');
  assert.equal(projected.grouped_search_result, undefined);
});

test('reply targets name the user they answer, and inline quotes stay in the line', () => {
  const projected = websiteEvidence({url: 'https://www.uscardforum.com/t/542092', posts: [
    {post_number: 66, username: 'Rummy', text: '让codex直接读网页有点复杂 所以我的需求是 有什么本地codex或者claude来高效总结的流程？'},
    {post_number: 67, username: 'LeeKuanYew', reply_to_post_number: 64, reply_to_username: '索马里二当家', text: '我查一下 log'},
    {post_number: 68, username: 'LeeKuanYew', reply_to_post_number: 66, reply_to_username: 'Rummy',
      text: '[quote @Rummy #66: 让codex直接读网页有点复杂] 没有呀，这都是有 skills 的 API [quote @Rummy #66: 所以我的需求是 有什么本地codex或者claude来高效总结的流程？] 你可以选择让 codex 使用一样的 skills'},
  ]}, 'https://www.uscardforum.com') as any;
  assert.deepEqual(projected.posts.slice(1), [
    '#67 @LeeKuanYew ↩@索马里二当家#64: 我查一下 log',
    '#68 @LeeKuanYew ↩@Rummy#66: [quote @Rummy #66: 让codex直接读网页有点复杂] 没有呀，这都是有 skills 的 API [quote @Rummy #66: 所以我的需求是 有什么本地codex或者claude来高效总结的流程？] 你可以选择让 codex 使用一样的 skills',
  ]);
});

test('skill results combined by js_exec code are compacted inside arrays, allSettled entries and objects', () => {
  const thread = {url: 'https://forum.example/t/42', posts: [{post_number: 1, username: 'op', created_at: '2026-10-01T00:00:00Z', text: 'body'}]};
  const search = {topics: [{id: 42, title: 'Citi Uber'}], posts: [{topic_id: 42, post_number: 3, blurb: 'snippet'}]};
  const projected = websiteEvidence({search, reads: [{status: 'fulfilled', value: thread}, {status: 'rejected', reason: 'HTTP 429'}], note: 'kept'}, 'https://forum.example') as any;
  assert.deepEqual(projected.search.topics, ['#42 Citi Uber']);
  assert.deepEqual(projected.reads[0].value.posts, ['#1 @op 2026-10-01: body']);
  assert.deepEqual(projected.reads[1], {status: 'rejected', reason: 'HTTP 429'});
  assert.equal(projected.note, 'kept');
});

test('post lines carry emoji reactions after likes and keep image markers', () => {
  const projected = websiteEvidence({url: 'https://www.uscardforum.com/t/542092', posts: [
    {post_number: 1, username: 'op', like_count: 98, reactions: [{id: 'troll', count: 10}, {id: '666', count: 2}], text: 'Statement [image 1]'},
    {post_number: 2, username: 'reader', like_count: null, reactions: null, text: 'plain'},
  ]}, 'https://www.uscardforum.com') as any;
  assert.deepEqual(projected.posts, ['#1 @op ♥98 :troll:×10 :666:×2: Statement [image 1]', '#2 @reader: plain']);
  assert.match(projected.post_format, /:emoji:×count/);
});
