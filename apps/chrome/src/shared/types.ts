import { z } from "zod";
import {
  ProviderSchema as CoreProviderSchema,
  type Provider as CoreProvider,
} from "@xgoose/core";
import {
  SkillHeaderSchema,
  type SkillHeader,
} from "@xgoose/skill-runtime/types";

// ---------------------------------------------------------------------------
// Theme — local to the chrome host (CoreSettings does not own theme).
// ---------------------------------------------------------------------------

export const ThemeSchema = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof ThemeSchema>;

// ---------------------------------------------------------------------------
// Provider — local SUPERSET of @xgoose/core's ProviderSchema. Adds the
// `'xgoose-hosted'` literal which lets the host route AI traffic through
// the signed-in user's xgoose.org account token instead of a self-supplied
// provider API key. The host wrapper in `createAgent.ts` collapses this
// virtual provider back to `'openai-compat'` (the wire format the
// xgoose-web worker actually speaks) before handing off to core, so core
// never has to know about it. This is the only way to add a host-specific
// provider without modifying @xgoose/core (which we deliberately don't).
// ---------------------------------------------------------------------------

export const ProviderSchema = z.enum([
  ...CoreProviderSchema.options,
  "xgoose-hosted",
]);
export type Provider = z.infer<typeof ProviderSchema>;
export type { CoreProvider };

/** Base URL of the xgoose-web AI gateway (OpenAI Chat Completions wire
 *  format). The Google `@ai-sdk/openai` library will append `/v1` to this
 *  if not already present. We pass it verbatim and let the SDK normalise.
 *  See `~/xgoose/xgoose-web/worker/src/routes/ai.ts` for the receiver. */
export const XGOOSE_HOSTED_AI_BASE_URL = "https://api.xgoose.org/ai";

// ---------------------------------------------------------------------------
// Settings — superset of @xgoose/core's CoreSettings.
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  provider: ProviderSchema.default("gemini"),
  // Per-provider credentials. Each provider has its OWN slot — switching
  // the dropdown reveals the key that belongs to that provider, instead
  // of leaking (and accidentally re-using) the previous provider's key.
  // The legacy flat `apiKey` / `baseUrl` fields below are kept for
  // backward compatibility with installs that predate this change and
  // are migrated into these maps on first load (`loadAll` in
  // `shared/storage.ts`). All runtime reads should go through the
  // `getProviderApiKey` / `getProviderBaseUrl` helpers in `./types`.
  apiKeys: z.record(z.string(), z.string()).default({}),
  baseUrls: z.record(z.string(), z.string()).default({}),
  apiKey: z.string().default(""),
  model: z.string().default("gemini-2.5-pro"),
  baseUrl: z.string().default(""),
  thinking: z.boolean().default(true),
  theme: ThemeSchema.default("system"),
  jsExecTimeoutMs: z.number().int().min(1000).max(600_000).default(30_000),
  redactSensitiveHeaders: z.boolean().default(true),
  redactSensitiveHeaderKeys: z
    .array(z.string())
    .default(["authorization", "x-csrf-token", "x-xsrf-token", "x-api-key"]),
  /**
   * When the floating ✦ launcher button is shown:
   *   - "always"      → on every page (today's behaviour; the default so
   *                     existing installs are unaffected).
   *   - "skill-sites" → only on pages where at least one enabled skill
   *                     matches. An already-open chat panel is never hidden.
   * Gated by the content script via `active_skills_for_url`.
   */
  launcherVisibility: z.enum(["always", "skill-sites"]).default("always"),
  /**
   * Share anonymous, opt-out usage analytics (Google Analytics for Firebase).
   * On by default; flipping this off in the options page stops all event
   * collection. No ad identifiers are ever collected. See `shared/analytics.ts`.
   */
  analyticsEnabled: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Read the API key for the active (or a specified) provider. Falls back
 *  to the legacy flat `apiKey` slot if the map doesn't have an entry yet
 *  — covers the brief window between migration and the user re-saving. */
export function getProviderApiKey(s: Settings, provider?: Provider): string {
  const p = provider ?? s.provider;
  const fromMap = s.apiKeys?.[p];
  if (typeof fromMap === "string" && fromMap.length > 0) return fromMap;
  // Only fall back to the legacy field for the currently-selected
  // provider — if `p` is something else we have no way to tell whether
  // the legacy field actually belongs to that provider.
  if (p === s.provider) return s.apiKey ?? "";
  return "";
}

/** Symmetric helper for the per-provider base URL. Same fallback shape. */
export function getProviderBaseUrl(s: Settings, provider?: Provider): string {
  const p = provider ?? s.provider;
  const fromMap = s.baseUrls?.[p];
  if (typeof fromMap === "string" && fromMap.length > 0) return fromMap;
  if (p === s.provider) return s.baseUrl ?? "";
  return "";
}

export const ALWAYS_REDACTED_HEADER_KEYS: ReadonlyArray<string> = [
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "proxy-authenticate",
];

// ---------------------------------------------------------------------------
// Layout — floating button + panel positioning.
// ---------------------------------------------------------------------------

export const CornerSchema = z.enum(["br", "bl", "tr", "tl"]);
export type Corner = z.infer<typeof CornerSchema>;

export const LayoutSchema = z.object({
  buttonCorner: CornerSchema.default("br"),
  buttonOffset: z
    .object({
      h: z.number().min(0).max(2000).default(20),
      v: z.number().min(0).max(2000).default(20),
    })
    .default({ h: 20, v: 20 }),
  panelCorner: CornerSchema.default("br"),
  panelSize: z
    .object({
      w: z.number().min(320).max(2000).default(460),
      h: z.number().min(400).max(2000).default(640),
    })
    .default({ w: 460, h: 640 }),
});
export type Layout = z.infer<typeof LayoutSchema>;
export const DEFAULT_LAYOUT: Layout = LayoutSchema.parse({});

// ---------------------------------------------------------------------------
// Skill registry — mirrored verbatim from xgoose-safari/src/shared/types.ts.
// ---------------------------------------------------------------------------

export { SkillHeaderSchema };
export type { SkillHeader };

export const SkillFnSummarySchema = z.object({
  name: z.string(),
  summary: z.string().default(""),
  signature: z.string().default(""),
  /** Copy-pasteable `js_exec` snippet, e.g. `await xgoose.skills.discourse.searchTopics({...})`. */
  invocation: z.string().default(""),
  /**
   * Full input / output JSON Schemas + worked examples — shipped in the
   * per-turn system reminder so the agent doesn't need a `help()` round
   * trip for active skills. Built-in skills always populate these
   * (computed at build time via `__describe__()`); user skills bundled
   * inside the extension SW may omit them (static introspection can't
   * extract Zod schemas), in which case the reminder gracefully falls
   * back to the schema-unavailable hint.
   */
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  examples: z
    .array(
      z.object({
        args: z.unknown(),
        note: z.string().optional(),
        returns: z.unknown().optional(),
      }),
    )
    .optional(),
  primary: z.boolean().default(false),
});
export type SkillFnSummary = z.infer<typeof SkillFnSummarySchema>;

export const RegistrySkillSchema = SkillHeaderSchema.extend({
  filePath: z.string(),
  functions: z.array(SkillFnSummarySchema).default([]),
  /** Agent-facing usage guidance from `defineSkill(spec, { instructions })`,
   *  surfaced in the per-turn system reminder under the skill heading. */
  instructions: z.string().optional(),
  sha: z.string().default(""),
  /**
   * Content fingerprint for user skills — populated from `UserSkill.updatedAt`
   * so the content-script-side injection cache can detect when a user skill's
   * bundle has changed and force a re-inject. Undefined for built-in skills
   * (their content is addressed by `filePath` / `sha` instead).
   */
  updatedAt: z.number().int().optional(),
});
export type RegistrySkill = z.infer<typeof RegistrySkillSchema>;

export type StoredSkill = RegistrySkill & { enabled?: boolean };

export const UserSkillSchema = SkillHeaderSchema.extend({
  source: z.string().min(1),
  bundled: z.string().min(1),
  functions: z.array(SkillFnSummarySchema).default([]),
  instructions: z.string().optional(),
  createdAt: z
    .number()
    .int()
    .default(() => Date.now()),
  updatedAt: z
    .number()
    .int()
    .default(() => Date.now()),
});
export type UserSkill = z.infer<typeof UserSkillSchema>;

// ---------------------------------------------------------------------------
// Conversation persistence (matches xgoose-safari's StoredConversation).
// ---------------------------------------------------------------------------

export type StoredConversation = {
  id: string;
  origin: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: any[];
  usage?: any;
};

export type ResumePayload = {
  convoId: string;
  note: string;
  at: number;
  fromUrl?: string;
  fromOrigin?: string;
};
