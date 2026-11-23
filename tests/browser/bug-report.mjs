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
        if (reportFixture.modelRequests.length === 3) {
          return new Response(frame({
            role: "assistant", content: "I will read the page first.",
            tool_calls: [{ index: 0, id: "read-fixture", type: "function", function: {
              name: "read_page", arguments: JSON.stringify({ format: "text" }),
            } }],
          }) + frame({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
        }
        if (reportFixture.modelRequests.length === 4) {
          return new Response(frame({ role: "assistant" }) + frame({}, "stop") + "data: [DONE]\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        if (reportFixture.modelRequests.length > 4) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frame({ content: "Partial departure reply" })));
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
        }
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
  async function openReport(trigger) {
    const opened = context.waitForEvent("page");
    await trigger.click();
    const report = await opened;
    await report.waitForURL(/chrome-extension:\/\/[^/]+\/bug-report\.html#/);
    await expect(report.getByRole("heading", { name: "Report a bug" })).toBeVisible();
    return report;
  }
  const sendReport = report => report.getByRole("button", { name: "Send report", exact: true });
  async function submitAndClose(report) {
    await sendReport(report).click();
    await expect(report.getByText("Report sent.", { exact: false })).toBeVisible();
    await Promise.all([report.waitForEvent("close"), report.getByRole("button", { name: "Done", exact: true }).click()]);
  }
  const initialTabs = context.pages().length;
  await bugButton.evaluate(button => button.click());
  assert.equal(context.pages().length, initialTabs, "page-script clicks cannot open the private report editor");

  let report = await openReport(bugButton);
  await expect(sendReport(report)).toBeDisabled();
  const screenshotPath = resolve(profile, "fixture.png");
  await page.screenshot({ path: screenshotPath });
  await report.locator(".bug-file").setInputFiles(screenshotPath);
  await expect(report.getByAltText("Screenshot preview")).toBeVisible();
  await expect(page.locator(".bug-file, #bug-description")).toHaveCount(0);
  await submitAndClose(report);

  await page.locator(".in-text").fill("Finish my fixture task");
  await page.locator(".btn-send").click();
  await expect(page.locator(".msg-recovery")).toContainText("Fixture connection interrupted");
  await expect(page.locator(".btn-stop")).toBeHidden();
  await page.locator(".panel").screenshot({ path: resolve(artifacts, "interrupted.png") });
  const firstRecovery = page.locator(".recovery-report").first();
  report = await openReport(firstRecovery);
  await expect(report.getByRole("checkbox", { name: "Include this conversation and run details" })).toBeChecked();
  await submitAndClose(report);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".msg-ai")).toContainText("Task continued from the saved conversation.");
  await expect(page.locator(".btn-stop")).toBeHidden();
  await expect(page.locator(".msg-user")).toHaveCount(1);

  report = await openReport(bugButton);
  await report.setViewportSize({ width: 375, height: 730 });
  await report.getByLabel("What happened?").fill("The provider stopped on the previous turn.");
  await expect(sendReport(report)).toBeInViewport();
  await report.screenshot({ path: resolve(artifacts, "manual-mobile.png") });
  await submitAndClose(report);

  report = await openReport(firstRecovery);
  await report.getByRole("checkbox", { name: "Include this conversation and run details" }).uncheck();
  await submitAndClose(report);

  await page.locator(".in-text").fill("Read the page and give a final answer");
  await page.locator(".btn-send").click();
  await expect(page.locator(".msg-ai").last()).toContainText("I will read the page first.");
  await expect(page.locator(".msg-recovery").last()).toContainText("stopped without a final answer");
  await expect(page.locator(".btn-stop")).toBeHidden();

  report = await openReport(firstRecovery);
  await submitAndClose(report);

  const { uploads, modelRequests } = await worker.evaluate(() => reportFixture);
  assert.equal(uploads.length, 5);
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
  assert.equal(uploads[3].diagnostics.failure, "Agent turn interrupted.");
  assert.equal(uploads[3].diagnostics.sessionId, undefined);
  assert.equal(modelRequests.length, 4);
  assert.match(JSON.stringify(modelRequests[1].messages), /Continue the interrupted user task/);
  const historicalEvents = uploads[4].diagnostics.events;
  assert.ok(historicalEvents.some(event => event.type === "run-end" && event.runId === uploads[1].diagnostics.runId));
  assert.doesNotMatch(JSON.stringify(uploads[4].diagnostics), /Read the page and give a final answer/);
  async function prompt(text) {
    await page.locator(".in-text").fill(text);
    await page.locator(".btn-send").click();
  }
  // Drive pagehide/pageshow twice to cover resumed lifecycle handlers and pending prompts.
  const departureMessage = page.locator(".recovery-message").filter({ hasText: "The page closed before the agent finished." });
  for (const departure of [1, 2]) {
    await prompt(`Start departure turn ${departure}`);
    await expect.poll(() => worker.evaluate(() => reportFixture.modelRequests.length)).toBe(4 + departure);
    await expect(page.locator(".msg-ai").last()).toContainText("Partial departure reply");
    await prompt(`This queued prompt must be discarded ${departure}`);
    await expect(page.locator(".queued-pill")).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(departureMessage).toHaveCount(departure);
    await expect(page.locator(".queued-pill")).toHaveCount(0);
    await expect(page.locator(".btn-stop")).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  }
  assert.equal(await worker.evaluate(() => reportFixture.modelRequests.length), 6);
  console.log("Private report editor, diagnostics, terminal answer, retry and repeatable departure passed.");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
