import { bookmarksToMap } from "./bookmarks";
import type {
  Bookmark,
  BookmarkMap,
  ProviderConfig,
  ProviderSyncState,
  Settings,
  SyncError,
  SyncResult,
} from "./types";

// Pure helpers for the background sync loop: per-provider scheduling, config
// fingerprinting, and merging a provider's sync result into the stored map.
// DOM/ext-free so they're unit-testable.

// Incremental syncs can't see deletions (linkding has no tombstone API; an
// archived bookmark just vanishes from the list), so a full sync is forced at
// least this often (hours) to reconcile them. Per-provider configurable via
// fullSyncIntervalHours.
export const DEFAULT_FULL_SYNC_HOURS = 24;

// The provider's full-sync ceiling in ms: its own fullSyncIntervalHours when
// sane, otherwise the 24 h default.
export function fullSyncMaxAgeMs(config: ProviderConfig): number {
  const hours = "fullSyncIntervalHours" in config ? config.fullSyncIntervalHours : undefined;
  const effective =
    typeof hours === "number" && Number.isFinite(hours) && hours >= 1
      ? hours
      : DEFAULT_FULL_SYNC_HOURS;
  return effective * 60 * 60 * 1000;
}

// The per-provider interval that actually applies: the provider's own override
// when it's a sane positive number, otherwise the global setting.
export function effectiveIntervalMinutes(config: ProviderConfig, globalMinutes: number): number {
  const override = "syncIntervalMinutes" in config ? config.syncIntervalMinutes : undefined;
  return typeof override === "number" && Number.isFinite(override) && override >= 1
    ? override
    : globalMinutes;
}

// The alarm has to tick as often as the most impatient provider wants. A
// folder source with automatic refresh joins that race; a manual-only one
// (no interval) never influences the alarm.
export function alarmPeriodMinutes(settings: Settings): number {
  const intervals = settings.providers.map((p) =>
    effectiveIntervalMinutes(p, settings.syncIntervalMinutes)
  );
  const folderInterval = settings.folderSource?.syncIntervalMinutes;
  if (typeof folderInterval === "number" && Number.isFinite(folderInterval) && folderInterval >= 1) {
    intervals.push(folderInterval);
  }
  return Math.max(1, Math.min(settings.syncIntervalMinutes, ...intervals));
}

// Whether a provider (or the folder source) should be synced on this tick.
// Based on the last ATTEMPT (not last success), so a failing source retries at
// its interval instead of hammering its server on every alarm tick.
// Missing/unparseable state = due.
export function isDue(
  state: { lastAttemptAt: string } | undefined,
  intervalMinutes: number,
  nowMs: number
): boolean {
  if (!state) return true;
  const last = Date.parse(state.lastAttemptAt);
  // NaN-safe: an unparseable timestamp must mean "due", so express the
  // negative ("recent enough") and invert.
  return !(nowMs - last < intervalMinutes * 60_000);
}

// Whether the next sync must be a full one: no usable state yet, the config
// changed since the state was written, or the periodic deletion-reconciliation
// full sync is overdue. Wall-clock based, so time spent asleep/powered off
// counts — the first sync after wake goes full if the ceiling passed meanwhile.
export function needsFullSync(
  state: ProviderSyncState | undefined,
  fingerprint: string,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!state || state.fingerprint !== fingerprint) return true;
  const lastFull = Date.parse(state.lastFullSyncAt);
  return !(nowMs - lastFull < maxAgeMs);
}

// Stable digest of the sync-relevant config fields; a change invalidates the
// provider's incremental state (cursor/validators) via needsFullSync.
export function providerFingerprint(config: ProviderConfig): string {
  switch (config.type) {
    case "linkding":
      return `linkding|${config.url}|${config.token}`;
    case "feed":
    case "jsonfeed":
      return `feed|${config.url}|${config.preferExternalUrl}|${config.maxItems ?? ""}`;
    case "json":
      // The pasted data can be large — hash it instead of storing a copy.
      return `json|${fnv1a(config.data)}`;
    default:
      return config.type;
  }
}

// FNV-1a 32-bit — tiny non-cryptographic hash, enough to detect config edits
// (json provider fingerprint) and unchanged folder-source bodies.
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// Merges one provider's sync result into the full bookmark map (returns a new
// map): full = replace the provider's slice, incremental = upsert into it,
// unchanged = keep as-is.
export function applySyncResult(
  map: BookmarkMap,
  providerId: string,
  result: SyncResult
): BookmarkMap {
  if (result.kind === "unchanged") return map;
  const fresh = bookmarksToMap(result.bookmarks);
  if (result.kind === "incremental") {
    return { ...map, ...fresh };
  }
  const prefix = `${providerId}:`;
  const kept = Object.fromEntries(
    Object.entries(map).filter(([id]) => !id.startsWith(prefix))
  );
  return { ...kept, ...fresh };
}

// Drops bookmarks whose provider config no longer exists (closes the old
// "removed provider's bookmarks linger until the next full sync" gap).
export function pruneBookmarks(map: BookmarkMap, activeProviderIds: string[]): BookmarkMap {
  const prefixes = activeProviderIds.map((id) => `${id}:`);
  return Object.fromEntries(
    Object.entries(map).filter(([id]) => prefixes.some((p) => id.startsWith(p)))
  );
}

// The next incremental cursor for linkding: the highest date_modified seen.
// toIsoDate() normalises all values through Date.toISOString(), so plain
// lexicographic comparison is chronological.
export function maxModifiedCursor(bookmarks: Bookmark[], previous?: string): string | undefined {
  let max = previous;
  for (const b of bookmarks) {
    const mod = b.dateModified ?? b.date;
    if (mod !== undefined && (max === undefined || mod > max)) max = mod;
  }
  return max;
}

// Sync statuses are now partial (only due providers are attempted), so errors
// from earlier rounds must survive until their provider is retried or removed.
// Entries without a providerId (pre-rework format) are dropped once.
export function mergeSyncErrors(
  previous: SyncError[],
  attemptedIds: Set<string>,
  fresh: SyncError[],
  activeProviderIds: string[]
): SyncError[] {
  const active = new Set(activeProviderIds);
  const kept = previous.filter(
    (e) =>
      e.providerId !== undefined && active.has(e.providerId) && !attemptedIds.has(e.providerId)
  );
  return [...kept, ...fresh];
}
