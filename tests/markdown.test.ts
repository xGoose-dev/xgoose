import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderMarkdown } from "../packages/ui/src/markdown.ts";

test("every streamed table prefix terminates, including incomplete header rows", () => {
  // A synchronous renderer loop blocks Node's test timeout too. Isolate it so
  // regressions fail within a bounded time instead of hanging the test runner.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { renderMarkdown } from "./packages/ui/src/markdown.ts";
    const text = "Introduction\\n\\n| Card | Coverage |\\n| --- | --- |\\n| A | B |\\n\\nDone.";
    for (let i = 1; i <= text.length; i++) renderMarkdown(text.slice(0, i));
    assert.equal(renderMarkdown("| Unfinished table |"), "<p>| Unfinished table |</p>");
    assert.equal(renderMarkdown("Intro\\n| literal pipes |\\nMore text"), "<p>Intro<br>| literal pipes |<br>More text</p>");
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 8000 });
  assert.equal(result.error, undefined, `Renderer failed or hung: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
});

test("complete tables still render separately from surrounding paragraphs", () => {
  assert.equal(
    renderMarkdown("Intro\n| Card | Coverage |\n| --- | :---: |\n| A | B |\nDone."),
    "<p>Intro</p>\n<table><thead><tr><th>Card</th><th>Coverage</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>\n<p>Done.</p>",
  );
});

test("code fence metadata cannot break out of the language class attribute", () => {
  const html = renderMarkdown('```js" onclick="alert(1)\n<img src=x onerror=alert(1)>\n```');
  assert.equal(html, '<pre><code class="lang-js&quot; onclick=&quot;alert(1)">&lt;img src=x onerror=alert(1)&gt;</code></pre>');
  assert(!html.includes(' onclick="'));
  assert(!html.includes("<img"));
  assert.equal(renderMarkdown("```typescript\nconst x = 1;\n```"), '<pre><code class="lang-typescript">const x = 1;</code></pre>');
});
