import ext from "./browser";

// Firefox for Android runs the same bundle as desktop Firefox, so — unlike
// browserBase — this can't be a build-time constant; it is asked at runtime.
// On Android only the popup exists (no sidebar_action, no new-tab/homepage
// override, no bookmarks API), and the popup opens as a full-screen overlay.
let androidPromise: Promise<boolean> | undefined;

export function isAndroid(): Promise<boolean> {
  androidPromise ??= Promise.resolve()
    .then(() => ext.runtime.getPlatformInfo())
    .then((info) => info.os === "android")
    .catch(() => false);
  return androidPromise;
}

// Sets data-platform="android" on <html> so page CSS can switch to the mobile
// layout. Mirrors the data-theme / data-build toggles. Call once per page in init.
export async function applyPlatform(): Promise<void> {
  if (await isAndroid()) document.documentElement.setAttribute("data-platform", "android");
}
