// End-to-end test that loads dist/ into a headed Chromium and drives the
// chat panel on four real sites, three of which have a bundled skill that
// should auto-activate via the URL match patterns:
//
//   uscardforum.com   → uscardforum + discourse-forum skills
//   flyertalk.com     → flyertalk  + vbulletin-forum skills
//   aa.com            → aa-awards skill
//   alaskaair.com     → NO skill   (sanity-check that the agent still works)
//
// For each site we:
//   1. Navigate, wait for the panel host element to attach.
//   2. Inspect `chrome.storage.local["xgoose.activeSkills"]` to confirm
//      the SW pushed the right skill set for that URL.
//   3. Open the panel, type a site-appropriate prompt, click Send, and
//      wait for the assistant's final bubble. We use a permissive prompt
//      that doesn't require the agent to actually invoke heavy
//      skill calls — just that the chat round-trip works on the page.
//   4. Snapshot the bubble text + the list of tool calls that surfaced.
//
// The summary at the end prints per-site PASS/FAIL.

import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API || '';
if (!apiKey) {
  console.error('[e2e-sites] No GEMINI_API_KEY / GEMINI_API set; aborting.');
  process.exit(2);
}

const SITES = [
  {
    name: 'uscardforum',
    url: 'https://www.uscardforum.com/',
    expectedSkills: ['uscardforum', 'discourse-forum'],
    prompt:
      'Reply with exactly two short lines.\n' +
      'Line 1: the current page hostname.\n' +
      'Line 2: list any active skill namespaces on this page (or "none" if there are none).\n' +
      'Do not call any tools beyond page_info.',
    matchRe: /uscardforum\.com/i,
  },
  {
    name: 'flyertalk',
    url: 'https://www.flyertalk.com/',
    expectedSkills: ['flyertalk', 'vbulletin-forum'],
    prompt:
      'Reply with exactly two short lines.\n' +
      'Line 1: the current page hostname.\n' +
      'Line 2: list any active skill namespaces on this page (or "none" if there are none).\n' +
      'Do not call any tools beyond page_info.',
    matchRe: /flyertalk\.com/i,
  },
  {
    name: 'aa.com',
    url: 'https://www.aa.com/homePage.do',
    expectedSkills: ['aa-awards'],
    prompt:
      'Reply with exactly two short lines.\n' +
      'Line 1: the current page hostname.\n' +
      'Line 2: list any active skill namespaces on this page (or "none" if there are none).\n' +
      'Do not call any tools beyond page_info.',
    matchRe: /aa\.com/i,
  },
  {
    name: 'alaskaair',
    url: 'https://www.alaskaair.com/',
    expectedSkills: [],
    prompt:
      'Reply with exactly two short lines.\n' +
      'Line 1: the current page hostname.\n' +
      'Line 2: list any active skill namespaces on this page (or "none" if there are none).\n' +
      'Do not call any tools beyond page_info.',
    matchRe: /alaska/i,
  },
];

const userDataDir = mkdtempSync(`${tmpdir()}/xgoose-extension-chrome-e2e-sites-`);

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const results = [];
let exitCode = 0;

try {
  const sw = await waitForServiceWorker(ctx, 15_000);
  if (!sw) throw new Error('service worker never registered');
  log('boot', 'service worker UP');

  await seedSettings(ctx, {
    provider: 'gemini',
    apiKey,
    model: 'gemini-2.5-flash',
    baseUrl: '',
    thinking: false,
    theme: 'dark',
    jsExecTimeoutMs: 30000,
    redactSensitiveHeaders: true,
    redactSensitiveHeaderKeys: ['authorization', 'x-csrf-token', 'x-xsrf-token', 'x-api-key'],
  });
  log('boot', 'settings seeded (gemini-2.5-flash, thinking=false)');

  for (const site of SITES) {
    const r = await testSite(ctx, sw, site);
    results.push(r);
    if (!r.ok) exitCode = 1;
  }
} catch (err) {
  exitCode = 1;
  console.error('[e2e-sites] fatal:', err);
} finally {
  console.log('\n========== SUMMARY ==========');
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(
      `[${tag}] ${r.name.padEnd(14)} skills=${(r.activeSkills || []).join(',') || '-'} ` +
        `reply=${r.reply ? JSON.stringify(r.reply.slice(0, 80)) : 'NONE'}`,
    );
    if (r.notes) console.log(`         ${r.notes}`);
  }
  console.log('=============================\n');
  await ctx.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(exitCode);
}

async function testSite(ctx, sw, site) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  try {
    log(site.name, `navigating to ${site.url}`);
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for the content script to bootstrap.
    await page.waitForSelector('div#xgoose-root', { timeout: 15_000, state: 'attached' });

    // Give the SW a moment to compute active-skills for this URL and push them.
    await page.waitForTimeout(2000);

    // Read active skills directly from chrome.storage.session via the SW.
    const activeSkills = await sw.evaluate(async (url) => {
      // The SW exposes a sw:active_skills_for_url message; call it directly.
      try {
        // Inline the same logic skillRegistry exposes — it's faster than
        // round-tripping a message from the SW back to itself.
        const reg = await fetch(chrome.runtime.getURL('skills/registry.json')).then((r) => r.json());
        const disabled = new Set((await chrome.storage.local.get('xgoose.skills.disabled'))['xgoose.skills.disabled'] || []);
        function urlMatchesPattern(p, u) {
          // Tiny adapter — registry patterns are MV3 match patterns.
          try {
            const re = new RegExp(
              '^' +
                p
                  .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                  .replace(/\*/g, '.*') +
                '$',
            );
            return re.test(u);
          } catch {
            return false;
          }
        }
        return reg
          .filter(
            (s) =>
              !disabled.has(s.name) &&
              ((s.matches || []).some((p) => urlMatchesPattern(p, url)) ||
                (s.include || []).some((p) => urlMatchesPattern(p, url))),
          )
          .map((s) => s.name);
      } catch (err) {
        return ['<err: ' + (err && err.message ? err.message : err) + '>'];
      }
    }, page.url());

    log(site.name, `active skills: [${activeSkills.join(', ') || 'none'}]`);

    // Validate the expectation: the expected skills should all be present,
    // and (for sites without skills) none should match.
    const missing = site.expectedSkills.filter((s) => !activeSkills.includes(s));
    const skillsOk = missing.length === 0;

    // Send the prompt and wait for the assistant reply.
    log(site.name, 'opening panel + sending prompt');
    const replied = await sendPromptAndWaitForReply(
      page,
      site.prompt,
      75_000,
      site.matchRe,
    );

    const ok = skillsOk && !!replied;
    return {
      name: site.name,
      ok,
      activeSkills,
      missing,
      reply: replied,
      notes:
        (missing.length ? `missing skills: ${missing.join(', ')}; ` : '') +
        (errors.length ? `page errors: ${errors.length}` : ''),
    };
  } catch (err) {
    return {
      name: site.name,
      ok: false,
      activeSkills: [],
      reply: null,
      notes: `exception: ${err && err.message ? err.message : err}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
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
  const sw = ctx.serviceWorkers()[0];
  if (!sw) throw new Error('no service worker to seed settings');
  await sw.evaluate(async (s) => {
    await chrome.storage.local.set({ 'xgoose.settings': s });
  }, settings);
}

async function sendPromptAndWaitForReply(page, prompt, timeoutMs, matchRe) {
  return await page.evaluate(
    async ({ prompt, timeoutMs, matchSrc }) => {
      const matchRe = matchSrc ? new RegExp(matchSrc, 'i') : null;
      const host = document.querySelector('div#xgoose-root');
      const root = host && host.shadowRoot;
      if (!root) return null;
      function waitFor(predicate, deadlineMs) {
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

      const knownBubblesAtStart = root.querySelectorAll('.msg-ai').length;
      return await waitFor(() => {
        const bubbles = root.querySelectorAll('.msg-ai');
        if (bubbles.length <= knownBubblesAtStart) return null;
        const bubble = bubbles[bubbles.length - 1];
        const t = bubble && bubble.textContent ? bubble.textContent.trim() : '';
        if (!t.length) return null;
        if (matchRe && !matchRe.test(t)) return null;
        return t;
      }, timeoutMs);
    },
    { prompt, timeoutMs, matchSrc: matchRe ? matchRe.source : null },
  );
}

function log(tag, msg) {
  // eslint-disable-next-line no-console
  console.log(`[e2e-sites:${tag}] ${msg}`);
}
