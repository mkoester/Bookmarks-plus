// Pure build-identity helpers, deliberately free of any ext/DOM import so the unit
// tests can load it in node (same split rationale as folderSource.ts vs.
// syncFoldersButton.ts). The ext/DOM side lives in buildBadge.ts.

// How a build relates to a shippable release, derived purely from the manifest
// version string (see decoratedVersion() in webpack.config.ts):
//   - "release": a clean main build — store-safe, dot-separated integers only.
//   - "branch":  a clean off-main build — committed, decorated with -<hash>.
//   - "dirty":   an uncommitted working tree — decorated with -SNAPSHOT.
export type BuildKind = "release" | "branch" | "dirty";

export function buildKind(version: string | undefined): BuildKind {
  if (version === undefined || !version.includes("-")) return "release";
  return version.includes("-SNAPSHOT") ? "dirty" : "branch";
}
