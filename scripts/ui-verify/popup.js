/* Popup invariants: folders render and the open-all / open-in-background
   affordances exist (they replaced the mouse-only middle-click gesture), and
   the "Sync folders now" button appears when a folder source is configured. */

// This script runs before DOMContentLoaded (init hasn't read storage yet), so
// patching the harness's get here makes init see a configured folder source.
// Mutates in place — the harness hands out its live settings object.
const __origGet = chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get = async (key) => {
  const out = await __origGet(key);
  if (out.settings) out.settings.folderSource = { url: "https://example.com/folders.json" };
  return out;
};
const __sent = [];
chrome.runtime.sendMessage = (msg) => {
  __sent.push(msg);
  return Promise.resolve({ done: true });
};

window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#folders details"));
  check("folders render", !!document.querySelector("#folders details"));
  check("folder name is wrapped in .folder-name", !!document.querySelector(".folder-name"));
  const openAll = document.querySelector(".open-all-btn");
  check("folder has an 'open all' button", !!openAll && openAll.tagName === "BUTTON");
  const openBg = document.querySelector(".open-bg-btn");
  check("bookmark row has an 'open in background' button", !!openBg && openBg.tagName === "BUTTON");

  // --- "Sync folders now" (remote folder source configured via the patch above) ---
  const syncBtn = document.getElementById("sync-folders");
  check(
    "'Sync folders now' button is visible next to Settings",
    !!syncBtn && !syncBtn.hidden && syncBtn.title === "Sync folders now"
  );
  syncBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const folderSync = () =>
    __sent.find((m) => m.type === "sync_provider" && m.providerId === "folder-source");
  await waitFor(folderSync);
  check("clicking it requests a folder-source-only sync", !!folderSync());
});
