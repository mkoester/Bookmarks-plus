/* Options page as Firefox for Android shows it: the controls for things Android
   lacks (sidebar, new tab, bookmarks API) are hidden. Fakes the platform before
   DOMContentLoaded (init hasn't asked yet).
   No horizontal-overflow check: desktop headless Chromium ignores the viewport
   meta (even with --enable-viewport), so such a check passed with the meta and
   the phone-width CSS both stripped — it could not fail. The meta's presence is
   the check that matters; the phone layout itself needs a real device. */
chrome.runtime.getPlatformInfo = () => Promise.resolve({ os: "android", arch: "aarch64" });

window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#tab-bar button"));
  const clickTab = (name) =>
    Array.from(document.querySelectorAll("#tab-bar button"))
      .find((b) => b.textContent === name)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  check("viewport meta is present", !!document.querySelector('meta[name="viewport"]'));
  check("<html data-platform=\"android\"> is set", document.documentElement.dataset.platform === "android");

  // Overview
  clickTab("Overview");
  const addOptions = Array.from(document.querySelectorAll(".add-provider-row option")).map((o) => o.value);
  check("add-provider menu still renders", addOptions.length > 0);
  check("browser-bookmarks provider is not offered", !addOptions.includes("browser"));
  const headings = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
  check("New Tab page section is hidden", !headings.includes("New Tab page"));

  // Folders
  clickTab("Folders");
  const labels = Array.from(document.querySelector(".folder-editor .folder-surfaces").querySelectorAll("label.folder-surface"));
  const visible = labels.filter((l) => !l.hidden && l.getBoundingClientRect().width > 0);
  check("only the Popup surface checkbox is visible", visible.length === 1 && visible[0].textContent.includes("Popup"));
  check("the hidden sidebar/newtab boxes stay in the DOM (stored state kept)", labels.length === 3);
});
