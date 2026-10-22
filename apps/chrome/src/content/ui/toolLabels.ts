// Chrome-host tool-label registrations. Universal labels (page_info,
// js_exec, todo_write, …) ship with `@xgoose/ui`; the skill-registry
// tools (list_skills, search_skills, read_skill, help, skill_call,
// edit_skill) are unique to the host JS-with-skills setup so they're
// registered here.
//
// Side-effect on import: calling `registerToolLabels(...)` once at
// content-script bootstrap is enough — the @xgoose/ui panel reads
// the registry every time it renders a tool card.

import { registerToolLabels } from "@xgoose/ui";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

registerToolLabels({
  list_skills: {
    icon: "📚",
    iconClass: "list",
    label: "List skills",
    summarize: (output: any) => {
      if (Array.isArray(output)) {
        const active = output.filter((s: any) => s?.activeOnThisPage).length;
        return `${output.length} skills · ${active} active here`;
      }
      return "ok";
    },
  },
  read_skill: {
    icon: "📖",
    iconClass: "list",
    label: "Read skill",
    argKey: "name",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: `Read skill: ${input?.name ?? "?"}`,
      subtitle: "",
    }),
    summarize: (output: any) => {
      const src = output?.source;
      if (typeof src === "string")
        return `${src.length} chars · ${output?.origin ?? "unknown"}`;
      return "ok";
    },
  },
  search_skills: {
    icon: "🔍",
    iconClass: "search",
    label: "Search skills",
    argKey: "query",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: "Search skills",
      subtitle: input?.query ? truncate(String(input.query), 60) : "",
    }),
    summarize: (output: any) =>
      Array.isArray(output)
        ? `${output.length} match${output.length === 1 ? "" : "es"}`
        : "ok",
  },
  help: {
    icon: "❓",
    iconClass: "list",
    label: "Help",
    argKey: "skill",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: `Help: ${input?.skill ?? "?"}${input?.function ? `.${input.function}` : ""}`,
      subtitle: "",
    }),
    summarize: (output: any) => {
      const help = output?.help;
      const src = output?.source;
      if (help && typeof help === "object") {
        const fnCount = help.name ? 1 : Object.keys(help).length;
        return `${fnCount} fn${fnCount === 1 ? "" : "s"} · ${src ?? "unknown"}`;
      }
      return "ok";
    },
  },
  skill_call: {
    icon: "🪄",
    iconClass: "code",
    label: "Call skill",
    argKey: "function",
    describe: (input, m) => {
      const skill = input?.skill ?? "?";
      const fn = input?.function ?? "?";
      const args =
        input?.args && typeof input.args === "object" ? input.args : null;
      let sub = "";
      if (args) {
        const entries = Object.entries(args).slice(0, 2);
        sub = entries
          .map(([k, v]) => `${k}=${truncate(JSON.stringify(v), 30)}`)
          .join(" · ");
      }
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: `${skill}.${fn}()`,
        subtitle: sub,
      };
    },
    summarize: (output: any) => {
      const r = output?.result ?? output;
      if (typeof r === "string") return `${r.length} chars`;
      if (Array.isArray(r)) return `${r.length} items`;
      if (r && typeof r === "object") return `${Object.keys(r).length} keys`;
      return "ok";
    },
  },
  edit_skill: {
    icon: "✏️",
    iconClass: "code",
    label: "Edit skill",
    argKey: "name",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: `Edit skill: ${input?.name ?? "?"}`,
      subtitle:
        typeof input?.source === "string" ? `${input.source.length} chars` : "",
    }),
    summarize: (output: any) =>
      output?.ok
        ? `saved ${output.name}@${output.version}${output.bodyChanged ? " · body changed" : ""}`
        : "error",
  },
  skill_help: {
    icon: "📘",
    iconClass: "list",
    label: "Read skill authoring spec",
    summarize: (output: any) => {
      if (output?.ok && typeof output.length === "number") {
        return `${(output.length / 1024).toFixed(1)} KB spec`;
      }
      return output?.ok ? "ok" : "error";
    },
  },
  create_skill: {
    icon: "🆕",
    iconClass: "code",
    label: "Create skill",
    describe: (input, m) => {
      let nameGuess = "?";
      if (typeof input?.source === "string") {
        const m2 = /@name\s+(\S+)/.exec(input.source);
        if (m2) nameGuess = m2[1];
      }
      const size =
        typeof input?.source === "string" ? `${input.source.length} chars` : "";
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: `Create skill: ${nameGuess}`,
        subtitle: size,
      };
    },
    summarize: (output: any) =>
      output?.ok
        ? `created ${output.name}@${output.version}`
        : `error: ${truncate(String(output?.error ?? ""), 60)}`,
  },
});
