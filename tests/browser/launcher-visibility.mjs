import {chromium} from '@playwright/test';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(resolve(tmpdir(), 'xgoose-launcher-'));
const dist = resolve('apps/chrome/dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.evaluate(() => chrome.storage.local.set({
    'xgoose.settings': {language: 'en', analyticsEnabled: false, launcherVisibility: 'always'},
  }));
  await settings.reload();
  const pages = [];
  for (const host of ['www.youtube.com', 'plain.example.test']) {
    await context.route(`https://${host}/**`, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Launcher fixture</title><h1>Video page</h1><video controls></video>',
    }));
    const page = await context.newPage();
    await page.goto(`https://${host}/`);
    await page.locator('#xgoose-root .toggle').waitFor();
    pages.push(page);
  }
  const video = pages[0];
  await video.locator('.toggle').click();
  await video.locator('.in-text').fill('Keep this draft');
  await settings.locator('#launcherVisibility').selectOption('never');
  await settings.locator('#saveBtn').click();
  await settings.waitForFunction(async () => (await chrome.storage.local.get('xgoose.settings'))['xgoose.settings'].launcherVisibility === 'never');
  assert.equal(await video.locator('.panel').isVisible(), true, 'changing preference preserves open chat');
  await video.locator('.btn-close').click();
  for (const page of pages) await page.locator('.toggle').waitFor({state: 'hidden'});
  // Deliver the same content message sent by the toolbar action.
  await settings.evaluate(async () => {
    const [tab] = await chrome.tabs.query({url: 'https://www.youtube.com/'});
    await chrome.tabs.sendMessage(tab.id, {kind: 'cs:toggle_panel'});
  });
  await video.locator('.panel').waitFor();
  assert.equal(await video.locator('.in-text').inputValue(), 'Keep this draft');
  await video.locator('.btn-close').click();
  await video.locator('.toggle').waitFor({state: 'hidden'});
  await video.reload();
  await video.locator('#xgoose-root').waitFor({state: 'attached'});
  assert.equal(await video.locator('.toggle').isVisible(), false, 'hidden preference survives reload on a skill site');
  await settings.reload();
  assert.equal(await settings.locator('#launcherVisibility').inputValue(), 'never');
  await settings.locator('#launcherVisibility').selectOption('skill-sites');
  await settings.locator('#saveBtn').click();
  await video.locator('.toggle').waitFor();
  assert.equal(await pages[1].locator('.toggle').isVisible(), false, 'skill-sites still hides ordinary pages');
  await settings.locator('#launcherVisibility').selectOption('always');
  await settings.locator('#saveBtn').click();
  for (const page of pages) await page.locator('.toggle').waitFor();

  await video.bringToFront();
  // A site fullscreen layer should cover an otherwise visible launcher.
  // Use hit testing: display:none would conceal a stacking regression.
  const covered = () => video.evaluate(() => {
    const root = document.querySelector('#xgoose-root');
    const target = root.shadowRoot.querySelector('.panel.open') ?? root.shadowRoot.querySelector('.toggle');
    const r = target.getBoundingClientRect();
    return document.elementFromPoint(r.x+r.width/2, r.y+r.height/2) !== root;
  });
  await video.evaluate(() => {
    const player = document.createElement('div'); player.id = 'site-player';
    player.style.cssText = 'position:fixed;inset:0;z-index:2000;background:black';
    const button = document.createElement('button'); button.id = 'enter-fullscreen';
    button.textContent = 'Fullscreen'; button.onclick = () => document.documentElement.requestFullscreen();
    player.append(button); document.body.append(player);
  });
  assert.equal(await video.locator('.toggle').isVisible(), true, 'launcher stays rendered under the site overlay');
  assert.equal(await covered(), true, 'ordinary site layer covers launcher');
  await video.locator('#enter-fullscreen').click();
  await video.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await video.locator('.toggle').isVisible(), true, 'fullscreen does not change launcher display');
  assert.equal(await covered(), true, 'document-root fullscreen player covers launcher');
  await video.evaluate(() => document.exitFullscreen());
  await video.locator('#site-player').evaluate(el => el.remove());
  assert.equal(await covered(), false, 'launcher is reachable when the player is gone');
  await video.evaluate(() => {
    const button = document.createElement('button'); button.id = 'enter-fullscreen';
    button.textContent = 'Fullscreen'; button.onclick = () => document.querySelector('video').requestFullscreen();
    document.body.append(button);
  });
  await video.locator('#enter-fullscreen').click();
  await video.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await covered(), true, 'native video top layer covers launcher');
  await video.evaluate(() => document.exitFullscreen());
  await video.locator('#enter-fullscreen').evaluate(el => el.remove());
  assert.equal(await covered(), false);
  await video.locator('.toggle').click();
  await video.locator('.in-text').fill('Draft survives fullscreen');
  await video.evaluate(() => {
    const player = document.createElement('div'); player.id = 'site-player';
    player.style.cssText = 'position:fixed;inset:0;z-index:2000;background:black';
    const button = document.createElement('button'); button.id = 'enter-fullscreen';
    button.textContent = 'Fullscreen'; button.onclick = () => document.documentElement.requestFullscreen();
    player.append(button); document.body.append(player);
  });
  await video.locator('#enter-fullscreen').click();
  await video.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await video.locator('.panel').isVisible(), true, 'open chat stays rendered beneath fullscreen');
  assert.equal(await covered(), true, 'site fullscreen covers the panel');
  await video.evaluate(() => document.exitFullscreen());
  await video.locator('#site-player').evaluate(el => el.remove());
  assert.equal(await covered(), false);
  assert.equal(await video.locator('.in-text').inputValue(), 'Draft survives fullscreen');
  await video.locator('.btn-close').click();
  await mkdir('artifacts/launcher', {recursive: true});
  await settings.screenshot({path: 'artifacts/launcher/settings.png', fullPage: true});
  console.log(JSON.stringify({passed: true, savedNever: true, existingTabs: 2, toolbarOpensHidden: true, nativeFullscreen: ['html', 'video'], draftPreserved: true}));
} finally {
  await context.close(); await rm(profile, {recursive: true, force: true});
}
