import { imageDataUrl, prepareImage, type ImageAttachment } from "./images";

export type BugReportDraft = {
  description: string;
  includeTranscript: boolean;
  screenshot?: ImageAttachment;
};

export type BugReportTarget = {
  interrupted: boolean;
  hasTranscript: boolean;
  send: (draft: BugReportDraft) => Promise<{ id: string }>;
};

export const BUG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8M9 9V7a3 3 0 0 1 6 0v2M9 4 7 2m8 2 2-2M7 12 4 9m13 3 3-3M7 15H3m14 0h4M7 18l-3 3m13-3 3 3m-8-8v7"/><rect x="7" y="9" width="10" height="12" rx="5"/></svg>`;

export function createBugReportView(panel: HTMLElement) {
  const view = document.createElement("section");
  view.className = "bug-report";
  view.hidden = true;
  view.setAttribute("aria-labelledby", "bug-report-title");
  view.innerHTML = `
    <div class="bug-report-heading">
      <h2 id="bug-report-title">Report a bug</h2>
      <button type="button" class="hdr-icon-btn bug-report-close" aria-label="Back to chat" title="Back to chat">
        <svg class="hdr-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="bug-report-body">
      <label for="bug-description">What happened?</label>
      <textarea id="bug-description" rows="3" maxlength="1000"></textarea>
      <div class="bug-attachment">
        <button type="button" class="bug-control bug-attach">Add screenshot</button>
        <span class="bug-paste-hint">You can also paste an image.</span>
        <div class="bug-preview" hidden>
          <span class="bug-preview-media" role="img" aria-label="Screenshot preview"></span>
          <button type="button" class="bug-control bug-remove">Remove screenshot</button>
        </div>
      </div>
      <label class="bug-include"><input type="checkbox"><span>Include this conversation and run details</span></label>
      <p class="bug-privacy">xgoose administrators can see this report. It includes the extension version and site hostname.</p>
    </div>
    <div class="bug-report-footer">
      <p class="bug-feedback" role="status" hidden></p>
      <button type="button" class="bug-control bug-send">Send report</button>
    </div>
  `;
  panel.append(view);
  const find = <T extends HTMLElement>(selector: string) => view.querySelector<T>(selector)!;
  const body = find(".bug-report-body");
  const description = find<HTMLTextAreaElement>("textarea");
  const include = find<HTMLInputElement>(".bug-include input");
  const includeLabel = find(".bug-include");
  const closeButton = find<HTMLButtonElement>(".bug-report-close");
  const attachButton = find<HTMLButtonElement>(".bug-attach");
  const sendButton = find<HTMLButtonElement>(".bug-send");
  const preview = find(".bug-preview");
  // Keep the selected file and its image URL out of the page's open shadow tree.
  const media = find(".bug-preview-media").attachShadow({ mode: "closed" });
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp";
  file.hidden = true;
  const previewImage = document.createElement("img");
  previewImage.alt = "";
  previewImage.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
  media.append(file, previewImage);
  const pasteHint = find(".bug-paste-hint");
  const feedback = find(".bug-feedback");
  let target: BugReportTarget | undefined;
  let opener: HTMLElement | undefined;
  let screenshot: ImageAttachment | undefined;
  let processing = false;
  let sending = false;
  let sent = false;
  let generation = 0;

  function status(message: string, error = false) {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle("is-error", error);
  }

  function sync() {
    preview.hidden = !screenshot;
    pasteHint.hidden = !!screenshot;
    attachButton.hidden = !!screenshot;
    if (screenshot) previewImage.src = imageDataUrl(screenshot);
    else previewImage.removeAttribute("src");
    const ready = !!target?.interrupted || !!description.value.trim() || !!screenshot;
    sendButton.disabled = !sent && (sending || processing || !ready);
    body.inert = sending || sent;
    closeButton.disabled = sending;
  }

  function close(restoreFocus = true) {
    if (view.hidden || sending) return;
    generation++;
    view.hidden = true;
    panel.classList.remove("reporting");
    target = undefined;
    screenshot = undefined;
    previewImage.removeAttribute("src");
    if (restoreFocus) {
      const focusTarget = opener?.isConnected ? opener : panel.querySelector<HTMLElement>(".btn-bug");
      focusTarget?.focus();
    }
    opener = undefined;
  }

  function open(report: BugReportTarget, from: HTMLElement) {
    if (!view.hidden) return;
    target = report;
    opener = from;
    screenshot = undefined;
    processing = sent = false;
    description.value = "";
    file.value = "";
    include.checked = report.hasTranscript;
    includeLabel.hidden = !report.hasTranscript;
    body.hidden = false;
    sendButton.textContent = "Send report";
    status("");
    view.hidden = false;
    panel.classList.add("reporting");
    sync();
    closeButton.focus();
  }

  async function addImage(image: File) {
    const token = ++generation;
    processing = true;
    status("");
    sync();
    try {
      const prepared = await prepareImage(image);
      if (generation === token) screenshot = prepared;
    } catch (error) {
      if (generation === token) status(String((error as Error).message), true);
    } finally {
      if (generation === token) {
        processing = false;
        sync();
      }
    }
  }

  closeButton.addEventListener("click", () => close());
  view.addEventListener("keydown", event => {
    if (event.key === "Escape" && !sending) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  description.addEventListener("input", sync);
  attachButton.addEventListener("click", event => { if (event.isTrusted) file.click(); });
  file.addEventListener("change", event => {
    const image = file.files?.[0];
    if (event.isTrusted && image && target && !sending) void addImage(image);
    file.value = "";
  });
  view.addEventListener("paste", event => {
    const image = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith("image/"));
    if (!event.isTrusted || !image || !target || sending || sent) return;
    event.preventDefault();
    void addImage(image);
  });
  find(".bug-remove").addEventListener("click", () => {
    screenshot = undefined;
    sync();
    attachButton.focus();
  });

  sendButton.addEventListener("click", async event => {
    if (!event.isTrusted || !target || sending || processing) return;
    if (sent) { close(); return; }
    sending = true;
    status("Sending report…");
    sync();
    try {
      const result = await target.send({ description: description.value.trim(), includeTranscript: include.checked, screenshot });
      sent = true;
      body.hidden = true;
      status("Report sent.");
      // Keep the confirmation text translatable independently of the opaque ID.
      const reportId = document.createElement("code");
      reportId.textContent = result.id;
      feedback.append(reportId);
      sendButton.textContent = "Done";
    } catch (error) {
      status((error as Error).message || "Could not send the report. Try again.", true);
    } finally {
      sending = false;
      sync();
      if (sent) sendButton.focus();
    }
  });

  return { open, close };
}

export const BUG_REPORT_CSS = `
.btn-bug[hidden]{display:none}
.btn-bug svg{width:16px;height:16px}
.msg-recovery{max-width:38rem;align-self:flex-start;padding:9px 11px;border-radius:10px;background:var(--bg-hover);color:var(--text);font-size:var(--fs-sm);overflow-wrap:anywhere}
.msg-recovery .msg-err{margin:0;padding:0;border:0;background:transparent;color:inherit;max-width:none}
.recovery-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.bug-control{font:inherit;font-weight:600;padding:5px 9px;border:1px solid var(--border-input);border-radius:7px;color:var(--text);background:transparent;cursor:pointer}
.bug-control:hover:not(:disabled){background:var(--bg-hover);border-color:var(--border-strong)}
.bug-control:disabled{opacity:.5;cursor:default}
.bug-control:focus-visible,.bug-report textarea:focus-visible,.btn-bug:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.msgs > .msg-recovery:not(:last-child) .recovery-retry{display:none}
.recovery-detail{margin-top:5px;color:var(--text-muted);font-size:var(--fs-xs)}
.recovery-detail summary{cursor:pointer}
.recovery-detail .msg-err{margin-top:4px}
.recovery-report{border-color:transparent;color:var(--text-muted)}
.panel.reporting > :not(.hdr,.resize-handle,.bug-report){display:none}
.panel.reporting .hdr-tools,.panel.reporting .btn-new{display:none}
.bug-report{display:flex;flex:1;flex-direction:column;min-height:0;font-size:var(--fs-sm);overflow:auto;overscroll-behavior:contain}
.bug-report [hidden],.bug-report[hidden]{display:none}
.bug-report-heading,.bug-report-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px}
.bug-report-heading h2{margin:0;color:var(--text-strong);font-size:var(--fs-md);font-weight:650}
.bug-report-footer{margin-top:auto;border-top:1px solid var(--border);justify-content:flex-end}
.bug-report-body{padding:0 14px 12px;display:grid;align-content:start;gap:9px;color:var(--text)}
.bug-report-body > label{font-weight:600}
.bug-report textarea{width:100%;min-width:0;max-height:30vh;resize:vertical;padding:8px 10px;border:1px solid var(--border-input);border-radius:9px;background:var(--bg-input);color:var(--text);font:inherit;box-sizing:border-box}
.bug-attachment,.bug-preview,.bug-include{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.bug-include{flex-wrap:nowrap}
.bug-include input{accent-color:var(--accent);margin:0}
.bug-preview-media{width:72px;height:45px;overflow:hidden;border-radius:5px;border:1px solid var(--border)}
.bug-paste-hint,.bug-privacy,.bug-feedback{margin:0;color:var(--text-muted);font-size:var(--fs-xs)}
.bug-feedback{margin-right:auto;overflow-wrap:anywhere}
.bug-feedback code{display:block;margin-top:3px}
.bug-feedback.is-error{color:var(--err-text)}
.bug-send{white-space:nowrap;background:var(--accent);color:var(--on-accent);border-color:transparent}
.bug-send:hover:not(:disabled){background:var(--accent-hover);border-color:transparent}
@media (pointer:coarse){.bug-report textarea{font-size:max(16px,var(--fs-md))}}
`;
