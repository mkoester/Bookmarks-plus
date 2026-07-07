/* New-tab invariants: bookmarks stay native anchors (no click hijack), each row
   has an open-in-background button, each folder heading has an open-all button,
   open-all honours the newTabCloseOnOpenAll setting (keep open by default,
   close the page's own tab when enabled), and the "Sync folders now" button
   appears when a folder source is configured. Runs against the real newtab
   bundle with mocked chrome.* (screenshot-harness demo data). */

// Runs before DOMContentLoaded — patch storage so init sees a folder source.
// Mutates in place — the harness hands out its live settings object (the
// newTabCloseOnOpenAll flip below depends on that).
const __origGet = chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get = async (key) => {
  const out = await __origGet(key);
  if (out.settings) out.settings.folderSource = { url: "https://example.com/folders.json" };
  return out;
};

window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#folders .folder"));
  const folder = document.querySelector("#folders .folder");
  check("folders render", !!folder);

  const anchor = folder.querySelector("li a");
  check(
    "bookmarks are native anchors (target=_blank, real href)",
    anchor && anchor.target === "_blank" && anchor.href.startsWith("http")
  );
  check("bookmark rows have an open-in-background button", !!folder.querySelector("li .open-bg-btn"));
  check(
    "folder heading has name span + open-all button",
    !!folder.querySelector("h2 .folder-name") && !!folder.querySelector("h2 .open-all-btn")
  );

  // Spy on the tab APIs the buttons drive.
  const created = [];
  let removedOwnTab = false;
  chrome.tabs.create = (opts) => created.push(opts);
  chrome.tabs.remove = () => { removedOwnTab = true; };
  const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const settle = () => new Promise((r) => setTimeout(r, 0)); // open-all awaits getSettings/getCurrent

  click(folder.querySelector("li .open-bg-btn"));
  check(
    "background button opens exactly one inactive tab",
    created.length === 1 && created[0].active === false
  );

  created.length = 0;
  const bookmarkCount = folder.querySelectorAll("li").length;
  click(folder.querySelector("h2 .open-all-btn"));
  await settle();
  check(
    "open-all opens every folder bookmark as an inactive tab",
    created.length === bookmarkCount && created.every((o) => o.active === false)
  );
  check("open-all keeps the New Tab page open by default", removedOwnTab === false);

  // The harness returns its live settings object, so this flips the stored
  // setting the way the options page would.
  const { settings } = await chrome.storage.local.get("settings");
  settings.newTabCloseOnOpenAll = true;
  created.length = 0;
  click(folder.querySelector("h2 .open-all-btn"));
  await settle();
  await settle();
  check("open-all closes the New Tab page when the setting is enabled", removedOwnTab === true);

  // --- "Sync folders now" (folder source configured via the patch above) ---
  const syncBtn = document.getElementById("sync-folders");
  check(
    "'Sync folders now' button is visible next to the settings gear",
    !!syncBtn && !syncBtn.hidden && syncBtn.title === "Sync folders now"
  );
});
