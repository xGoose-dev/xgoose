import test from 'node:test';
import assert from 'node:assert/strict';
import zh from '../apps/chrome/src/shared/locales/zh-CN.json';
import es from '../apps/chrome/src/shared/locales/es.json';
import {resolveLocale,translate,languageReminder} from '../apps/chrome/src/shared/locale.ts';
import {SettingsSchema} from '../apps/chrome/src/shared/types.ts';
test('language defaults follow the browser and support regional variants with an English fallback',()=>{
 assert.equal(SettingsSchema.parse({}).language,'auto');
 for(const tag of ['zh','zh-TW','zh_HK','zh-CN'])assert.equal(resolveLocale('auto',[tag]),'zh-CN');
 for(const tag of ['es','es-MX','es-ES'])assert.equal(resolveLocale('auto',[tag]),'es');
 assert.equal(resolveLocale('auto',['fr-FR','es-MX']),'es');
 assert.equal(resolveLocale('auto',['ja-JP']),'en');
 assert.equal(resolveLocale('auto',[]),'en');
});
test('an explicit language overrides the browser without resetting existing provider preferences',()=>{
 const settings=SettingsSchema.parse({provider:'gemini',model:'existing',apiKeys:{gemini:'keep-key'},language:'es'});
 assert.equal(resolveLocale(settings.language,['zh-CN']),'es');assert.equal(settings.apiKeys.gemini,'keep-key');assert.equal(settings.model,'existing');
 assert.equal(resolveLocale('en',['es-MX']),'en');assert.equal(resolveLocale('zh-CN',['en-US']),'zh-CN');
});
test('Chinese and Spanish catalogs have matching keys and preserve unknown source text',()=>{
 assert.deepEqual(Object.keys(zh).sort(),Object.keys(es).sort());assert.ok(Object.keys(zh).length>=300);
 assert.equal(translate('Settings','zh-CN'),'设置');assert.equal(translate('Settings','es'),'Configuración');
 assert.equal(translate('  Send\n','es'),'  Enviar\n');assert.equal(translate('source-owned unknown text','es'),'source-owned unknown text');
 assert.equal(translate('Context 37%','es'),'Contexto 37%');assert.equal(translate('Remove photo.png','zh-CN'),'移除 photo.png');
});
test('automatic answer language injects no instruction, regardless of browser or UI defaults',()=>{
 for(const languages of [['en-US'],['es-MX'],['zh-CN'],['fr-FR'],[]])assert.equal(languageReminder('auto',languages),'');
 for(const language of ['auto','en','zh-CN','es'])assert.equal(SettingsSchema.parse({language}).answerLanguage,'auto');
});
test('only explicit answer choices reach the AI and chat requests take priority',()=>{
 assert.match(languageReminder('zh-CN',['es-MX']),/Simplified Chinese \(zh-CN\)/);
 assert.match(languageReminder('en',['zh-CN']),/Preferred language: English \(en\)/);
 assert.match(languageReminder('es',['en-US']),/Preferred language: Spanish \(es\)/);
 const settings=SettingsSchema.parse({language:'en',answerLanguage:'es'});assert.equal(settings.language,'en');assert.equal(settings.answerLanguage,'es');
});
