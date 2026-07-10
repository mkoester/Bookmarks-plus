// Schemes a bookmark is allowed to link to. Anything else (notably `javascript:`
// and `data:`) is rejected: an extension page lives on a privileged
// chrome-extension:// / moz-extension:// origin, so a `javascript:` href clicked
// there would run script in that privileged context. Enforced both at validation
// time (JSON provider) and defensively at render time (all providers).
//
// `about:`/`chrome:` (browser-internal pages, e.g. about:debugging, chrome://extensions)
// are allowed too: unlike `javascript:` they never execute in the extension page —
// they can only be opened in a tab via tabs.create() (see isPrivilegedNavUrl).
const ALLOWED_BOOKMARK_SCHEMES = new Set([
  "http:",
  "https:",
  "mailto:",
  "ftp:",
  "about:",
  "chrome:",
]);

export function isAllowedBookmarkUrl(url: string): boolean {
  try {
    return ALLOWED_BOOKMARK_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Browser-internal schemes that a plain anchor click / tabs.update() refuses to
// navigate to. chrome:// can still be opened with tabs.create(); Firefox about:
// pages can't be opened by ANY extension API (see isCopyOnlyUrl). Callers use this
// to route such bookmarks away from native anchor navigation.
const PRIVILEGED_NAV_SCHEMES = new Set(["about:", "chrome:"]);

export function isPrivilegedNavUrl(url: string): boolean {
  try {
    return PRIVILEGED_NAV_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Firefox forbids extensions from opening privileged about: pages (about:debugging,
// about:config, …) through any API — tabs.create/update/windows.create all reject,
// and anchor clicks from an extension page are inert. So these can't be opened at
// all; callers fall back to copying the URL for the user to paste into the address
// bar. (chrome:// on Chromium is fine via tabs.create, so it is NOT copy-only.)
const COPY_ONLY_SCHEMES = new Set(["about:"]);

export function isCopyOnlyUrl(url: string): boolean {
  try {
    return COPY_ONLY_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// A favicon ends up as an <img src>. `javascript:`/`mailto:` make no sense there;
// allow only the web schemes plus inline data: images (used by some sources and by
// our own letter-tile fallback).
const ALLOWED_FAVICON_SCHEMES = new Set(["http:", "https:", "data:"]);

export function isAllowedFaviconUrl(url: string): boolean {
  try {
    return ALLOWED_FAVICON_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
