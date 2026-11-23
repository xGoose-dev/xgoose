import { imageDataUrl, prepareImage, type ImageAttachment } from "./images";

export type BugReportFormData = {
  description: string;
  includeTranscript: boolean;
  screenshot?: { data: string };
};

type ReportFormOptions = {
  interrupted: boolean;
  hasTranscript: boolean;
  send: (draft: BugReportFormData) => Promise<{ id: string }>;
  close: () => void;
};

export const BUG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8M9 9V7a3 3 0 0 1 6 0v2M9 4 7 2m8 2 2-2M7 12 4 9m13 3 3-3M7 15H3m14 0h4M7 18l-3 3m13-3 3 3m-8-8v7"/><rect x="7" y="9" width="10" height="12" rx="5"/></svg>`;

export function mountBugReportForm(view: HTMLElement, options: ReportFormOptions) {
  view.innerHTML = `
    <header class="bug-heading">
      <button class="bug-control bug-close" type="button">← <span>Back to chat</span></button>
      <h1>Report a bug</h1>
    </header>
    <div class="bug-body">
      <label for="bug-description">What happened?</label>
      <textarea id="bug-description" rows="4" maxlength="1000"></textarea>
      <input class="bug-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      <div class="bug-attachment">
        <button type="button" class="bug-control bug-attach">Add screenshot</button>
        <span class="bug-paste-hint">You can also paste an image.</span>
        <div class="bug-preview" hidden>
          <img alt="Screenshot preview">
          <button type="button" class="bug-control bug-remove">Remove screenshot</button>
        </div>
      </div>
      <label class="bug-include"><input type="checkbox"><span>Include this conversation and run details</span></label>
      <p class="bug-privacy">xgoose administrators can see this report. It includes the extension version and site hostname.</p>
    </div>
    <footer class="bug-footer">
      <p class="bug-feedback" role="status"></p>
      <button type="button" class="bug-control bug-send">Send report</button>
    </footer>
  `;
  const find = <T extends HTMLElement>(selector: string) => view.querySelector<T>(selector)!;
  const body = find(".bug-body");
  const description = find<HTMLTextAreaElement>("textarea");
  const file = find<HTMLInputElement>(".bug-file");
  const include = find<HTMLInputElement>(".bug-include input");
  const close = find<HTMLButtonElement>(".bug-close");
  const attach = find<HTMLButtonElement>(".bug-attach");
  const submit = find<HTMLButtonElement>(".bug-send");
  const preview = find(".bug-preview");
  const image = find<HTMLImageElement>("img");
  const pasteHint = find(".bug-paste-hint");
  const feedback = find(".bug-feedback");
  let screenshot: ImageAttachment | undefined;
  let processing = false;
  let sending = false;
  let sent = false;
  let generation = 0;
  include.checked = options.hasTranscript;
  find(".bug-include").hidden = !options.hasTranscript;

  function status(message: string, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", error);
  }

  function sync() {
    preview.hidden = !screenshot;
    pasteHint.hidden = !!screenshot;
    attach.hidden = !!screenshot;
    const ready = options.interrupted || !!description.value.trim() || !!screenshot;
    submit.disabled = !sent && (sending || processing || !ready);
    body.inert = sending || sent;
    close.disabled = sending;
  }

  async function addImage(file: File) {
    const token = ++generation;
    processing = true;
    status("");
    sync();
    try {
      const prepared = await prepareImage(file);
      if (generation !== token) return;
      screenshot = prepared;
      image.src = imageDataUrl(prepared);
    } catch (error) {
      if (generation === token) status((error as Error).message, true);
    } finally {
      if (generation === token) {
        processing = false;
        sync();
      }
    }
  }

  close.addEventListener("click", options.close);
  view.addEventListener("keydown", event => {
    if (event.key === "Escape" && !sending) options.close();
  });
  description.addEventListener("input", sync);
  attach.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    if (file.files?.[0] && !sending) void addImage(file.files[0]);
    file.value = "";
  });
  view.addEventListener("paste", event => {
    const screenshot = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith("image/"));
    if (!screenshot || sending || sent) return;
    event.preventDefault();
    void addImage(screenshot);
  });
  find(".bug-remove").addEventListener("click", () => {
    screenshot = undefined;
    image.removeAttribute("src");
    sync();
    attach.focus();
  });

  submit.addEventListener("click", async () => {
    if (sent) { options.close(); return; }
    if (submit.disabled) return;
    sending = true;
    status("Sending report…");
    sync();
    try {
      const result = await options.send({
        description: description.value.trim(),
        includeTranscript: include.checked,
        screenshot: screenshot && { data: screenshot.data },
      });
      sent = true;
      body.hidden = true;
      status("Report sent.");
      const reportId = document.createElement("code");
      reportId.textContent = result.id;
      feedback.append(reportId);
      submit.textContent = "Done";
    } catch (error) {
      status((error as Error).message || "Could not send the report. Try again.", true);
    } finally {
      sending = false;
      sync();
      submit.focus();
    }
  });
  sync();
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
`;
