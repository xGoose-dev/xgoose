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

test('shared reader results become one line per source with defaults omitted and a link template', () => {
  const comment = (id: string, parentId: string | null, text: string, extra = {}) => ({id, kind: 'comment', title: 'Original source', url: `https://news.ycombinator.com/item?id=${id}`, author: 'pg', publishedAt: '2026-10-25T14:39:34.000Z',
    text, excerpt: text.slice(0, 400), access: 'public', scope: 'body', method: 'api', complete: true, offset: 0, nextOffset: null, ...(parentId ? {parentId} : {}), score: 3, ...extra});
  const projected = websiteEvidence({readerVersion: 1, coverage: 'thread', sources: [
    {...comment('100', null, 'Show HN: a reader'), kind: 'story', title: 'Show HN', commentCount: 2, externalUrl: 'https://example.com/post'},
    comment('101', '100', 'First reply'),
    comment('102', '100', 'Second reply', {nextOffset: 12, complete: false, images: [{url: 'https://img.example/a.png'}]}),
  ]}, 'https://news.ycombinator.com') as any;
  assert.deepEqual(projected, {coverage: 'thread', source_url: 'https://news.ycombinator.com/item?id={id}', source_format: projected.source_format, sources: [
    '100 [story] @pg 2026-10-25 ↑3 💬2: Show HN: a reader → https://example.com/post',
    '101 @pg ↑3: First reply',
    '102 @pg ↑3 ↩100: Second reply …[continues at offset 12] {"images":[{"url":"https://img.example/a.png"}]}',
  ]});
});

test('reader sources without a shared link pattern keep their own URL and non-default scope and access', () => {
  const projected = websiteEvidence({readerVersion: 1, sources: [{id: 'a', kind: 'post', title: 'Loaded page', url: 'https://x.com/home', author: null, publishedAt: null, text: 'Visible posts',
    excerpt: 'Visible posts', access: 'session', scope: 'loaded_page', method: 'dom', complete: false, offset: 0, nextOffset: null}]}, 'https://x.com') as any;
  assert.deepEqual(projected.sources, ['a [post] "Loaded page": Visible posts …[partial] (loaded_page, session) <https://x.com/home>']);
});

test('vBulletin posts link by post id: one URL template, with the id on each line', () => {
  const link = (id: number) => `https://www.flyertalk.com/forum/showthread.php?p=${id}#post${id}`;
  const projected = websiteEvidence({id: 900, title: 'Lounge', url: 'https://www.flyertalk.com/forum/airport-lounges/900-lounge.html', total_pages: 2, pages_read: [1, 2], posts: [
    {post_number: 1, post_id: 101, username: 'alice', created_at: '2025-12-02', like_count: 3, text: 'Chang’s lounge [image 1]', url: link(101)},
    {post_number: 2, post_id: 102, username: 'bob', created_at: '2025-12-02', text: '[quote @alice #1: Chang lounge] Agreed', url: link(102)},
  ]}, 'https://www.flyertalk.com') as any;
  assert.equal(projected.post_url, 'https://www.flyertalk.com/forum/showthread.php?p={post_id}#post{post_id}');
  assert.match(projected.post_format, /^#floor \(id post_id\) @user/);
  assert.deepEqual(projected.posts, ['#1 (id 101) @alice 2025-12-02 ♥3: Chang’s lounge [image 1]', '#2 (id 102) @bob: [quote @alice #1: Chang lounge] Agreed']);
});

test('posts whose links fit no template keep their own link on the line', () => {
  const projected = websiteEvidence({url: 'https://forum.example/thread', posts: [
    {post_number: 1, username: 'a', text: 'one', url: 'https://forum.example/a'},
    {post_number: 2, username: 'b', text: 'two', url: 'https://forum.example/b'},
  ]}, 'https://forum.example') as any;
  assert.equal(projected.post_url, undefined);
  assert.deepEqual(projected.posts, ['#1 @a: one <https://forum.example/a>', '#2 @b: two <https://forum.example/b>']);
});
