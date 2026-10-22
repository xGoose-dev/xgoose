import { patternToRegex } from "webext-patterns";

export function urlMatchesAny(url: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  try {
    const re = patternToRegex(...patterns);
    return re.test(url);
  } catch {
    return false;
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$");
}

export function urlMatchesAnyGlob(url: string, globs: string[]): boolean {
  if (!globs.length) return false;
  return globs.some((g) => globToRegex(g).test(url));
}

export function isUrlBlocked(url: string, exclude: string[]): boolean {
  if (!exclude.length) return false;
  return urlMatchesAny(url, exclude) || urlMatchesAnyGlob(url, exclude);
}

export function skillUrlActive(args: {
  url: string;
  matches: string[];
  include: string[];
  exclude: string[];
}): boolean {
  const { url, matches, include, exclude } = args;
  if (isUrlBlocked(url, exclude)) return false;
  if (urlMatchesAny(url, matches)) return true;
  if (urlMatchesAnyGlob(url, include)) return true;
  return false;
}

export function originForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}
