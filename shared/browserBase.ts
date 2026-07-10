export type BrowserBase = "firefox" | "chromium";

// The browser this bundle was built for, known at compile time. `__BROWSER_BASE__`
// is a literal injected by webpack's DefinePlugin (see webpack.config.ts): "firefox"
// for the firefox target, "chromium" for the chrome / chrome-newtab targets.
//
// The `typeof` guard keeps this module importable in the node unit tests (run via
// tsx, with no DefinePlugin), where the token is never defined — `typeof` on an
// undeclared identifier is safe and yields "undefined", so we fall back to "chromium".
declare const __BROWSER_BASE__: BrowserBase | undefined;

export const browserBase: BrowserBase =
  typeof __BROWSER_BASE__ === "string" ? __BROWSER_BASE__ : "chromium";
