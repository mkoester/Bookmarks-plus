import { renderFavicon } from "./favicon";
import { isAllowedBookmarkUrl } from "./url";
import { safeFolderBookmarks } from "./bookmarks";
import type { Bookmark, BookmarkMap, Folder } from "./types";

// Shared folder/bookmark list rendering for the popup, sidebar and new-tab
// surfaces. The markup is identical everywhere; only how a click opens a
// bookmark differs, so that's injected via callbacks.

export interface BookmarkItemOptions {
  faviconSize: number;
  /** Left-click handler. Omit for native anchor navigation in a new tab (new-tab page). */
  onOpen?: (bookmark: Bookmark) => void;
}

export function renderBookmarkItem(bookmark: Bookmark, opts: BookmarkItemOptions): HTMLElement {
  const li = document.createElement("li");
  const a = document.createElement("a");

  // Defensive: only link out to safe schemes. A `javascript:` URL clicked in a
  // privileged extension page would run script in that context, so a bad
  // bookmark is neutered.
  const safe = isAllowedBookmarkUrl(bookmark.url);
  if (safe) {
    a.href = bookmark.url;
    if (!opts.onOpen) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  } else {
    a.href = "#";
    a.title = "Blocked: unsupported link type";
  }

  if (opts.onOpen || !safe) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (safe) opts.onOpen?.(bookmark);
    });
  }

  const span = document.createElement("span");
  span.textContent = bookmark.title;

  a.appendChild(renderFavicon(bookmark, opts.faviconSize));
  a.appendChild(span);
  li.appendChild(a);
  return li;
}

export interface FolderDetailsOptions extends BookmarkItemOptions {
  /** Middle-click handler for the folder summary; receives the folder's safe bookmarks. */
  onOpenAll?: (bookmarks: Bookmark[]) => void;
}

export function renderFolderDetails(
  folder: Folder,
  bookmarkMap: BookmarkMap,
  opts: FolderDetailsOptions,
): HTMLElement {
  const details = document.createElement("details");
  details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = folder.name;
  if (opts.onOpenAll) {
    summary.addEventListener("mousedown", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      opts.onOpenAll!(safeFolderBookmarks(folder, bookmarkMap));
    });
  }
  details.appendChild(summary);

  const ul = document.createElement("ul");
  for (const id of folder.bookmark_ids) {
    const bookmark = bookmarkMap[id];
    if (bookmark) ul.appendChild(renderBookmarkItem(bookmark, opts));
  }
  details.appendChild(ul);

  return details;
}
