import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogUpdateIdentity} from '../apps/chrome/src/shared/skillUpdateIdentity.ts';
import pins from '../apps/chrome/src/shared/builtinCatalog.json' with {type:'json'};
test('Amex bundled and unlinked local overrides can offer a reviewed update to the pinned entry',()=>{
 const expected={authorId:'da12dccf-f9f8-4d52-b6ad-4a69340266ed',skillId:'00aad896-f4f6-4042-898d-6da9442fee07'};
 assert.deepEqual(catalogUpdateIdentity('amex-chat',undefined,pins),expected);
 const local={source:'local code'};assert.deepEqual(catalogUpdateIdentity('amex-chat',local as any,pins),expected);assert.equal('identity' in local,false);
});
test('saved publisher identity is never replaced with a pin',()=>{
 const identity={authorId:'other-owner',skillId:'other-skill'};assert.equal(catalogUpdateIdentity('amex-chat',{identity},pins),identity);
});
test('unrecognized local skills and prototype names cannot adopt catalog identities',()=>{
 assert.equal(catalogUpdateIdentity('custom-amex',{},pins),undefined);assert.equal(catalogUpdateIdentity('__proto__',{},pins),undefined);
});
