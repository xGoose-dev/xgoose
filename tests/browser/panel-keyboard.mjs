import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const bundle = await build({
  stdin: {
    contents: "import {createPanel} from './packages/ui/src/panel.ts';window.panel=createPanel();panel.onSend(text=>window.sent.push(text));panel.open();",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1100, height: 800}});
  await page.setContent('<h1>Host page keyboard regression</h1><textarea id="site-composer" aria-label="Site composer"></textarea>');
  await page.evaluate(() => {
    window.sent = [];
    window.siteKeys = [];
    const composer = document.querySelector('#site-composer');
    // Discord-style type-to-focus: outside a native editable target, a
    // printable key focuses the site's composer. Shadow DOM retargets the
    // panel textarea to its DIV host at document-level listeners.
    for (const type of ['keydown', 'keypress', 'keyup']) {
      document.addEventListener(type, event => {
        window.siteKeys.push([type, event.key]);
        if (type === 'keydown' && event.key.length === 1 &&
            !event.ctrlKey && !event.metaKey &&
            !event.target.matches('textarea,input,[contenteditable="true"]')) {
          composer.focus();
        }
      });
    }
  });
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  const input = page.locator('#xgoose-root .in-text');
  await input.click();
  await input.pressSequentially('xgoose focus check');
  assert.equal(await input.evaluate(el => el.getRootNode().activeElement === el), true, 'Site stole focus');
  assert.equal(await input.inputValue(), 'xgoose focus check');
  assert.equal(await page.locator('#site-composer').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => window.siteKeys), []);

  await input.press('Shift+Enter');
  await input.pressSequentially('second line');
  assert.equal(await input.inputValue(), 'xgoose focus check\nsecond line');
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  assert.equal(await input.inputValue(), '');
  await input.fill('中文输入');
  // Enter while an IME is composing must not send the message or reach the site.
  await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', isComposing: true, bubbles: true, composed: true,
  })));
  assert.deepEqual(await page.evaluate(() => window.sent), []);
  await input.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.sent), ['中文输入']);
  assert.equal(await input.inputValue(), '');
  assert.deepEqual(await page.evaluate(() => window.siteKeys), []);

  // Other panel controls need the same boundary (search, toolbar shortcuts).
  await page.locator('#xgoose-root .btn-new').press('Space');
  assert.deepEqual(await page.evaluate(() => window.siteKeys), []);
  const site = page.locator('#site-composer');
  await site.click();
  await site.pressSequentially('site still works');
  assert.equal(await site.inputValue(), 'site still works');
  assert.ok((await page.evaluate(() => window.siteKeys)).length > 0);
  await input.click();
  await input.pressSequentially('Plugin keeps typing focus');
  assert.equal(await input.inputValue(), 'Plugin keeps typing focus');
  assert.equal(await site.inputValue(), 'site still works');
  const out = resolve('artifacts/keyboard');
  await mkdir(out, {recursive: true});
  await page.screenshot({path: resolve(out, 'panel-keyboard.png')});
  console.log('PASS: panel keyboard isolation, focus, shortcuts, IME, Enter, Shift+Enter and host typing');
} finally {
  await browser.close();
}
