import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(resolve(tmpdir(), "xgoose-bug-report-"));
const dist = resolve("apps/chrome/dist");
const artifacts = resolve("artifacts/bug-report");
await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, colorScheme: "light", viewport: { width: 1100, height: 850 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
context.setDefaultTimeout(20_000);

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await expect.poll(() => worker.evaluate(() => !!chrome.storage?.local)).toBe(true);
  await worker.evaluate(async () => {
    const original = fetch;
    globalThis.reportFixture = { uploads: [], modelRequests: [] };
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const { hostname, pathname } = new URL(request.url);
      if (hostname === "api.xgoose.org") {
        if (pathname === "/bug-reports") {
          const report = await request.json();
          reportFixture.uploads.push(report);
          return Response.json({ id: report.id }, { status: 201 });
        }
        return Response.json({ items: [], acknowledged: [] });
      }
      if (hostname === "model.fixture.test") {
        reportFixture.modelRequests.push(await request.json());
        if (reportFixture.modelRequests.length === 1) {
          return Response.json({ error: { message: "Fixture connection interrupted" } }, {
            status: 400, headers: { "X-Request-Id": "fixture-provider-request" },
          });
        }
        const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        return new Response(frame({ content: "Task continued from the saved conversation." }) + frame({}, "stop") + "data: [DONE]\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return original(input, init);
    };
    await chrome.storage.local.set({
      "xgoose.settings": {
        language: "en", provider: "openai-compat", model: "fixture-model", thinking: false, analyticsEnabled: false,
        launcherVisibility: "always", apiKeys: { "openai-compat": "fixture-key" },
        baseUrls: { "openai-compat": "https://model.fixture.test/v1" },
      },
    });
  });

  await context.route("https://report.fixture.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Bug report fixture</title><h1>Example page</h1>",
  }));
  const page = await context.newPage();
  await page.goto("https://report.fixture.test/?token=never-send-query");
  await page.locator(".toggle").click();
  const bugButton = page.locator(".btn-bug");
  const sendReport = page.getByRole("button", { name: "Send report", exact: true });
  await bugButton.click();
  await expect(sendReport).toBeDisabled();
  const screenshotPath = resolve(profile, "fixture.png");
  await page.screenshot({ path: screenshotPath });
  const chooseFile = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add screenshot" }).click();
  await (await chooseFile).setFiles(screenshotPath);
  await expect(page.getByRole("img", { name: "Screenshot preview" })).toBeVisible();
  await sendReport.evaluate(button => button.click());
  assert.equal(await worker.evaluate(() => reportFixture.uploads.length), 0, "page-script clicks cannot submit a report");
  await sendReport.click();
  await expect(page.getByText("Report sent.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.locator(".in-text").fill("Finish my fixture task");
  await page.locator(".btn-send").click();
  await expect(page.locator(".msg-recovery")).toContainText("Fixture connection interrupted");
  await expect(page.locator(".btn-stop")).toBeHidden();
  await page.locator(".panel").screenshot({ path: resolve(artifacts, "interrupted.png") });
  await page.locator(".recovery-report").click();
  await expect(page.getByRole("checkbox", { name: "Include this conversation and run details" })).toBeChecked();
  await sendReport.click();
  await expect(page.getByText("Report sent.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".msg-ai")).toContainText("Task continued from the saved conversation.");
  await expect(page.locator(".btn-stop")).toBeHidden();
  await expect(page.locator(".msg-user")).toHaveCount(1);

  await page.setViewportSize({ width: 375, height: 730 });
  await bugButton.click();
  await page.getByLabel("What happened?").fill("The provider stopped on the previous turn.");
  await expect(sendReport).toBeInViewport();
  await page.locator(".panel").screenshot({ path: resolve(artifacts, "manual-mobile.png") });
  await sendReport.click();
  await expect(page.getByText("Report sent.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await bugButton.click();
  await page.getByLabel("What happened?").fill("A report without the conversation.");
  await page.getByRole("checkbox", { name: "Include this conversation and run details" }).uncheck();
  await sendReport.click();
  await expect(page.getByText("Report sent.", { exact: false })).toBeVisible();

  const { uploads, modelRequests } = await worker.evaluate(() => reportFixture);
  assert.equal(uploads.length, 4);
  assert.match(uploads[0].screenshot.data, /^\/9j\//);
  assert.equal(uploads[1].kind, "interrupted");
  assert.equal(uploads[1].diagnostics.state, "interrupted");
  assert.match(uploads[1].diagnostics.failure, /Fixture connection interrupted/);
  assert.match(JSON.stringify(uploads[1].diagnostics.events), /fixture-provider-request/);
  assert.equal(uploads[2].kind, "manual");
  assert.equal(uploads[2].hostname, "report.fixture.test");
  assert.doesNotMatch(JSON.stringify(uploads[2]), /never-send-query|fixture-key/);
  assert.match(JSON.stringify(uploads[2].diagnostics.messages), /Task continued/);
  assert.deepEqual(uploads[3].diagnostics.messages, []);
  assert.deepEqual(uploads[3].diagnostics.events, []);
  assert.equal(uploads[3].diagnostics.sessionId, undefined);
  assert.equal(modelRequests.length, 2);
  assert.match(JSON.stringify(modelRequests[1].messages), /Continue the interrupted user task/);
  console.log("Bug report UI, screenshot, diagnostics and retry passed.");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
