# Shared model image transport

`read_images({urls})` is a host tool on every page. Skills can use the same path by returning `imageContext` with `requested:true`, `delivery:'urls_only_until_host_attaches'` and `images:[{url,postUrl?,postNumber?}]`. Both `skill_call` and `js_exec` attach pending images before dehydration.

The background reads HTTPS image URLs with cookies omitted, preserves signed query strings, decodes JPEG/PNG/WebP/GIF, and emits JPEG model parts. Long screenshots split into up to three segments with original dimensions and crop coordinates. Every part is at most 240,000 encoded bytes (before base64), matching the current Hosted per-image request limit. Metadata stays in tool text; image bytes travel only in image parts.

Successful downloads cache for five minutes (eight entries), with in-flight deduplication. New downloads serialize with 250 ms spacing and budgets of 60 per minute / 600 per hour; HTTP 429 honors Retry-After with at least a minute of cooldown. Each tool call has up to three URLs / image parts, a 10 MB download cap, 20 second fetch timeout, and 40 megapixel decoded image cap.

Validation: typecheck, the full existing suite plus focused image tests, and `node tests/browser/tieba-images.mjs`. The browser regression uses a synthetic Tieba document and a real Baidu CDN image (1828×3466); it asserts that a mock model endpoint receives two 1828×1733 JPEG parts through (1) the direct tool on Tieba, (2) the direct tool on an unrelated page with no skill, and (3) a Tieba skill return. Every part satisfies the current Hosted image data-URL size limit. This verifies transport, not real-model OCR accuracy. Results and screenshot are in `artifacts/tieba-images/`.

No website, gateway, model routing or billing deployment is required for this change. Installed extensions need a background update/reload; updating the online skill alone does not add the shared host tool.
