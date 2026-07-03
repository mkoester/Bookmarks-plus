import ext from "@shared/browser";
import { getBookmarks, getFolders, getSyncStatus } from "@shared/storage";
import { applyStoredTheme } from "@shared/theme";
import { renderSyncErrorBanner } from "@shared/syncBanner";
import { renderFolderDetails } from "@shared/folderList";
import type { BookmarkMap, Folder, Message } from "@shared/types";

async function init(): Promise<void> {
  await applyStoredTheme();

  const [bookmarkMap, folders, syncStatus] = await Promise.all([
    getBookmarks(),
    getFolders(),
    getSyncStatus(),
  ]);

  const banner = renderSyncErrorBanner(syncStatus);
  if (banner) document.getElementById("sync-error")!.appendChild(banner);

  renderFolders(bookmarkMap, folders);

  document.getElementById("open-options")?.addEventListener("click", () => {
    ext.runtime.openOptionsPage();
    window.close();
  });

  const message: Message = { type: "sync_requested" };
  ext.runtime.sendMessage(message).catch(() => {});
}

function renderFolders(bookmarkMap: BookmarkMap, folders: Folder[]): void {
  const container = document.getElementById("folders")!;

  if (folders.length === 0) {
    container.innerHTML = '<p class="empty">No folders configured.</p>';
    return;
  }

  // Left-click and middle-click "open all" both open new tabs and close the popup.
  for (const folder of folders) {
    container.appendChild(
      renderFolderDetails(folder, bookmarkMap, {
        faviconSize: 14,
        onOpen: (bookmark) => {
          ext.tabs.create({ url: bookmark.url });
          window.close();
        },
        onOpenAll: (bookmarks) => {
          for (const bookmark of bookmarks) {
            ext.tabs.create({ url: bookmark.url });
          }
          window.close();
        },
      }),
    );
  }
}

document.addEventListener("DOMContentLoaded", init);
