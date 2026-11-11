/** Keep the failed service visible without exposing paths, tokens or payloads. */
export function connectionErrorMessage(url: string): string {
  const origin = new URL(url).origin;
  return `Could not connect to ${origin}. Open your browser’s extension settings → xgoose → Site access and allow ${origin}. If access is already allowed, check your network, VPN or DNS and try again. Allow User Scripts does not control AI connections.`;
}
