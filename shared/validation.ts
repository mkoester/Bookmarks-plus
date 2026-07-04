import type { Bookmark, ConditionType, Folder, MatchMode, RuleGroup, RuleNode } from "./types";
import { isAllowedBookmarkUrl, isAllowedFaviconUrl } from "./url";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateBookmarkEntry(b: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `bookmarks[${index}]`;

  if (typeof b !== "object" || b === null) {
    return [`${prefix}: must be an object`];
  }

  const bookmark = b as Record<string, unknown>;

  if (typeof bookmark.url !== "string" || !bookmark.url.trim()) {
    errors.push(`${prefix}: url must be a non-empty string`);
  } else if (!isAllowedBookmarkUrl(bookmark.url)) {
    errors.push(`${prefix}: url must be a valid http, https, mailto, or ftp URL`);
  }

  if (typeof bookmark.title !== "string" || !bookmark.title.trim()) {
    errors.push(`${prefix}: title must be a non-empty string`);
  }

  if ("tag_names" in bookmark) {
    if (!Array.isArray(bookmark.tag_names)) {
      errors.push(`${prefix}: tag_names must be an array`);
    } else if (!bookmark.tag_names.every((t) => typeof t === "string" && t.trim())) {
      errors.push(`${prefix}: tag_names must contain only non-empty strings`);
    }
  }

  if ("favicon_url" in bookmark) {
    if (typeof bookmark.favicon_url !== "string" || !bookmark.favicon_url.trim()) {
      errors.push(`${prefix}: favicon_url must be a non-empty string when present`);
    } else if (!isAllowedFaviconUrl(bookmark.favicon_url)) {
      errors.push(`${prefix}: favicon_url must be a valid http, https, or data URL`);
    }
  }

  return errors;
}

export function validateBookmarks(data: unknown): ValidationResult {
  if (!Array.isArray(data)) {
    return { valid: false, errors: ["root must be an array"] };
  }

  if (data.length === 0) {
    return { valid: false, errors: ["array must not be empty"] };
  }

  const errors = data.flatMap((b, i) => validateBookmarkEntry(b, i));
  return { valid: errors.length === 0, errors };
}

// ---- Folder / rule validation -------------------------------------------------

const MATCH_MODES: ReadonlySet<string> = new Set<MatchMode>(["all", "any", "none"]);
const CONDITION_TYPES: ReadonlySet<string> = new Set<ConditionType>([
  "tag",
  "url_contains",
  "title_contains",
]);

export interface RuleGroupParseResult {
  valid: boolean;
  errors: string[];
  group: RuleGroup | null;
}

// Recursion is safe: input comes from JSON.parse or storage.local (itself
// JSON-serialized), which cannot produce cyclic structures.
function parseRuleNode(data: unknown, path: string): { errors: string[]; node: RuleNode | null } {
  if (typeof data !== "object" || data === null) {
    return { errors: [`${path}: must be an object`], node: null };
  }
  const obj = data as Record<string, unknown>;
  const isGroup = "conditions" in obj;
  const isLeaf = "type" in obj;

  if (isGroup === isLeaf) {
    return {
      errors: [`${path}: must be a condition (type/value) or a group (match/conditions)`],
      node: null,
    };
  }

  if (isLeaf) {
    const errors: string[] = [];
    if (typeof obj.type !== "string" || !CONDITION_TYPES.has(obj.type)) {
      errors.push(`${path}: type must be one of tag, url_contains, title_contains`);
    }
    if (typeof obj.value !== "string" || !obj.value.trim()) {
      errors.push(`${path}: value must be a non-empty string`);
    }
    if (errors.length > 0) return { errors, node: null };
    return { errors: [], node: { type: obj.type as ConditionType, value: obj.value as string } };
  }

  const errors: string[] = [];
  if (typeof obj.match !== "string" || !MATCH_MODES.has(obj.match)) {
    errors.push(`${path}: match must be one of all, any, none`);
  }
  if (!Array.isArray(obj.conditions)) {
    errors.push(`${path}: conditions must be an array`);
    return { errors, node: null };
  }
  // Empty conditions arrays are valid — they simply match nothing.
  const children: RuleNode[] = [];
  obj.conditions.forEach((child, i) => {
    const result = parseRuleNode(child, `${path}.conditions[${i}]`);
    errors.push(...result.errors);
    if (result.node) children.push(result.node);
  });
  if (errors.length > 0) return { errors, node: null };
  return { errors: [], node: { match: obj.match as MatchMode, conditions: children } };
}

export function parseRuleGroup(data: unknown, path = "rules"): RuleGroupParseResult {
  const result = parseRuleNode(data, path);
  if (result.node && !("conditions" in result.node)) {
    return {
      valid: false,
      errors: [`${path}: root must be a group (match/conditions), not a single condition`],
      group: null,
    };
  }
  return {
    valid: result.errors.length === 0,
    errors: result.errors,
    group: result.node as RuleGroup | null,
  };
}

export interface FoldersParseResult {
  valid: boolean;
  errors: string[];
  folders: Folder[];
}

export function parseFolders(data: unknown): FoldersParseResult {
  if (!Array.isArray(data)) {
    return { valid: false, errors: ["root must be an array"], folders: [] };
  }
  if (data.length === 0) {
    return { valid: false, errors: ["array must not be empty"], folders: [] };
  }

  const errors: string[] = [];
  const folders: Folder[] = [];
  const seenIds = new Set<string>();

  data.forEach((entry, i) => {
    const prefix = `folders[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${prefix}: must be an object`);
      return;
    }
    const obj = entry as Record<string, unknown>;
    const entryErrors: string[] = [];

    if (typeof obj.name !== "string" || !obj.name.trim()) {
      entryErrors.push(`${prefix}: name must be a non-empty string`);
    }

    const id =
      typeof obj.id === "string" && obj.id.trim() ? obj.id : crypto.randomUUID();
    if (seenIds.has(id)) {
      entryErrors.push(`${prefix}: duplicate id "${id}"`);
    }

    const rules = parseRuleGroup(obj.rules, `${prefix}.rules`);
    entryErrors.push(...rules.errors);

    errors.push(...entryErrors);
    if (entryErrors.length > 0 || !rules.group) return;

    seenIds.add(id);
    folders.push({
      id,
      name: obj.name as string,
      rules: rules.group,
      // bookmark_ids is install-specific and recomputed at sync; keep it if
      // sane so defensive loads don't blank folders between syncs.
      bookmark_ids:
        Array.isArray(obj.bookmark_ids) && obj.bookmark_ids.every((x) => typeof x === "string")
          ? (obj.bookmark_ids as string[])
          : [],
    });
  });

  return { valid: errors.length === 0, errors, folders };
}

// Converts a validated raw entry to a Bookmark, namespaced under providerId.
// Falls back to array index if id is absent.
export function entryToBookmark(
  entry: Record<string, unknown>,
  index: number,
  providerId: string
): Bookmark {
  const rawId =
    entry.id !== undefined && entry.id !== null
      ? String(entry.id)
      : String(index);

  return {
    id: `${providerId}:${rawId}`,
    url: entry.url as string,
    title: entry.title as string,
    tag_names: Array.isArray(entry.tag_names)
      ? (entry.tag_names as string[])
      : [],
    ...(typeof entry.favicon_url === "string" ? { favicon_url: entry.favicon_url } : {}),
  };
}
