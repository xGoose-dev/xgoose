import test from 'node:test';
import assert from 'node:assert/strict';
import {browserName,extensionDetailsUrl} from '../apps/chrome/src/shared/browser.ts';
import {userScriptsSetup,userScriptsReminder} from '../apps/chrome/src/shared/userScriptsSetup.ts';

const edge='Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';
const chrome='Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36';
test('permission links follow the Chromium browser and preserve the installed extension identity',()=>{
  assert.equal(extensionDetailsUrl('installed-id',edge),'edge://extensions/?id=installed-id');
  assert.equal(extensionDetailsUrl('installed-id',chrome),'chrome://extensions/?id=installed-id');
  assert.equal(extensionDetailsUrl(undefined,edge),'edge://extensions');
  assert.equal(browserName(edge),'Microsoft Edge');
});
test('Edge permission instructions point to Edge',()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:edge,languages:['en'],language:'en'}});
  try {
    const setup=userScriptsSetup('installed-id');
    assert.equal(setup.detailsUrl,'edge://extensions/?id=installed-id');
    assert.equal(setup.guideUrl,'chrome-extension://installed-id/onboarding.html');
    assert.match(setup.steps[0],/Microsoft Edge/);
    const reminder=userScriptsReminder('installed-id');
    assert.match(reminder,/edge:\/\/extensions/);assert.doesNotMatch(reminder,/chrome:\/\/extensions/);
  } finally {
    if(old)Object.defineProperty(globalThis,'navigator',old);else Reflect.deleteProperty(globalThis,'navigator');
  }
});
