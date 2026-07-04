// ---- Bookmark ---------------------------------------------------------------

export interface Bookmark {
  id: string; // namespaced: "${providerConfigId}:${rawId}"
  url: string;
  title: string;
  tag_names: string[];
  favicon_url?: string;
  // ISO timestamp of when the item was added/published, when the provider
  // knows it (linkding date_added, browser dateAdded, feed publish dates).
  // Basis for the per-folder "latest N" limit.
  date?: string;
}

export type BookmarkMap = Record<string, Bookmark>;

// ---- Folder rules -----------------------------------------------------------

export type ConditionType = "tag" | "url_contains" | "title_contains" | "provider";
export type MatchMode = "all" | "any" | "none";

export interface RuleCondition {
  type: ConditionType;
  value: string;
}

export interface RuleGroup {
  match: MatchMode;
  conditions: RuleNode[];
}

export type RuleNode = RuleCondition | RuleGroup;

/** Back-compat alias: a folder's rules are the root group. Old flat data is valid as-is. */
export type FolderRules = RuleGroup;

// Discriminator: groups have `conditions`; leaves have `type` + `value`.
export function isRuleGroup(node: RuleNode): node is RuleGroup {
  return "conditions" in node;
}

export interface Folder {
  id: string;
  name: string;
  rules: FolderRules;
  // Show only the newest N matches (by Bookmark.date, undated last). Absent = all.
  limit?: number;
  bookmark_ids: string[]; // precomputed at sync time
}

// ---- Provider configs -------------------------------------------------------

export type ProviderType = "static" | "json" | "browser" | "linkding" | "feed" | "jsonfeed";

interface BaseProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
}

export interface StaticProviderConfig extends BaseProviderConfig {
  type: "static";
}

export interface JsonProviderConfig extends BaseProviderConfig {
  type: "json";
  data: string;
}

export interface BrowserProviderConfig extends BaseProviderConfig {
  type: "browser";
}

export interface LinkdingProviderConfig extends BaseProviderConfig {
  type: "linkding";
  url: string;
  token: string;
  username?: string; // display label only; not sent to the linkding API (token auth)
}

export interface FeedProviderConfig extends BaseProviderConfig {
  // Web feed: JSON Feed, RSS, or Atom — auto-detected at sync time.
  // "jsonfeed" is a legacy alias from before RSS/Atom support (never store-released,
  // but may exist in local storage); treated identically everywhere.
  type: "feed" | "jsonfeed";
  url: string;
  // Linkblog JSON Feeds (e.g. Daring Fireball) set external_url to the linked page
  // and url to their own commentary permalink; this picks which one to bookmark.
  // RSS/Atom have no such distinction — ignored there.
  preferExternalUrl: boolean;
  // Keep only the newest N feed items at sync time (some feeds ship 150+).
  // Absent = keep all.
  maxItems?: number;
}

export type ProviderConfig =
  | StaticProviderConfig
  | JsonProviderConfig
  | BrowserProviderConfig
  | LinkdingProviderConfig
  | FeedProviderConfig;

// ---- Provider interface -----------------------------------------------------

export interface BookmarkProvider {
  sync(): Promise<Bookmark[]>;
}

// ---- Storage schema ---------------------------------------------------------

export interface StorageSchema {
  bookmarks: BookmarkMap;
  folders: Folder[];
  lastSync: string | null;
  settings: Settings;
  syncStatus: SyncStatus;
}

// ---- Sync status ------------------------------------------------------------

export interface SyncError {
  name: string; // provider name that failed
  message: string; // human-readable reason
}

export interface SyncStatus {
  at: string; // ISO timestamp of the sync that produced this status
  errors: SyncError[];
}

// ---- Settings ---------------------------------------------------------------

export type Theme = "system" | "light" | "dark";

export interface Settings {
  syncIntervalMinutes: number;
  providers: ProviderConfig[];
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  syncIntervalMinutes: 15,
  providers: [
    { id: "static-default", type: "static", name: "Static" },
  ],
  theme: "system",
};

// ---- Messages ---------------------------------------------------------------

export type MessageType = "sync_requested";

export interface Message {
  type: MessageType;
}

// ---- Linkding API response --------------------------------------------------

export interface LinkdingBookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  notes: string;
  web_archive_snapshot_url: string;
  favicon_url: string;
  preview_image_url: string;
  is_archived: boolean;
  unread: boolean;
  shared: boolean;
  tag_names: string[];
  date_added: string;
  date_modified: string;
}

export interface LinkdingResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: LinkdingBookmark[];
}
