/* Popup as Firefox for Android shows it: a full-screen overlay at phone width.
   Fakes the platform before DOMContentLoaded (init hasn't asked yet). */
chrome.runtime.getPlatformInfo = () => Promise.resolve({ os: "android", arch: "aarch64" });

window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.documentElement.dataset.platform && document.querySelector("#folders details"));
  check("viewport meta is present", !!document.querySelector('meta[name="viewport"]'));
  check("<html data-platform=\"android\"> is set", document.documentElement.dataset.platform === "android");
  check(
    "body fills the screen instead of the desktop popup's 280px",
    document.body.getBoundingClientRect().width === document.documentElement.clientWidth
  );
});
