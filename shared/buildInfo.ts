// Pure build-identity helpers, deliberately free of any ext/DOM import so the unit
// tests can load it in node (same split rationale as folderSource.ts vs.
// syncFoldersButton.ts). The ext/DOM side lives in buildBadge.ts.

// A store-safe manifest version is dot-separated integers only; any hyphen means the
// build carries a git decoration (…-<hash> / …-SNAPSHOT — see decoratedVersion() in
// webpack.config.ts) → it is a non-release (dev) build. Release builds are clean-main,
// so this is false for anything that reaches AMO/CWS.
export function isDevBuild(version: string | undefined): boolean {
  return version !== undefined && version.includes("-");
}
