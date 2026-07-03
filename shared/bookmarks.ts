import type {
  Bookmark,
  BookmarkMap,
  Folder,
  RuleCondition,
} from "./types";
import { isAllowedBookmarkUrl } from "./url";

// ---- Map conversion ---------------------------------------------------------

export function bookmarksToMap(bookmarks: Bookmark[]): BookmarkMap {
  return Object.fromEntries(bookmarks.map((b) => [b.id, b]));
}

export function bookmarkMapToArray(map: BookmarkMap): Bookmark[] {
  return Object.values(map);
}

// ---- Incremental sync merge -------------------------------------------------

export function mergeIntoMap(existing: BookmarkMap, updated: Bookmark[]): BookmarkMap {
  const result = { ...existing };
  for (const b of updated) {
    result[b.id] = b;
  }
  return result;
}

/** The folder's bookmarks that exist in the map and have an allowed URL scheme. */
export function safeFolderBookmarks(folder: Folder, bookmarkMap: BookmarkMap): Bookmark[] {
  return folder.bookmark_ids
    .map((id) => bookmarkMap[id])
    .filter((b): b is Bookmark => b != null && isAllowedBookmarkUrl(b.url));
}

// ---- Folder rule evaluation -------------------------------------------------

function matchesCondition(bookmark: Bookmark, condition: RuleCondition): boolean {
  switch (condition.type) {
    case "tag":
      return bookmark.tag_names.includes(condition.value);
    case "url_contains":
      return bookmark.url.toLowerCase().includes(condition.value.toLowerCase());
    case "title_contains":
      return bookmark.title.toLowerCase().includes(condition.value.toLowerCase());
    default:
      return false;
  }
}

function matchesFolder(bookmark: Bookmark, folder: Folder): boolean {
  const { match, conditions } = folder.rules;
  if (conditions.length === 0) return false;
  return match === "all"
    ? conditions.every((c) => matchesCondition(bookmark, c))
    : conditions.some((c) => matchesCondition(bookmark, c));
}

export function computeFolderMembership(
  bookmarkMap: BookmarkMap,
  folders: Folder[]
): Folder[] {
  const bookmarks = bookmarkMapToArray(bookmarkMap);
  return folders.map((folder) => ({
    ...folder,
    bookmark_ids: bookmarks
      .filter((b) => matchesFolder(b, folder))
      .map((b) => b.id),
  }));
}
