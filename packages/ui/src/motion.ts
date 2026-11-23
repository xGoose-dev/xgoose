/** Pointer- and text-driven motion for the animated presets. These are the
 * techniques measured on Awwwards animation sites: split-text reveals, a pointer
 * follower, magnetic controls, pointer parallax, a running ticker and scramble. */
const EFFECTS: Record<string, string[]> = {
  aurora: ["words", "magnet", "parallax"],
  terminal: ["scramble", "ticker"],
  studio: ["words", "ticker", "parallax"],
  pop: ["words", "magnet", "cursor", "confetti"],
  noir: ["words", "cursor", "ticker", "spotlight"],
};
const GLYPHS = "!<>-_\\/[]{}=+*^?#01";
const SEPARATOR = "   /   ";

export function mountMotion(panel: HTMLElement): void {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const on = (effect: string) => !still.matches && !!EFFECTS[panel.dataset.xgPreset ?? ""]?.includes(effect);
  const cursor = document.createElement("div");
  cursor.className = "xg-cursor";
  const ticker = document.createElement("div");
  ticker.className = "xg-ticker";
  ticker.setAttribute("aria-hidden", "true");
  const tape = ticker.appendChild(document.createElement("span"));
  panel.append(cursor);
  panel.querySelector(".gen-bar")!.before(ticker);

  // Headings of a finished answer arrive word by word (character by character in CJK).
  function splitWords(root: Element): void {
    for (const heading of root.querySelectorAll<HTMLElement>("h1,h2,h3")) {
      if (heading.dataset.xgSplit || heading.children.length) continue;
      heading.dataset.xgSplit = "1";
      const text = heading.textContent ?? "";
      const parts = /\s/.test(text) ? text.split(/(\s+)/) : Array.from(text);
      heading.textContent = "";
      let index = 0;
      for (const part of parts) {
        if (!part.trim()) { heading.append(part); continue; }
        const word = document.createElement("span");
        word.className = "xg-w";
        word.style.setProperty("--i", String(index++));
        word.textContent = part;
        heading.append(word);
      }
    }
  }

  // The activity label decodes from noise into its text. A label that changes
  // while it decodes carries on toward the new text.
  const decoding = new Map<HTMLElement, { target: string; frame: number }>();
  const written = new WeakMap<HTMLElement, string>();
  function scramble(label: HTMLElement): void {
    const text = label.textContent ?? "";
    // Our own frames arrive here through the observer as well.
    if (!text || text === written.get(label)) return;
    const running = decoding.get(label);
    if (running) { running.target = text; running.frame = 0; return; }
    const state = { target: text, frame: 0 };
    decoding.set(label, state);
    const tick = () => {
      state.frame++;
      const done = state.frame * 2 >= state.target.length;
      const shown = done ? state.target : Array.from(state.target, (ch, i) => (i < state.frame * 2 || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
      written.set(label, shown);
      label.textContent = shown;
      if (done) decoding.delete(label);
      else requestAnimationFrame(tick);
    };
    tick();
  }

  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const label = target?.closest(".steps-label") as HTMLElement | null;
      if (label && on("scramble")) scramble(label);
      if (!on("words")) continue;
      for (const node of record.addedNodes) {
        const bubble = node instanceof Element ? node.closest(".msg-ai") : null;
        if (bubble) splitWords(bubble);
      }
    }
  }).observe(panel.querySelector(".msgs")!, { childList: true, subtree: true, characterData: true });

  // While a turn runs, its status scrolls past as a ticker.
  const loading = panel.querySelector(".loading-text") as HTMLElement;
  new MutationObserver(() => {
    const text = loading.textContent ?? "";
    ticker.classList.toggle("active", on("ticker") && !!text);
    tape.textContent = (text + SEPARATOR).repeat(8);
  }).observe(loading, { childList: true, characterData: true, subtree: true });

  // A dot trails the pointer and grows over controls; nearby buttons lean toward it.
  let x = 0, y = 0, cx = 0, cy = 0, frame = 0, pulled: HTMLElement | null = null;
  const follow = () => {
    cx += (x - cx) * 0.2;
    cy += (y - cy) * 0.2;
    cursor.style.transform = `translate(${cx}px,${cy}px)`;
    frame = Math.abs(x - cx) + Math.abs(y - cy) > 0.5 ? requestAnimationFrame(follow) : 0;
  };
  const release = () => { if (pulled) pulled.style.translate = ""; pulled = null; };
  panel.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const rect = panel.getBoundingClientRect();
    const target = event.target as Element;
    x = event.clientX - rect.left;
    y = event.clientY - rect.top;
    cursor.classList.toggle("active", on("cursor"));
    cursor.classList.toggle("over", !!target.closest("button,a,summary,.tool-hdr"));
    if (on("cursor") && !frame) frame = requestAnimationFrame(follow);
    if (on("spotlight")) {
      panel.style.setProperty("--xg-sx", `${x}px`);
      panel.style.setProperty("--xg-sy", `${y}px`);
    }
    if (on("parallax")) {
      panel.style.setProperty("--xg-px", String(x / rect.width - 0.5));
      panel.style.setProperty("--xg-py", String(y / rect.height - 0.5));
    }
    const magnet = on("magnet") ? (target.closest(".btn-send:not(:disabled),.btn-new") as HTMLElement | null) : null;
    if (pulled !== magnet) release();
    pulled = magnet;
    if (magnet) {
      const box = magnet.getBoundingClientRect();
      magnet.style.translate = `${(event.clientX - box.left - box.width / 2) * 0.3}px ${(event.clientY - box.top - box.height / 2) * 0.3}px`;
    }
  });
  panel.addEventListener("pointerleave", () => { cursor.classList.remove("active"); release(); });

  // Sending a message throws a handful of confetti from the Send button.
  panel.querySelector(".btn-send")!.addEventListener("click", (event) => {
    if (!on("confetti")) return;
    const rect = panel.getBoundingClientRect(), box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    for (let i = 0; i < 16; i++) {
      const piece = document.createElement("i");
      piece.className = "xg-confetti";
      const angle = Math.PI * (1 + Math.random()), reach = 40 + Math.random() * 90;
      piece.style.cssText = `left:${box.left - rect.left + box.width / 2}px;top:${box.top - rect.top}px;--dx:${Math.cos(angle) * reach}px;--dy:${Math.sin(angle) * reach}px;--r:${Math.random() * 540 - 270}deg;background:hsl(${Math.random() * 360} 90% 60%)`;
      piece.addEventListener("animationend", () => piece.remove());
      panel.append(piece);
    }
  });
}
