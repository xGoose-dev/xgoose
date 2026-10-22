/** Applied before an event enters the persistent upload outbox. */
export function redactTranscript(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\bBearer\s+[^\s"'<>]+/gi,"Bearer [REDACTED]").replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|key_[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,"[REDACTED]");
  if (Array.isArray(value)) return value.map(redactTranscript);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,v]) => [key,/(authorization|cookie|password|secret|api.?key|access.?token|refresh.?token|credit.?card|card.?number|cvv)/i.test(key) ? "[REDACTED]" : redactTranscript(v)]));
  return value;
}
