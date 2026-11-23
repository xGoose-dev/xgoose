import { mountBugReportForm } from "@xgoose/ui";
import { initializeLocale, translate } from "@/shared/locale";
import { send } from "@/shared/messages";

const view = document.querySelector<HTMLElement>(".bug-report")!;
const id = location.hash.slice(1);

async function close() {
  void send("sw:discard_bug_report", { id }).catch(() => {});
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
}

async function boot() {
  await initializeLocale(document.body);
  const draft = await send("sw:get_bug_report", { id });
  mountBugReportForm(view, {
    ...draft,
    close: () => { void close(); },
    send: submission => send("sw:bug_report", { id, ...submission }),
  });
}

void boot().catch(error => {
  const message = document.createElement("p");
  message.className = "bug-loading";
  message.setAttribute("role", "alert");
  message.textContent = translate((error as Error).message);
  const back = document.createElement("button");
  back.className = "bug-control";
  back.type = "button";
  back.textContent = translate("Back to chat");
  back.addEventListener("click", () => void close());
  message.append(" ", back);
  view.replaceChildren(message);
});
