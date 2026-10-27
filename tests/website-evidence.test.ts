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
    {topic_list:{topics:[{unexpected:'shape'}]}}]) assert.equal(websiteEvidence(result, 'https://forum.example'), result);
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
    '#3 @q 2026-10-02 ↩1: 怎么改？',
    '#4 @long: Part one …[continues at text_offset 8]',
  ]);
  assert.equal(projected.post_url, 'https://forum.example/t/citi-uber/42/{floor}');
  assert.deepEqual(Object.keys(projected).sort(), ['complete', 'next_cursor', 'post_format', 'post_url', 'posts', 'title', 'url']);
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
