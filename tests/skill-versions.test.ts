import test from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion} from '../apps/chrome/src/shared/skillVersions.ts';
test('compares numeric version segments, prereleases and build metadata',()=>{
  for(const [next,old] of [['0.10.0','0.9.0'],['2.0.0','1.99.99'],['1.0.0','1.0.0-rc.1'],['1.0.0-rc.10','1.0.0-rc.2'],['1.0.0-beta','1.0.0-alpha'],['1.0.0-a.b','1.0.0-a']])assert.equal(newerVersion(next,old),true,`${next} > ${old}`);
  for(const [next,old] of [['1.0.0','1.0.0'],['1.0.0+new','1.0.0+old'],['1.0.0-rc.1','1.0.0'],['0.9.0','0.10.0'],['latest','1.0.0'],['1.0.1','unknown']])assert.equal(newerVersion(next,old),false,`${next} <= ${old}`);
});
