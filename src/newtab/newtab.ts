import ext from "@shared/browser";
import { getBookmarks, getFolders, getSettings, getSyncStatus } from "@shared/storage";
import { applyStoredTheme } from "@shared/theme";
import { applyBuildBadge } from "@shared/buildBadge";
import { renderSyncErrorBanner } from "@shared/syncBanner";
import { renderBookmarkItem } from "@shared/folderList";
import { initSyncFoldersButton, refreshSyncFoldersButton } from "@shared/syncFoldersButton";
import { safeFolderBookmarks, foldersForSurface } from "@shared/bookmarks";
import { isCopyOnlyUrl } from "@shared/url";
import { copyBookmarkUrl } from "@shared/copyHint";
import type { Bookmark, BookmarkMap, Folder, Message, SyncStatus } from "@shared/types";

// Skip re-rendering (and aborting in-flight favicon loads) when a sync writes
// back data that's identical to what's already on screen.
let lastRenderKey = "";

// ---- Init -------------------------------------------------------------------

// The new-tab override is always declared, but whether this page is shown at all is the browser's
// call: Firefox/Chromium ask the user to keep or revert the extension's new-tab control (browsers
// block any script-side redirect back to the native page — about:home/about:blank are denied). So
// if we're running here, the user opted in — just render the launcher.
async function init(): Promise<void> {
  await applyStoredTheme();
  applyBuildBadge();

  document.getElementById("open-settings")?.addEventListener("click", () => {
    ext.runtime.openOptionsPage();
  });
  // Re-render happens via the storage listener; the button only needs wiring.
  await initSyncFoldersButton();

  await render();
  requestSync();
  listenForChanges();
}

// ---- Render -----------------------------------------------------------------

async function render(): Promise<void> {
  const [bookmarkMap, folders, syncStatus] = await Promise.all([
    getBookmarks(),
    getFolders(),
    getSyncStatus(),
  ]);

  const key = JSON.stringify({ bookmarkMap, folders, syncStatus });
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  renderBanner(syncStatus);
  renderFolders(bookmarkMap, folders);
}

function renderBanner(syncStatus: SyncStatus | null): void {
  const slot = document.getElementById("sync-error")!;
  slot.innerHTML = "";
  const banner = renderSyncErrorBanner(syncStatus);
  if (banner) slot.appendChild(banner);
}

function renderFolders(bookmarkMap: BookmarkMap, allFolders: Folder[]): void {
  const container = document.getElementById("folders")!;
  container.innerHTML = "";

  const folders = foldersForSurface(allFolders, "newtab");
  if (folders.length === 0) {
    container.innerHTML =
      '<p class="empty">No folders configured yet. Open <a href="#" id="open-options">settings</a> to get started.</p>';
    document.getElementById("open-options")?.addEventListener("click", (e) => {
      e.preventDefault();
      ext.runtime.openOptionsPage();
    });
    return;
  }

  for (const folder of folders) {
    container.appendChild(renderFolder(folder, bookmarkMap));
  }
}

function renderFolder(folder: Folder, bookmarkMap: BookmarkMap): HTMLElement {
  const section = document.createElement("section");
  section.className = "folder";

  const heading = document.createElement("h2");
  const nameSpan = document.createElement("span");
  nameSpan.className = "folder-name";
  nameSpan.textContent = folder.name;
  heading.appendChild(nameSpan);

  // Same folder-level affordance as the popup/sidebar summaries: an always-
  // visible button plus middle-click as a mouse-only bonus shortcut.
  const openAllBtn = document.createElement("button");
  openAllBtn.type = "button";
  openAllBtn.className = "open-all-btn";
  openAllBtn.title = "Open all in background tabs";
  openAllBtn.setAttribute("aria-label", `Open all bookmarks in ${folder.name}`);
  openAllBtn.textContent = "⇱";
  openAllBtn.addEventListener("click", () => {
    openAll(safeFolderBookmarks(folder, bookmarkMap));
  });
  heading.appendChild(openAllBtn);
  heading.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    openAll(safeFolderBookmarks(folder, bookmarkMap));
  });

  section.appendChild(heading);

  const list = document.createElement("ul");

  for (const id of folder.bookmark_ids) {
    const bookmark = bookmarkMap[id];
    if (bookmark) {
      // No onOpen: bookmarks are plain anchors opening a new tab natively
      // (keeps native middle-click/ctrl-click working unmodified). The
      // background button is additive on top of that. onOpenPrivileged is the one
      // exception — about:/chrome:// URLs can't be opened by a native anchor:
      // chrome:// goes through tabs.create, Firefox about: falls back to copying.
      list.appendChild(
        renderBookmarkItem(bookmark, {
          faviconSize: 16,
          onOpenBackground: (b) => {
            if (isCopyOnlyUrl(b.url)) {
              copyBookmarkUrl(b.url);
              return;
            }
            ext.tabs.create({ url: b.url, active: false });
          },
          onOpenPrivileged: (b) => {
            if (isCopyOnlyUrl(b.url)) {
              copyBookmarkUrl(b.url);
            } else {
              ext.tabs.create({ url: b.url });
            }
          },
        })
      );
    }
  }

  section.appendChild(list);
  return section;
}

// Opens a folder's bookmarks in background tabs. Whether the New Tab page
// itself then closes is the user's call (Settings, New Tab section); default
// is to keep it open. Settings are read at click time, so an options-page
// change applies without this page re-rendering.
async function openAll(bookmarks: Bookmark[]): Promise<void> {
  for (const bookmark of bookmarks) {
    // Skip copy-only URLs — "open all" can't copy several at once.
    if (isCopyOnlyUrl(bookmark.url)) continue;
    ext.tabs.create({ url: bookmark.url, active: false });
  }
  const settings = await getSettings();
  if (!settings.newTabCloseOnOpenAll) return;
  // window.close() is unreliable for a page the script didn't open; the tabs
  // API can always close its own tab.
  const tab = await ext.tabs.getCurrent();
  if (tab?.id !== undefined) {
    ext.tabs.remove(tab.id);
  }
}

// ---- Sync -------------------------------------------------------------------

function requestSync(): void {
  const message: Message = { type: "sync_requested" };
  ext.runtime.sendMessage(message).catch(() => {
    // background worker may not be ready yet on first load
  });
}

function listenForChanges(): void {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.bookmarks || changes.folders || changes.syncStatus) {
      render();
    }
    if (changes.settings) {
      applyStoredTheme();
      refreshSyncFoldersButton();
    }
  });
}

// ---- Boot -------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);
