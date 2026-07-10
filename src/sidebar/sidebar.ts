import ext from "@shared/browser";
import { getBookmarks, getFolders, getSyncStatus } from "@shared/storage";
import { applyStoredTheme } from "@shared/theme";
import { applyBuildBadge } from "@shared/buildBadge";
import { renderSyncErrorBanner } from "@shared/syncBanner";
import { renderFolderDetails } from "@shared/folderList";
import { foldersForSurface } from "@shared/bookmarks";
import { initSyncFoldersButton, refreshSyncFoldersButton } from "@shared/syncFoldersButton";
import { isPrivilegedNavUrl, isCopyOnlyUrl } from "@shared/url";
import { copyBookmarkUrl } from "@shared/copyHint";
import type { BookmarkMap, Folder, Message, SyncStatus } from "@shared/types";

// The sidebar mirrors the popup's folder rendering, but it stays open, so it
// re-renders on storage changes and opens bookmarks in the current tab instead
// of closing itself.

// Skip re-rendering (and aborting in-flight favicon loads) when a sync writes
// back data that's identical to what's already on screen.
let lastRenderKey = "";

async function init(): Promise<void> {
  await applyStoredTheme();
  applyBuildBadge();
  registerForToggle();

  await render();
  requestSync();
  listenForChanges();

  document.getElementById("open-options")?.addEventListener("click", () => {
    ext.runtime.openOptionsPage();
  });
  // Re-render happens via the storage listener; the button only needs wiring.
  await initSyncFoldersButton();
}

// Chromium only: register this panel (keyed by window) with the background so the keyboard
// shortcut can toggle it shut — Chrome can't reliably close a global side panel from the API, but
// the panel can close itself with window.close(). Firefox's sidebar toggles natively, so skip it.
async function registerForToggle(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.sidePanel) return;
  try {
    const win = await ext.windows.getCurrent();
    const port = ext.runtime.connect({ name: `sidepanel:${win.id ?? -1}` });
    port.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === "close") window.close();
    });
  } catch {
    // best-effort; if this fails, the shortcut just always opens (never toggles closed)
  }
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

  const folders = foldersForSurface(allFolders, "sidebar");
  if (folders.length === 0) {
    container.innerHTML = '<p class="empty">No folders configured.</p>';
    return;
  }

  // Left-click: navigate the current tab (the sidebar stays open); a bookmark
  // middle-click is left to the native anchor behaviour, which opens a
  // background tab. Middle-click on the folder name: open all in background tabs.
  for (const folder of folders) {
    container.appendChild(
      renderFolderDetails(folder, bookmarkMap, {
        faviconSize: 14,
        onOpen: (bookmark) => {
          // Firefox about: pages can't be opened at all — copy instead. chrome://
          // can't load into the current tab via tabs.update, so open a new tab;
          // everything else navigates the current tab.
          if (isCopyOnlyUrl(bookmark.url)) {
            copyBookmarkUrl(bookmark.url);
          } else if (isPrivilegedNavUrl(bookmark.url)) {
            ext.tabs.create({ url: bookmark.url });
          } else {
            ext.tabs.update({ url: bookmark.url });
          }
        },
        onOpenBackground: (bookmark) => {
          if (isCopyOnlyUrl(bookmark.url)) {
            copyBookmarkUrl(bookmark.url);
            return;
          }
          ext.tabs.create({ url: bookmark.url, active: false });
        },
        onOpenAll: (bookmarks) => {
          // Skip copy-only URLs — "open all" can't copy several at once.
          for (const bookmark of bookmarks) {
            if (isCopyOnlyUrl(bookmark.url)) continue;
            ext.tabs.create({ url: bookmark.url, active: false });
          }
        },
      }),
    );
  }
}

// ---- Sync & live updates ----------------------------------------------------

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

document.addEventListener("DOMContentLoaded", init);
