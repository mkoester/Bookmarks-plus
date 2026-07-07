/* Sidebar invariants: folders render and the open-all / open-in-background
   affordances exist (same shared renderFolderDetails as the popup), and the
   "Sync folders now" button appears when a folder source is configured. */

// Runs before DOMContentLoaded — patch storage so init sees a folder source.
// Mutates in place — the harness hands out its live settings object.
const __origGet = chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get = async (key) => {
  const out = await __origGet(key);
  if (out.settings) out.settings.folderSource = { url: "https://example.com/folders.json" };
  return out;
};

window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#folders details"));
  check("folders render", !!document.querySelector("#folders details"));
  const openAll = document.querySelector(".open-all-btn");
  check("folder has an 'open all' button", !!openAll && openAll.tagName === "BUTTON");
  const openBg = document.querySelector(".open-bg-btn");
  check("bookmark row has an 'open in background' button", !!openBg && openBg.tagName === "BUTTON");

  const syncBtn = document.getElementById("sync-folders");
  check(
    "'Sync folders now' button is visible next to Settings",
    !!syncBtn && !syncBtn.hidden && syncBtn.title === "Sync folders now"
  );
});
