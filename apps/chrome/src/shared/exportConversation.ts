// Turn a StoredConversation into a human-readable export. Two formats:
//   • Markdown  – debugging-friendly linear dump. Every message is rendered
//                in stream order with its index + role + parts. Reasoning
//                ("thinking") blocks are inlined as blockquotes (not
//                collapsed). Tool calls show their toolCallId and full
//                input. Tool results live in their own role:'tool' sections
//                (not folded into the assistant turn) so the export
//                matches the actual on-the-wire message order. System
//                reminders are included with a marker so you can see what
//                context the agent had. Each message also has a "Raw JSON"
//                <details> at the end so absolutely nothing is dropped.
//   • JSON      – the raw stored shape (one conversation per file) for
//                programmatic re-import or diffing

import type { StoredConversation } from "./types";

function fence(value: unknown, lang = "json"): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  // Escape any closing fence inside the body so the outer fence stays valid.
  const safe = text.replace(/```/g, "\u200b```");
  return "```" + lang + "\n" + safe + "\n```";
}

function plainTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts: string[] = [];
  for (const p of content as any[]) {
    if (
      p &&
      typeof p === "object" &&
      p.type === "text" &&
      typeof p.text === "string"
    ) {
      parts.push(p.text);
    }
  }
  return parts.join("");
}

function byteSize(value: unknown): number {
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

function blockQuote(text: string): string {
  if (!text) return "> _(empty)_";
  return text
    .split("\n")
    .map((line) => "> " + line)
    .join("\n");
}

// Render the "extra" fields on a part (anything that isn't the standard
// type/text/toolName/input/output triad). Useful for debugging because
// providers sometimes hang extra metadata off parts (e.g. cache markers,
// reasoning signatures) that we want to preserve in the export.
function renderExtraFields(
  p: Record<string, unknown>,
  knownKeys: string[],
): string[] {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (knownKeys.includes(k)) continue;
    if (v === undefined) continue;
    extras[k] = v;
  }
  if (Object.keys(extras).length === 0) return [];
  return ["_extra fields:_", "", fence(extras), ""];
}

export function conversationToMarkdown(conv: StoredConversation): string {
  const lines: string[] = [];
  const messages = Array.isArray(conv.messages) ? (conv.messages as any[]) : [];

  // ── header + summary stats ──────────────────────────────────────────────
  lines.push(`# ${conv.title || "Untitled conversation"}`);
  lines.push("");
  lines.push(`- **Origin:** ${conv.origin || "unknown"}`);
  lines.push(`- **Conversation id:** \`${conv.id}\``);
  if (conv.createdAt)
    lines.push(`- **Created:** ${new Date(conv.createdAt).toISOString()}`);
  if (conv.updatedAt)
    lines.push(`- **Updated:** ${new Date(conv.updatedAt).toISOString()}`);

  const counts = {
    user: 0,
    reminders: 0,
    assistant: 0,
    tool: 0,
    system: 0,
    other: 0,
  };
  const toolUsage: Record<string, number> = {};
  let totalToolCalls = 0;
  let totalReasoningChars = 0;
  for (const m of messages) {
    const r = m?.role;
    if (r === "user") {
      counts.user++;
      const t = plainTextFromContent(m.content);
      if (t.startsWith("<system-reminder>")) counts.reminders++;
    } else if (r === "assistant") {
      counts.assistant++;
      const c = m?.content;
      if (Array.isArray(c)) {
        for (const p of c) {
          if (p?.type === "tool-call") {
            totalToolCalls++;
            const name = String(p.toolName ?? p.name ?? "tool");
            toolUsage[name] = (toolUsage[name] ?? 0) + 1;
          } else if (p?.type === "reasoning" && typeof p.text === "string") {
            totalReasoningChars += p.text.length;
          }
        }
      }
    } else if (r === "tool") {
      counts.tool++;
    } else if (r === "system") {
      counts.system++;
    } else if (r) {
      counts.other++;
    }
  }
  const roleSummary = [
    `${counts.user} user`,
    counts.reminders ? `(of which ${counts.reminders} <system-reminder>)` : "",
    `${counts.assistant} assistant`,
    `${counts.tool} tool`,
    counts.system ? `${counts.system} system` : "",
    counts.other ? `${counts.other} other` : "",
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(`- **Messages:** ${messages.length} total — ${roleSummary}`);
  if (totalToolCalls > 0) {
    const breakdown = Object.entries(toolUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `\`${n}\`×${c}`)
      .join(", ");
    lines.push(`- **Tool calls:** ${totalToolCalls} (${breakdown})`);
  }
  if (totalReasoningChars > 0) {
    lines.push(
      `- **Reasoning emitted:** ${totalReasoningChars.toLocaleString()} chars`,
    );
  }
  const usage = (conv as any).usage;
  if (usage && typeof usage === "object" && usage.totalTokens > 0) {
    const pieces: string[] = [];
    pieces.push(`${usage.totalTokens.toLocaleString()} total`);
    pieces.push(
      `input ${usage.inputTokens?.toLocaleString?.() ?? usage.inputTokens}`,
    );
    if (usage.cachedInputTokens > 0) {
      const pct =
        usage.inputTokens > 0
          ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
          : 0;
      pieces.push(
        `cached ${usage.cachedInputTokens.toLocaleString()} (${pct}%)`,
      );
    }
    pieces.push(
      `output ${usage.outputTokens?.toLocaleString?.() ?? usage.outputTokens}`,
    );
    if (usage.reasoningTokens > 0) {
      pieces.push(`reasoning ${usage.reasoningTokens.toLocaleString()}`);
    }
    let usageLine = `- **Usage:** ${pieces.join(", ")} · ${usage.turns} turn${usage.turns === 1 ? "" : "s"}`;
    if (usage.costUsd > 0) {
      const marker = usage.unpricedTurns > 0 ? "*" : "";
      usageLine += ` · ~$${usage.costUsd.toFixed(4)}${marker}`;
    }
    lines.push(usageLine);
  }
  lines.push("");
  lines.push(
    "> Debug export — every message is shown in original stream order. Tool " +
      "results live in their own `role:tool` sections, not folded into the " +
      "assistant turn, so the ordering matches what the AI SDK actually saw. " +
      "Each section also has a `Raw JSON` `<details>` block at the end with " +
      "the full unmodified message in case the rendered view dropped any field.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── per-message dump ────────────────────────────────────────────────────
  messages.forEach((msg, idx) => {
    const headingIdx = `[${idx}]`;
    if (!msg || typeof msg !== "object") {
      lines.push(`## ${headingIdx} (malformed)`);
      lines.push("");
      lines.push(fence(msg));
      lines.push("");
      return;
    }

    const role = String(msg.role ?? "unknown");

    if (role === "user") {
      const text = plainTextFromContent(msg.content);
      const isReminder = text.startsWith("<system-reminder>");
      lines.push(
        `## ${headingIdx} ${isReminder ? "User · <system-reminder>" : "User"}`,
      );
      lines.push("");
      if (isReminder) {
        lines.push(
          "> Volatile per-turn context the agent saw (URL, active skills, site memory, todos). " +
            "NOT persisted into the next turn's baseline — the panel rebuilds this fresh each turn. " +
            "Shown here for debug visibility.",
        );
        lines.push("");
      }
      if (typeof msg.content === "string") {
        lines.push(msg.content || "_(empty)_");
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (
            p &&
            typeof p === "object" &&
            p.type === "text" &&
            typeof p.text === "string"
          ) {
            lines.push(p.text);
          } else {
            lines.push(fence(p));
          }
        }
      } else {
        lines.push(fence(msg.content));
      }
      lines.push("");
      appendRawJsonBlock(lines, msg);
      return;
    }

    if (role === "assistant") {
      lines.push(`## ${headingIdx} Assistant`);
      if (msg.id) lines.push(`- **message id:** \`${msg.id}\``);
      lines.push("");
      const c = msg.content;
      if (typeof c === "string") {
        lines.push(c || "_(empty)_");
        lines.push("");
        appendRawJsonBlock(lines, msg);
        return;
      }
      if (!Array.isArray(c)) {
        lines.push(fence(c));
        lines.push("");
        appendRawJsonBlock(lines, msg);
        return;
      }
      // Render each part in order so the export reflects the actual stream
      // sequence: e.g. "reasoning → tool-call → text → tool-call → text".
      let partIdx = 0;
      for (const p of c as any[]) {
        partIdx++;
        if (!p || typeof p !== "object") {
          lines.push(`### Part ${partIdx} — (malformed)`);
          lines.push("");
          lines.push(fence(p));
          lines.push("");
          continue;
        }
        const type = String(p.type ?? "unknown");
        if (type === "text" && typeof p.text === "string") {
          lines.push(`### Part ${partIdx} — Text`);
          lines.push("");
          lines.push(p.text || "_(empty)_");
          lines.push("");
          lines.push(...renderExtraFields(p, ["type", "text"]));
        } else if (type === "reasoning" && typeof p.text === "string") {
          lines.push(
            `### Part ${partIdx} — Thinking (\`reasoning\`, ${p.text.length} chars)`,
          );
          lines.push("");
          lines.push(blockQuote(p.text));
          lines.push("");
          lines.push(...renderExtraFields(p, ["type", "text"]));
        } else if (type === "tool-call") {
          const name = String(p.toolName ?? p.name ?? "tool");
          const callId = String(p.toolCallId ?? p.id ?? "");
          lines.push(`### Part ${partIdx} — Tool call \`${name}\``);
          if (callId) lines.push(`- **toolCallId:** \`${callId}\``);
          const input = p.input ?? p.args ?? {};
          lines.push(
            `- **input size:** ${byteSize(input)} bytes (when JSON-encoded)`,
          );
          lines.push("");
          lines.push("**Input:**");
          lines.push("");
          lines.push(fence(input));
          lines.push("");
          if (callId) {
            lines.push(
              `_Result delivered in a subsequent \`role:'tool'\` message — search this file for toolCallId \`${callId}\`._`,
            );
            lines.push("");
          }
          lines.push(
            ...renderExtraFields(p, [
              "type",
              "toolName",
              "name",
              "toolCallId",
              "id",
              "input",
              "args",
            ]),
          );
        } else {
          lines.push(`### Part ${partIdx} — \`${type}\` (unknown)`);
          lines.push("");
          lines.push(fence(p));
          lines.push("");
        }
      }
      appendRawJsonBlock(lines, msg);
      return;
    }

    if (role === "tool") {
      lines.push(`## ${headingIdx} Tool (results)`);
      lines.push("");
      const parts = Array.isArray(msg.content) ? msg.content : [];
      if (parts.length === 0) {
        lines.push("_(no parts)_");
        lines.push("");
      }
      let partIdx = 0;
      for (const p of parts as any[]) {
        partIdx++;
        if (!p || typeof p !== "object") {
          lines.push(`### Part ${partIdx} — (malformed)`);
          lines.push("");
          lines.push(fence(p));
          lines.push("");
          continue;
        }
        const callId = String(p.toolCallId ?? p.id ?? "");
        const name = String(p.toolName ?? p.name ?? "tool");
        const isError = p.type === "tool-error" || p.error != null;
        const status = isError ? "✖ error" : "✓ done";
        lines.push(`### Part ${partIdx} — \`${name}\` ${status}`);
        if (callId) lines.push(`- **toolCallId:** \`${callId}\``);
        if (isError) {
          const err = p.error;
          const errMsg =
            typeof err === "string" ? err : (err?.message ?? String(err));
          lines.push("");
          lines.push("**Error:**");
          lines.push("");
          lines.push(fence(errMsg, "text"));
          if (err && typeof err === "object" && (err as any).stack) {
            lines.push("");
            lines.push("**Stack:**");
            lines.push("");
            lines.push(fence(String((err as any).stack), "text"));
          }
          lines.push("");
          lines.push(
            ...renderExtraFields(p, [
              "type",
              "toolName",
              "name",
              "toolCallId",
              "id",
              "error",
            ]),
          );
        } else {
          const output = p.output ?? p.result;
          lines.push(
            `- **output size:** ${byteSize(output)} bytes (when JSON-encoded)`,
          );
          lines.push("");
          lines.push("**Output:**");
          lines.push("");
          lines.push(fence(output));
          lines.push("");
          lines.push(
            ...renderExtraFields(p, [
              "type",
              "toolName",
              "name",
              "toolCallId",
              "id",
              "output",
              "result",
            ]),
          );
        }
      }
      appendRawJsonBlock(lines, msg);
      return;
    }

    // Unknown role — dump raw.
    lines.push(`## ${headingIdx} ${role}`);
    lines.push("");
    lines.push(fence(msg));
    lines.push("");
  });

  lines.push("---");
  lines.push("");
  lines.push(`_Exported by xgoose on ${new Date().toISOString()}_`);
  return lines.join("\n");
}

function appendRawJsonBlock(lines: string[], msg: unknown): void {
  lines.push("<details><summary>Raw JSON</summary>");
  lines.push("");
  lines.push(fence(msg));
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

export function conversationToJson(conv: StoredConversation): string {
  return JSON.stringify(conv, null, 2);
}

// Suggested file name (safe across mac/iOS/linux/windows) for a conversation.
export function conversationFilename(
  conv: StoredConversation,
  ext: "md" | "json",
): string {
  const ts = new Date(conv.updatedAt || conv.createdAt || Date.now())
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const slug =
    (conv.title || "conversation")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "conversation";
  return `xgoose_${ts}_${slug}.${ext}`;
}
