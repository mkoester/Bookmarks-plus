import ext from "./browser";
import type {
  BookmarkMap,
  Folder,
  FolderSourceState,
  ProviderSyncStateMap,
  Settings,
  StorageSchema,
  SyncStatus,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { STATIC_FOLDERS } from "./data/static";
import { parseFolders } from "./validation";

export async function getSettings(): Promise<Settings> {
  const result = await ext.storage.local.get("settings");
  const stored = result.settings as Partial<Settings> | undefined;
  if (!stored) return DEFAULT_SETTINGS;
  // Backfill fields added after this install first saved its settings.
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await ext.storage.local.set({ settings });
}

export async function getBookmarks(): Promise<BookmarkMap> {
  const result = await ext.storage.local.get("bookmarks");
  return (result.bookmarks as BookmarkMap) ?? {};
}

export async function getFolders(): Promise<Folder[]> {
  const result = await ext.storage.local.get("folders");
  if (result.folders === undefined) return STATIC_FOLDERS;
  // An empty list is a legitimate saved state (parseFolders rejects it only to
  // protect imports from wiping folders by accident).
  if (Array.isArray(result.folders) && result.folders.length === 0) return [];
  // Validate instead of blindly casting; keep the parseable entries and warn
  // about the rest (membership is recomputed at sync, so nothing else breaks).
  const parsed = parseFolders(result.folders);
  if (!parsed.valid) {
    console.warn("Ignoring invalid stored folders:", parsed.errors);
  }
  return parsed.folders;
}

export async function saveFolders(folders: Folder[]): Promise<void> {
  await ext.storage.local.set({ folders });
}

export async function getLastSync(): Promise<string | null> {
  const result = await ext.storage.local.get("lastSync");
  return (result.lastSync as string) ?? null;
}

export async function saveBookmarksAndSync(
  bookmarks: BookmarkMap,
  folders: Folder[],
  lastSync: string
): Promise<void> {
  const update: Partial<StorageSchema> = { bookmarks, folders, lastSync };
  await ext.storage.local.set(update);
}

export async function getProviderSyncState(): Promise<ProviderSyncStateMap> {
  const result = await ext.storage.local.get("providerSyncState");
  return (result.providerSyncState as ProviderSyncStateMap) ?? {};
}

export async function saveProviderSyncState(state: ProviderSyncStateMap): Promise<void> {
  await ext.storage.local.set({ providerSyncState: state });
}

export async function getFolderSourceState(): Promise<FolderSourceState | null> {
  const result = await ext.storage.local.get("folderSourceState");
  return (result.folderSourceState as FolderSourceState) ?? null;
}

// null clears the state (folder source removed from the settings).
export async function saveFolderSourceState(state: FolderSourceState | null): Promise<void> {
  if (state === null) {
    await ext.storage.local.remove("folderSourceState");
  } else {
    await ext.storage.local.set({ folderSourceState: state });
  }
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const result = await ext.storage.local.get("syncStatus");
  return (result.syncStatus as SyncStatus) ?? null;
}

export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await ext.storage.local.set({ syncStatus: status });
}
