const currentUserAgent = () => typeof navigator === 'undefined' ? '' : navigator.userAgent;
export function isMicrosoftEdge(userAgent = currentUserAgent()): boolean {
  return /\bEdg(?:A|iOS)?\//.test(userAgent);
}
export function browserName(userAgent = currentUserAgent()): string {
  return isMicrosoftEdge(userAgent) ? 'Microsoft Edge' : 'Chrome';
}
export function extensionDetailsUrl(id?: string, userAgent = currentUserAgent()): string {
  const base = `${isMicrosoftEdge(userAgent) ? 'edge' : 'chrome'}://extensions`;
  return id ? `${base}/?id=${encodeURIComponent(id)}` : base;
}
/** Only call for product UI; the illustrated Chrome screenshot stays labelled accurately. */
export function browserUiText(text: string, source = text, userAgent = currentUserAgent()): string {
  if (!isMicrosoftEdge(userAgent) || source.startsWith('Actual Chrome extension details:') || source.includes('image above shows Chrome’s actual settings page.') || source.includes('The Chrome image is a reference')) return text;
  return text.replace(/chrome:\/\/extensions/g, 'edge://extensions').replace(/\bChrome\b/g, 'Microsoft Edge');
}
