import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEngagementClock} from '../apps/chrome/src/shared/engagementClock.ts';
test('measures visible foreground time once, and excludes hidden, closed and idle time',()=>{
  const c=createEngagementClock();
  c.enabled(true,0);c.visible(true,0);
  assert.equal(c.take(15000),15000);assert.equal(c.take(15000),0);
  c.visible(false,20000);assert.equal(c.take(120000),5000);
  c.visible(true,120000);assert.equal(c.take(180000),0); // idle lease expired
  c.interact(180000);assert.equal(c.take(200000),20000);
  c.enabled(false,210000);assert.equal(c.take(250000),10000);
  c.enabled(true,260000);assert.equal(c.take(340000),60000); // at most 60s idle
});
