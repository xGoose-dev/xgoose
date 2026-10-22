// End-to-end smoke test that loads dist/ into a headed Chromium and
// verifies the panel mounts on a real page.
//
// What we check (no API key required):
//   1. The extension's content script runs on example.com.
//   2. The floating launcher button is attached to the page (host element
//      `<div data-xgoose-shadow="1">` from @xgoose/ui's createPanel).
//   3. The MV3 service worker is alive (so the manifest, permissions, and
//      worker module-graph imports all resolved).
//   4. The MAIN-world bridge exposes `window.__xgoose` (proves the
//      manifest's `world: MAIN` entry + chrome.scripting fallback works).
//
// If GEMINI_API_KEY is set we additionally:
//   5. Seed it into chrome.storage.local so the panel's "set API key"
//      banner disappears, then send a trivial prompt and assert that the
//      assistant bubble receives at least one text-delta.

import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

const userDataDir = mkdtempSync(`${tmpdir()}/xgoose-extension-chrome-e2e-`);
let exitCode = 0;

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  // Persistent contexts ignore most -enable-* CLI flags; pass the two we
  // need for unpacked-extension loading via `args`.
  args: [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  // Wait for the service worker to register (gives chrome a beat to spin
  // up the extension's MV3 background).
  const sw = await waitForServiceWorker(ctx, 10_000);
  log('1. service worker', sw ? 'OK' : 'NOT FOUND');

  // Verify the skill registry is loaded in the SW (bundled built-in skills
  // from dist/skills/registry.json).
  if (sw) {
    const skillCount = await sw.evaluate(async () => {
      try {
        const url = chrome.runtime.getURL('skills/registry.json');
        const res = await fetch(url);
        if (!res.ok) return -1;
        const reg = await res.json();
        return Array.isArray(reg) ? reg.length : -1;
      } catch (err) {
        return -1;
      }
    });
    log(
      '1a. skill registry bundled',
      skillCount > 0 ? `OK (${skillCount} built-in skills)` : `MISSING (${skillCount})`,
    );
    if (skillCount <= 0) exitCode = 1;
  }

  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      // eslint-disable-next-line no-console
      console.log(`[page:${msg.type()}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => {
    // eslint-disable-next-line no-console
    console.log('[page:exception]', err.message);
  });
  // example.com is a quiet site that loads quickly and isn't blocked by
  // content_scripts exclude_matches.
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('div#xgoose-root', { timeout: 10_000, state: 'attached' });
  log('2. panel host element attached on page', 'OK');

  // MAIN-world bridge. window.__xgoose may be set either by the manifest
  // MAIN-world content_scripts entry (preferred) or by the fallback
  // chrome.scripting injection via the bridge loader port. Either is fine.
  const hasBridge = await page.evaluate(() => {
    return typeof window.__xgoose !== 'undefined';
  });
  log('3. window.__xgoose exposed in MAIN world', hasBridge ? 'OK' : 'MISSING');

  // Optional: live API smoke test.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API || '';
  if (apiKey) {
    await seedSettings(ctx, {
      provider: 'gemini',
      apiKey,
      model: 'gemini-2.5-flash',
      baseUrl: '',
      // gemini-2.5-flash rejects "thinking" mode; turn it off explicitly so
      // the e2e seeds a working config regardless of the schema default.
      thinking: false,
      theme: 'dark',
      jsExecTimeoutMs: 30000,
      redactSensitiveHeaders: true,
      redactSensitiveHeaderKeys: ['authorization', 'x-csrf-token', 'x-xsrf-token', 'x-api-key'],
    });
    // Reload so the content script picks up the seeded settings on bootstrap.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('div#xgoose-root', { timeout: 10_000, state: 'attached' });

    const replied = await sendPromptAndWaitForReply(
      page,
      'Reply with exactly the single word: pong. Do not call any tools.',
      45_000,
    );
    log('4. live LLM round-trip', replied ? `OK ("${replied.slice(0, 32)}")` : 'TIMEOUT');
    if (!replied) exitCode = 1;

    // Tool-using round trip: page_info should report the example.com URL.
    const reply2 = await sendPromptAndWaitForReply(
      page,
      'Call page_info, then reply with just the page URL on a single line.',
      60_000,
      /example\.com/,
    );
    log(
      '5. tool round-trip (page_info)',
      reply2 ? `OK ("${reply2.slice(0, 60)}")` : 'TIMEOUT',
    );
    if (!reply2) exitCode = 1;
  } else {
    log('4. live LLM round-trip', 'SKIPPED (set GEMINI_API_KEY to run)');
  }

  // Verify the options page renders.
  if (sw) {
    const optsHref = await sw.evaluate(() => chrome.runtime.getURL('options.html'));
    const optsPage = await ctx.newPage();
    await optsPage.goto(optsHref, { waitUntil: 'domcontentloaded' });
    // Give options.js a tick to populate the model dropdown.
    await optsPage.waitForFunction(
      () => {
        const m = document.getElementById('model');
        return m && m.tagName === 'SELECT' && m.options && m.options.length > 0;
      },
      { timeout: 5000 },
    );
    const result = await optsPage.evaluate(() => {
      const provider = document.getElementById('provider');
      const model = document.getElementById('model');
      const skillList = document.getElementById('skillList');
      const isSelect = model && model.tagName === 'SELECT';
      const optsCount = isSelect ? model.options.length : 0;
      const skillItems = skillList ? skillList.querySelectorAll('.skill-item').length : 0;
      return { provider: !!provider, model: !!model, skillList: !!skillList, isSelect, optsCount, skillItems };
    });
    const ok = result.provider && result.model && result.skillList && result.isSelect && result.optsCount > 0;
    log(
      '6. options page renders',
      ok
        ? `OK (model dropdown has ${result.optsCount} options, skill list has ${result.skillItems} items)`
        : `BROKEN (${JSON.stringify(result)})`,
    );
    if (!ok) exitCode = 1;
    await optsPage.close();
  }
} catch (err) {
  exitCode = 1;
  console.error('e2e error:', err);
} finally {
  await ctx.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(exitCode);
}

async function waitForServiceWorker(ctx, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sw = ctx.serviceWorkers()[0];
  while (!sw && Date.now() < deadline) {
    sw = await Promise.race([
      ctx.waitForEvent('serviceworker', { timeout: 500 }).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 500)),
    ]);
    if (!sw) sw = ctx.serviceWorkers()[0];
  }
  return sw;
}

async function seedSettings(ctx, settings) {
  // Drive chrome.storage.local from the service-worker context, which has
  // unrestricted access. Content-script context cannot directly write
  // chrome.storage from an arbitrary http page via page.evaluate.
  const sw = ctx.serviceWorkers()[0];
  if (!sw) throw new Error('no service worker to seed settings');
  await sw.evaluate(async (s) => {
    await chrome.storage.local.set({ 'xgoose.settings': s });
  }, settings);
}

async function sendPromptAndWaitForReply(page, prompt, timeoutMs, matchRe) {
  // Reach into the shadow root that @xgoose/ui mounts.
  // Drive the panel through the shadow root that @xgoose/ui mounts.
  // The host's class names are owned by @xgoose/ui:
  //   .toggle    — the floating launcher button
  //   .in-text   — the prompt textarea
  //   .btn-send  — the send button
  //   .msg-ai    — assistant bubble
  const replyText = await page.evaluate(
    async ({ prompt, timeoutMs, matchSrc }) => {
      const matchRe = matchSrc ? new RegExp(matchSrc, 'i') : null;
      const host = document.querySelector('div#xgoose-root');
      const root = host && host.shadowRoot;
      if (!root) return null;
      async function waitFor(predicate, deadlineMs) {
        const deadline = Date.now() + deadlineMs;
        return new Promise((resolve) => {
          const tick = () => {
            const v = predicate();
            if (v) return resolve(v);
            if (Date.now() > deadline) return resolve(null);
            requestAnimationFrame(tick);
          };
          tick();
        });
      }
      const toggle = root.querySelector('.toggle');
      toggle && toggle.click();

      const ta = await waitFor(() => root.querySelector('.in-text'), 3000);
      const sendBtn = root.querySelector('.btn-send');
      if (!ta || !sendBtn) return null;
      ta.value = prompt;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      sendBtn.click();

      // Watch the LAST assistant bubble in the panel (each turn appends
      // a new .msg-ai). When a `matchRe` is provided, wait until the
      // text actually matches it — otherwise wait for any non-empty
      // text. This lets a tool-using turn settle through the tool call
      // before we read the final assistant text.
      const knownBubblesAtStart = root.querySelectorAll('.msg-ai').length;
      const got = await waitFor(() => {
        const bubbles = root.querySelectorAll('.msg-ai');
        if (bubbles.length <= knownBubblesAtStart) return null;
        const bubble = bubbles[bubbles.length - 1];
        const t = bubble && bubble.textContent ? bubble.textContent.trim() : '';
        if (!t.length) return null;
        if (matchRe && !matchRe.test(t)) return null;
        return t;
      }, timeoutMs);
      return got;
    },
    { prompt, timeoutMs, matchSrc: matchRe ? matchRe.source : null },
  );
  return replyText;
}

function log(label, status) {
  // eslint-disable-next-line no-console
  console.log(`[e2e] ${label}: ${status}`);
}
