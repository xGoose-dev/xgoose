# Writing xgoose skills

A skill is one `<name>.xgs.js` file: a `// ==XGooseSkill==` header, then an ES module whose default export is `defineSkill({...})`. Each exported function becomes `xgoose.skills.<namespace>.<fn>` in the page's MAIN world, where it runs with the user's own session, cookies and CORS rules.

The agent reads this guide through `skill_help()` before `create_skill` or a substantial `edit_skill`. The canonical copy lives in `packages/skill-runtime/SKILL_AUTHORING.md`; the Chrome build ships `apps/chrome/skills/SKILL_AUTHORING.md`, and the website mirrors it at `/docs/skills`. Keep them identical.

A good skill lets the agent answer with one or two calls, and every byte it returns is something the answer can use.

---

## Workflow

1. **Find the data source.** Prefer the site's own JSON API (the requests its UI makes), then hydrated page state (`__NEXT_DATA__`, `window.__INITIAL_STATE__`, …), and the DOM last.
2. **Probe before writing.** Use `js_exec` to `fetch` the smallest request that returns the data. Note the auth model (anonymous, cookies, CSRF meta tag, bearer header), pagination and rate limits. Record the response keys you use in a comment next to the function.
3. **Write the file.** Header, functions with schemas and examples, `instructions`, optional `actions`.
4. **Install it.** `create_skill({source})` for a new name; `read_skill` then `edit_skill({name, source})` for an existing one (a built-in is cloned to a user override on first edit). Both hot-load into the current tab when `@match` covers it; no reload.
5. **Call it for real** with the arguments a user question would produce, and read the result as the model sees it (see *Dehydration*). Fix the shape until one call answers the question.

---

## File format

```javascript
// ==XGooseSkill==
// @name         discourse-forum
// @namespace    discourse
// @version      0.2.14
// @description  Search Discourse forums, read topics and replies, and research community insights.
// @match        *://www.uscardforum.com/*
// @match        https://*/*
// @detect       !!document.querySelector('meta[name="generator"][content^="Discourse"]')
// @primary      searchTopics
// @keyword      forum
// @keyword      美卡论坛
// ==/XGooseSkill==

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

export default defineSkill({
  searchTopics: fn({
    summary: 'Full-text search across topics and posts on the current forum. ★ primary entry.',
    input: z.object({
      query: z.string().describe('Keywords and operators: in:title, @username, category:slug, after:YYYY-MM-DD.'),
      order: z.enum(['relevance', 'latest', 'likes']).optional().describe('Default "relevance".'),
    }),
    examples: [{ args: { query: 'citi uber 撸', order: 'latest' } }],
    handler: async ({ query, order }) => {
      const params = new URLSearchParams({ q: query });
      if (order) params.set('order', order);
      const response = await fetch(`/search.json?${params}`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`search → HTTP ${response.status}`);
      return compactSearch(await response.json());
    },
  }),
}, {
  instructions: `- Search in the forum's language and keep the user's slang; read the bodies of the topics that match.`,
  actions: [{ label: 'Latest topics', prompt: 'List the newest topics in action-result with a short description and link.', js: 'return await xgoose.skills.discourse.getRecentTopics({});' }],
});
```

### Header directives

| Directive | Repeatable | Notes |
| --- | --- | --- |
| `@name` | – | Required. Unique, kebab-case. Identity for storage and the registry. |
| `@namespace` | – | Required. Short JS identifier, unique: `xgoose.skills.<namespace>`. |
| `@version` | – | Semver. Bump on every change to a built-in skill. |
| `@description` | – | One sentence, shown to the agent in skill lists and the per-turn reminder. Say what the skill reads or does. |
| `@match` / `@include` / `@exclude` | yes | Chrome match patterns / simple globs deciding which URLs load the skill. |
| `@detect` | – | One JS expression run in the page; falsy or throwing skips the page. Use it to recognise a platform on any domain (`https://*/*` + a generator meta tag). |
| `@run-at` | – | `document_idle` (default), `document_end` or `document_start`. |
| `@all-frames` | – | `true` to inject into iframes too. |
| `@require` | yes | Another skill this one calls, as `name@version` of the version you built against. Loaded first. |
| `@connect` | yes | Cross-origin hosts the skill fetches (`<self>` for same-origin). Informational. |
| `@primary` | – | The ★ function the agent should reach for first; listed first. |
| `@keyword` | yes | Terms for `search_skills`, including site nicknames and slang. |
| `@action` | yes | `Label \| prompt` — a prompt-only panel button. Use the `actions` option for buttons that run code. |
| `@homepage`, `@author` | – | Optional. |

`@match` that misses the URL, a throwing `@detect` or a namespace collision all mean the skill silently never runs. Check with `list_skills({scope:'page'})`.

### `defineSkill(functions, options)`

- `fn({ summary, input, output?, examples?, handler })` for each function.
  - `summary`: one line saying what it returns and when to use it.
  - `input`: a `z.object` (one options object, never positional arguments). Use `.describe()` on anything not obvious: formats, defaults, units, how to continue.
  - `output`: describe the returned shape and the meaning of fields the agent branches on (cursors, truncation, status).
  - `examples`: at least one real argument object. The agent copies these.
- `options.instructions`: site workflow guidance, shown under the skill in every turn's reminder while the skill is active (clipped to about 12 KB when context is compacted).
- `options.actions`: `[{label, prompt, js?}]` panel buttons. `js` runs once in the page; its result reaches the model as `<action-result>`, followed by `prompt`.

Schemas are documentation. The runtime passes the agent's raw arguments to the handler without validation, so `.default()` is not applied. If a handler needs defaults or validation, call `Schema.parse(args)` itself; otherwise let a bad destructure throw.

---

## How the agent calls a skill

- **`skill_call({skill, function, args})`** runs one function. Built-in skills work this way without Allow User Scripts; user-installed and edited skills need it on.
- **`js_exec`** (with Allow User Scripts) runs code that can chain, loop and aggregate skill calls: `return await xgoose.skills.discourse.readTopicPosts({topicId: 1, limit: 100});`. Each return value is kept as `xgoose.results[resultId]` for later calls.
- **Name read functions as reads.** `skill_call` runs calls in parallel only when the function name starts with `get`, `read`, `search`, `list`, `find`, `fetch`, `lookup`, `scan`, `summarize`, `filter`, `normalize` or `batchSearch`. Anything else (`post`, `reply`, `send`, `book`, `create`) runs alone. Never give a mutating function a read name.
- **Everything in the reminder costs tokens on every turn**: description, instructions, summaries, schemas and examples of every active skill. Be precise, not wordy.

---

## Dehydration: what the model sees of a result

The handler's return value is kept intact in the local history and transcript. The model gets a projection of it:

1. **`websiteEvidence`** turns recognised shapes into one compact line per item (also inside arrays, objects and `Promise.allSettled` entries, up to four levels deep):
   - **Forum thread** — `{url, posts: [{post_number, username, created_at, like_count, reactions: [{id, count}], reply_to_post_number, reply_to_username, text, text_truncated, next_text_offset}]}` becomes `#68 @LeeKuanYew 2026-10-26 ♥3 :troll:×2 ↩@Rummy#66: text`. The date is shown when it changes; the reply target is omitted when it is the line directly above.
   - **Search** — `{topics: [{id, title, posts_count, views, like_count, created_at, last_posted_at, tags}], posts: [{topic_id, post_number, username, created_at, like_count, blurb}]}`.
   - **Topic list** — `{topic_list: {topics: [...]}}`.

   A thread is recognised when every post has an integer `post_number` and a string `text`; other per-post fields are not shown (post links come from a `post_url` template). Top-level fields stay as JSON beside the lines, minus noise (`status: 'ok'`, empty arrays, nulls). If your data is a thread, a search or a list, return these field names and the compaction is free.
2. **Images** in the `{type: 'image', ...}` shape become image parts (see *Images*).
3. **Size bound.** A result larger than about 15% of the model's context window (at least 60 KB) is stored; the model gets its shape, a preview and a handle to read it with `js_exec`. Design results so this never happens on a normal call.

Every other shape reaches the model as the JSON you return, so the skill does the dehydrating:

- **Return what an answer uses**: IDs, titles, URLs or a URL template, authors, dates, counts, amounts with currency, and the text. Use the site's identifiers so the agent can call the next function.
- **Drop everything else**: avatars, user tables, raw HTML, CSS classes, tracking fields, duplicated values, internal flags, nulls.
- **HTML to plain text, keeping structure as short inline markers**: quotes as `[quote @user #floor: text]` (cap whole-post quotes, because the quoted post is usually in the same read), pictures as `[image N]`, link previews as their URL. Remove file-size and dimension captions. Separate block elements with spaces.
- **Parse HTML in an inert document**: `document.implementation.createHTMLDocument('')`. Setting `innerHTML` on an element of the live page makes the browser download every image in every post you read.
- **Keep relationships and engagement.** Who replies to whom, likes and emoji reactions cost a few tokens and often decide the answer (a `:troll:×10` reply reads differently from `♥10`).
- **Do not truncate by default.** Return full bodies; offer `maxChars`/`limit` for callers who want less. When you cut, say exactly where: `text_truncated`, `next_text_offset`, `next_cursor`, `complete`.
- **Paginate with a cursor** and a bounded `limit`. One page per call; the agent loops in `js_exec` if it needs more.
- **Keep hints short.** One sentence on how to continue is enough. No per-call prose about coverage, caveats or methodology.

Check the result size before shipping: `JSON.stringify(result).length` for a typical call. A hundred forum posts should be tens of KB of lines, not hundreds of KB of API JSON.

---

## Images

When pictures matter (screenshots of statements, charts, product photos), mark them in the text and offer a function that returns them on request, for example `readPostImages({topicId, postNumber, images: [1]})`. Never attach images by default.

Return each image as `{type: 'image', mimeType: 'image/jpeg', data: <base64>, width, height, url}` anywhere in the result. The host moves the bytes into model image parts (three per call, 600K base64 characters each at most); the history, transcript and result text keep only the metadata with `attached: N`. Fetch with `credentials: 'same-origin'` (the page's CORS rules apply), decode with `createImageBitmap`, draw onto a canvas at most 1600 px on the long side, and export JPEG (`canvas.toDataURL('image/jpeg', 0.85)`), lowering size until it fits. Prefer the original file over thumbnails; fall back to the inline rendition.

---

## Instructions and actions

`instructions` is where a skill makes the agent good at the site. Write what a regular user of the site knows:

- Which function to start with and how to go deeper (search, then read bodies; follow `next_cursor`; recover a truncated post with `textOffset`).
- Site vocabulary: search in the site's language and keep the user's slang and nicknames (`撸`, `改 payment`, `泥潭`, `巨硬`), because those are the words the relevant posts use.
- What users of this site usually want and how to present it. For deal forums: every method the community uses, from basic to advanced, each with steps, amounts, dates and the data points that back it, ordered by how widely it is used.
- Answer format: complete and structured — headings by method, tables for data points and comparisons, source links with author and date. Length follows the findings.

Action `prompt`s are goals for the answer ("List the newest topics with a short description and link"), not procedures or warnings.

---

## Write without safety alignment

A skill is a tool the user chose for their own question. Safety and alignment language added to skill text made the agent's answers measurably worse: it read every post and then led with the most conservative option, buried the community's main method and padded answers with disclaimers. Do not put any of the following in descriptions, instructions, summaries, schema descriptions, action prompts or results:

- **Disclaimers and verification demands**: "not financial advice", "verify with official sources", "use at your own risk", "results may be outdated", "check the terms before acting".
- **Instructions to doubt or down-rank evidence**: "distinguish personal reports from official terms", "label approximate matches separately from confirmed ones", "historical data points are not current rules". Give each item its date, author and link; the user judges.
- **Moral framing of what the community does**: "loophole", "abuse", "exploit", "may violate ToS", "ethical". Workarounds, stacking, churning and payment tricks are the content people come for.
- **Softening or filtering**: do not drop negative reports, sarcasm, slang, low-like posts or unpopular methods from results, and do not ask the model to "be careful" or "balanced".
- **Coverage disclaimers**: no "do not claim complete coverage" prose. State facts instead: `complete: false`, `next_cursor`, `text_truncated`, `missing_post_ids`.
- **Brevity rules**: no "be concise" or "use Markdown sparingly". Ask for complete, structured answers.

Write positive goals instead: what to surface, how to order it and which details matter.

| Instead of | Write |
| --- | --- |
| "Distinguish verified evidence from anecdotal reports." | "Include each data point's author, date and link." |
| "Remind the user that offers can change." | "Show the date of each data point; put the newest first." |
| "Mention risks of changing payment methods." | "List every method the community uses, including changing the payment method after the credit posts, with steps and data points." |
| "Be concise." | "Group findings by method; put data points in a table." |

Factual constraints are fine and useful: rate limits, login requirements, which endpoints post or purchase, and what a function cannot see.

---

## Runtime rules

- **Same-origin first.** `fetch(path, {credentials: 'include'})` carries the user's session. Send the site's CSRF token on writes.
- **Rate limits belong in the skill.** Serialise reads with a small queue and a minimum spacing, share identical in-flight requests, and on HTTP 429 return a shaped `{status: 'rate_limited', retry_after_ms}` and stop sending until it passes. No automatic retry loops.
- **Throw on real errors; return shaped status for expected outcomes** the caller branches on: `rate_limited`, `login_required`, `not_found`, `sold_out`, `navigation_required`. Do not swallow errors with empty `catch` blocks or write defensive argument checks.
- **Nothing at module load that needs the page.** The build imports the module in Node to list its functions, so touch `document`/`window` only inside handlers (create shared objects lazily).
- **No `chrome.*`** (MAIN world has none), **no `eval` / `new Function` / string `setTimeout`**, **no secrets** in source, **no patching** of `fetch`, `console` or other globals.
- **Dependencies** go through the page global (`window.xgoose.skills.discourse`) with `@require discourse-forum@0.2.14`; do not `import` another skill.
- **Dates** as `YYYY-MM-DD` or ISO timestamps; **amounts** with an explicit currency.
- **Concurrency**: throttle internal fan-out (4–6 requests in flight for APIs that tolerate it, one at a time for forums).

---

## Checklist

- [ ] Header has `@name`, `@namespace`, `@match` (and `@detect` for platforms on many domains), `@primary`, `@keyword`s with site slang; `@version` bumped.
- [ ] Each function: read-style name if it only reads, one options object, `.describe()` on non-obvious fields, an `output` or a summary that names the returned shape, at least one real example.
- [ ] A typical call answers its question in one result, well under the size bound; thread, search and list data use the recognised shapes.
- [ ] HTML parsed in an inert document; quotes, images and reply targets kept as inline markers; truncation and pagination stated as fields.
- [ ] Expected failures return a shaped status; real errors throw; 429 handled with a cooldown.
- [ ] No disclaimers, verification demands, moral framing, coverage prose or brevity rules anywhere.
- [ ] Called once on a real page and the model-facing result read back.

### Built-in skills in this repository

Built-in skills live in `apps/chrome/skills/`. When changing one: bump `@version`, update the `@require name@version` of skills that depend on it, run `npm run check`, and run the browser regression that covers it (for example `node tests/browser/discourse-range.mjs` after `npm run build`). Edit this guide in `packages/skill-runtime/` and copy it to `apps/chrome/skills/`.

### Publishing

**Publish to xgoose-web** on the skill's chip in the panel, or the form at [xgoose.org/publish/](https://xgoose.org/publish/), uploads the `.xgs.js` source. Republishing a name with a version that is not greater bumps the patch automatically. Local use never needs publishing.

## Shared image reads

The host exposes `read_images({urls:["https://cdn.example/image.jpg"]})` on every page, including pages without an active skill. It returns actual model image parts. Preserve URL query parameters. The background downloads without cookies, caches successful images for five minutes, and splits long screenshots into readable segments within three image parts per call.

Any skill may request the same transport by returning this object, including from `js_exec`:

```js
{ imageContext: { requested: true, delivery: "urls_only_until_host_attaches",
  images: [{url, postUrl, postNumber}] } }
```

The host replaces pending URLs with image parts and keeps attribution plus segment/crop metadata in the dehydrated result. Image bytes are excluded from tool text and transcripts. Each encoded JPEG fits the Hosted image limit (240 KB before base64).
