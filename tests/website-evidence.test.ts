import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteEvidence} from '../packages/core/src/websiteEvidence.ts';

test('Discourse list evidence preserves every topic and the correct total reply count without user metadata', () => {
  const raw = {users: Array.from({length: 400}, (_, id) => ({id, avatar_template: 'unused'.repeat(40)})),
    topic_list: {per_page: 30, more_topics_url: '/latest?page=3', topics: [
      {id: 42, title: 'Recent discussion', created_at: '2026-10-26T14:39:34Z', posts_count: 168, reply_count: 2},
      {id: 43, title: 'Another discussion', posts_count: 101, reply_count: 0},
      {id: 44, title: 'No count supplied'},
    ]}};
  const original = JSON.stringify(raw);
  const projected = websiteEvidence(raw, 'https://forum.example') as any;
  assert.deepEqual(projected.topic_list.topics.map((topic: any) => topic.id), [42,43,44]);
  assert.equal(projected.topic_list.topics[0].total_replies, 167);
  assert.equal(projected.topic_list.topics[0].reply_count, 2);
  assert.equal(projected.topic_list.topics[0].url, 'https://forum.example/t/42');
  assert.equal(projected.topic_list.topics[1].total_replies, 100);
  assert.equal(projected.topic_list.topics[2].total_replies, undefined);
  assert.equal(projected.topic_list.more_topics_url, '/latest?page=3');
  assert.equal(projected.returned, 3);
  assert.equal(projected.users, undefined);
  assert.ok(JSON.stringify(projected).length < 1600);
  assert.equal(JSON.stringify(raw), original, 'The full tool result remains available for history/transcripts');
});

test('unrecognized skill results, errors and topic bodies remain intact', () => {
  for (const result of [null, 'text', {httpStatus:403}, {posts:[{text:'Full source body'}]},
    {topic_list:{topics:[{unexpected:'shape'}]}}]) assert.equal(websiteEvidence(result, 'https://forum.example'), result);
});
