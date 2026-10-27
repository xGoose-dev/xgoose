import test from "node:test";
import assert from "node:assert/strict";
import {parseHostedModelCatalogue,resolveHostedModel} from "../apps/chrome/src/shared/hostedModels.ts";
import {SettingsSchema} from "../apps/chrome/src/shared/types.ts";
import {modelContextWindow} from "../packages/core/src/contextPolicy.ts";
test("server defaults follow catalogue changes while explicit choices and BYOK survive",()=>{
 const data=[{id:"deepseek-flash",context_window:1000000},{id:"claude-haiku-5-5",context_window:1000000},{id:"deepseek-purge",context_window:1000000}];
 const first=parseHostedModelCatalogue({default_model:"deepseek-flash",data});
 const next=parseHostedModelCatalogue({default_model:"claude-haiku-5-5",data});
 assert.equal(resolveHostedModel(SettingsSchema.parse({}).model,first),"deepseek-flash");
 assert.equal(resolveHostedModel("default",next),"claude-haiku-5-5");
 assert.equal(resolveHostedModel("claude-haiku-5-5",first),"claude-haiku-5-5");
 assert.equal(resolveHostedModel("luna",next),"luna");
 assert.equal(first.contextWindows?.["deepseek-purge"],1000000);
 assert.equal(modelContextWindow("deepseek-purge"),1000000);
 const byok=SettingsSchema.parse({provider:"openai-compat",model:"my-custom-model",apiKeys:{"openai-compat":"synthetic"}});
 assert.equal(byok.model,"my-custom-model");assert.equal(byok.apiKeys["openai-compat"],"synthetic");
});
test("invalid catalogue defaults and context metadata cannot override safe fallbacks",()=>{
 const c=parseHostedModelCatalogue({default_model:"unknown",data:[{id:"deepseek-flash",context_window:Infinity},{id:"deepseek-flash",context_window:1},{id:"luna",context_window:1050000},null,{}]});
 assert.equal(c.defaultModel,undefined);assert.equal(c.contextWindows?.["deepseek-flash"],undefined);
 assert.deepEqual(c.models,["deepseek-flash","luna"]);assert.equal(resolveHostedModel("default",c),"deepseek-flash");
 assert.equal(resolveHostedModel("default",parseHostedModelCatalogue(null)),"deepseek-flash");
});
