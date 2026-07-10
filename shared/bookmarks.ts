import type {
  Bookmark,
  BookmarkMap,
  Folder,
  RuleCondition,
  RuleNode,
  Surface,
} from "./types";
import { isRuleGroup } from "./types";
import { isAllowedBookmarkUrl } from "./url";
import { browserBase } from "./browserBase";

// ---- Map conversion ---------------------------------------------------------

export function bookmarksToMap(bookmarks: Bookmark[]): BookmarkMap {
  return Object.fromEntries(bookmarks.map((b) => [b.id, b]));
}

export function bookmarkMapToArray(map: BookmarkMap): Bookmark[] {
  return Object.values(map);
}

// ---- Surface targeting ------------------------------------------------------

/**
 * The folders that should appear on a given surface. A folder with no
 * `surfaces` field shows everywhere (the default); an explicit list includes
 * only the named surfaces (empty list = hidden everywhere).
 */
export function foldersForSurface(folders: Folder[], surface: Surface): Folder[] {
  return folders.filter((f) => f.surfaces === undefined || f.surfaces.includes(surface));
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
    case "provider":
      // value is a provider config id; bookmark ids are "${providerConfigId}:${rawId}"
      return bookmark.id.startsWith(`${condition.value}:`);
    case "browser_base":
      // value is "firefox" | "chromium"; matches when it equals this build's target.
      // Bookmark-independent — the gate is the same for every bookmark in a given build.
      return condition.value === browserBase;
    default:
      return false;
  }
}

// Group semantics (uniform at every nesting level):
//
//   match  | empty conditions | non-empty conditions
//   -------|------------------|---------------------------------
//   all    | false            | every child matches (AND)
//   any    | false            | at least one child matches (OR)
//   none   | false            | no child matches (NOT(A OR B ...))
//
// Empty groups never match — deliberately not vacuous truth for "all",
// so a half-built group can never silently match everything.
export function matchesNode(bookmark: Bookmark, node: RuleNode): boolean {
  if (!isRuleGroup(node)) return matchesCondition(bookmark, node);
  if (node.conditions.length === 0) return false;
  switch (node.match) {
    case "all":
      return node.conditions.every((c) => matchesNode(bookmark, c));
    case "any":
      return node.conditions.some((c) => matchesNode(bookmark, c));
    case "none":
      return !node.conditions.some((c) => matchesNode(bookmark, c));
  }
}

function matchesFolder(bookmark: Bookmark, folder: Folder): boolean {
  return matchesNode(bookmark, folder.rules);
}

// Display-order weight contribution for a bookmark against a rule (sub)tree.
// Meaningful only where a RuleCondition.weight is set on a direct child of an
// "any" group, but defined uniformly at every node so it composes naturally:
//   - leaf:  matched ? (weight ?? 0) : 0
//   - "any": MAX over matched children (the best matching reason wins)
//   - "all": SUM over children (all matched anyway, since the group matched)
//   - "none": 0 (its children never match by definition — nothing to weight)
// Unweighted conditions default to 0, so a folder with no weights configured
// scores 0 for every bookmark — ties fall straight through to Folder.sort (or
// original order), no separate "has any weight" flag needed.
export function matchWeight(bookmark: Bookmark, node: RuleNode): number {
  if (!isRuleGroup(node)) {
    return matchesCondition(bookmark, node) ? (node.weight ?? 0) : 0;
  }
  switch (node.match) {
    case "any":
      return node.conditions.reduce(
        (max, c) => Math.max(max, matchesNode(bookmark, c) ? matchWeight(bookmark, c) : 0),
        0
      );
    case "all":
      return node.conditions.reduce((sum, c) => sum + matchWeight(bookmark, c), 0);
    case "none":
      return 0;
  }
}

function addedTimestamp(b: Bookmark): number {
  const t = b.date ? Date.parse(b.date) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function modifiedTimestamp(b: Bookmark): number {
  const raw = b.dateModified ?? b.date;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

// The newest n bookmarks by date. Undated bookmarks sort last; ties (and the
// undated tail) keep their input order — for feeds that is the feed's own
// order, which is conventionally newest-first anyway. Also used by the feed
// provider's per-feed maxItems cap.
export function latestN(bookmarks: Bookmark[], n: number): Bookmark[] {
  return [...bookmarks]
    .sort((a, b) => {
      const ta = addedTimestamp(a);
      const tb = addedTimestamp(b);
      if (tb > ta) return 1;
      if (tb < ta) return -1;
      return 0; // Array.prototype.sort is stable
    })
    .slice(0, n);
}

// Orders a folder's already-selected bookmarks for display. matchWeight
// (against the folder's root rules) is always the primary key, descending;
// folder.sort is only the tiebreak (or the original/stable order when unset).
// Selection (which N bookmarks, via Folder.limit) is a separate, earlier
// concern — this only reorders an already-chosen set.
export function sortForDisplay(bookmarks: Bookmark[], folder: Folder): Bookmark[] {
  return [...bookmarks].sort((a, b) => {
    const wa = matchWeight(a, folder.rules);
    const wb = matchWeight(b, folder.rules);
    if (wb !== wa) return wb - wa; // descending weight, primary

    switch (folder.sort) {
      case "added": {
        const diff = addedTimestamp(b) - addedTimestamp(a);
        if (diff !== 0) return diff;
        break;
      }
      case "modified": {
        const diff = modifiedTimestamp(b) - modifiedTimestamp(a);
        if (diff !== 0) return diff;
        break;
      }
      case "alphabetical": {
        const diff = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
        if (diff !== 0) return diff;
        break;
      }
    }
    return 0; // stable sort keeps original order as the final fallback
  });
}

export function computeFolderMembership(
  bookmarkMap: BookmarkMap,
  folders: Folder[]
): Folder[] {
  const bookmarks = bookmarkMapToArray(bookmarkMap);
  return folders.map((folder) => {
    const matched = bookmarks.filter((b) => matchesFolder(b, folder));
    const selected =
      folder.limit !== undefined && folder.limit > 0 ? latestN(matched, folder.limit) : matched;
    const chosen = sortForDisplay(selected, folder);
    return { ...folder, bookmark_ids: chosen.map((b) => b.id) };
  });
}
