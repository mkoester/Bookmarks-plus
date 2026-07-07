import { parseFolders } from "./validation";
import { fnv1a, isDue } from "./sync";
import type { Folder, FolderSourceConfig, FolderSourceState } from "./types";

// Remote folder source: fetch + scheduling helpers for the background loop.
// DOM/ext-free (fetch is a global) so the logic is unit-testable.

// Reserved id the folder source uses in Message.providerId and
// SyncError.providerId. Can't collide with provider config ids — those are
// crypto.randomUUID()s (or the "static-default" built-in).
export const FOLDER_SOURCE_ID = "folder-source";

export interface FolderSourceFetchResult {
  // full: `folders` is the complete new folder list (replaces ALL folders).
  // unchanged: source not modified (304, or identical body by hash) — keep
  //   the stored folders; `folders` is empty.
  kind: "full" | "unchanged";
  folders: Folder[];
  // Fresh validators/hash from a 200 response (absent on a 304).
  etag?: string;
  lastModified?: string;
  contentHash?: string;
}

// Whether the folder source should be fetched in this sync round. Unlike
// providers it is NOT swept along by a forced sync of everything (surfaces
// send sync_requested on every open) — by default it only refreshes on the
// explicit "Sync folders now" buttons (forced), when it was never fetched or
// its URL changed, or at its own opt-in interval.
export function folderSourceDue(
  config: FolderSourceConfig | undefined,
  state: FolderSourceState | undefined,
  nowMs: number,
  forced: boolean
): boolean {
  if (!config || !config.url.trim()) return false;
  if (forced) return true;
  if (!state || state.fingerprint !== config.url) return true;
  const interval = config.syncIntervalMinutes;
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval < 1) {
    return false; // manual refresh only
  }
  return isDue(state, interval, nowMs);
}

// Fetches and validates the folder JSON (same format as the options page's
// folder export, validated by parseFolders). Throws with a user-facing message
// on HTTP/parse/validation failure — the caller turns that into a sync error.
export async function fetchFolderSource(
  config: FolderSourceConfig,
  state?: FolderSourceState
): Promise<FolderSourceFetchResult> {
  // Conditional GET with the validators from the last 200 response — but only
  // when they belong to this URL. cache: "no-store" so OUR validators reach
  // the server instead of being answered by the browser HTTP cache.
  const sameSource = state !== undefined && state.fingerprint === config.url;
  const conditional: Record<string, string> = {};
  if (sameSource) {
    if (state.etag) conditional["If-None-Match"] = state.etag;
    if (state.lastModified) conditional["If-Modified-Since"] = state.lastModified;
  }

  const response = await fetch(config.url, {
    headers: { Accept: "application/json", ...conditional },
    cache: "no-store",
  });
  if (response.status === 304) {
    return { kind: "unchanged", folders: [] };
  }
  // Messages carry no "Folder source" prefix — the sync banner and the options
  // page already label them with the source name.
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const etag = response.headers.get("ETag");
  const lastModified = response.headers.get("Last-Modified");
  const contentHash = fnv1a(text);
  const validators = {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    contentHash,
  };

  // Hash-based unchanged detection for servers without usable validators:
  // skipping the replace keeps folder ids stable (parseFolders generates fresh
  // ids when the file carries none) and avoids a storage write per fetch.
  if (sameSource && state.contentHash === contentHash) {
    return { kind: "unchanged", folders: [], ...validators };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = parseFolders(data);
  if (!parsed.valid) {
    throw new Error(`Invalid folder definitions: ${parsed.errors.join("; ")}`);
  }
  return { kind: "full", folders: parsed.folders, ...validators };
}

// The folder source's new state after a successful fetch. A 304 carries no
// body or validators, so "unchanged" keeps the previous ones.
export function nextFolderSourceState(
  state: FolderSourceState | undefined,
  url: string,
  attemptIso: string,
  result: FolderSourceFetchResult
): FolderSourceState {
  const keepPrevious = result.kind === "unchanged";
  const etag = result.etag ?? (keepPrevious ? state?.etag : undefined);
  const lastModified = result.lastModified ?? (keepPrevious ? state?.lastModified : undefined);
  const contentHash = result.contentHash ?? (keepPrevious ? state?.contentHash : undefined);
  return {
    lastSyncAt: attemptIso,
    lastAttemptAt: attemptIso,
    fingerprint: url,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}
