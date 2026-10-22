import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineSkill, fn } from "../packages/skill-runtime/src/index.ts";
function skill(value:string) { return defineSkill({read:fn({summary:"Read fixture",input:z.object({}),handler:()=>value})},{meta:{name:"fixture",namespace:"fixture"}}); }
test("disable and replacement invalidate cached function references",()=>{
  const root=(globalThis as any).xgoose={skills:{}};
  const first=skill("old");root.skills.fixture=first;
  const cached=first.read as Function;
  assert.equal(cached({}),"old");delete root.skills.fixture;assert.throws(()=>cached({}),/disabled/);
  const second=skill("new");root.skills.fixture=second;
  assert.equal((second.read as Function)({}),"new");assert.throws(()=>cached({}),/replaced/);
  delete (globalThis as any).xgoose;
});
