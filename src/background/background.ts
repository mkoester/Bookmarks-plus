import ext from "@shared/browser";
import {
  getBookmarks,
  getFolders,
  getProviderSyncState,
  getSettings,
  getSyncStatus,
  saveBookmarksAndSync,
  saveProviderSyncState,
  saveSyncStatus,
} from "@shared/storage";
import { computeFolderMembership } from "@shared/bookmarks";
import {
  alarmPeriodMinutes,
  applySyncResult,
  effectiveIntervalMinutes,
  fullSyncMaxAgeMs,
  isDue,
  maxModifiedCursor,
  mergeSyncErrors,
  needsFullSync,
  providerFingerprint,
  pruneBookmarks,
} from "@shared/sync";
import { createProvider } from "@shared/providers/index";
import { debugLog } from "@shared/debug";
import type {
  Message,
  ProviderSyncState,
  SyncContext,
  SyncError,
  SyncResult,
} from "@shared/types";

const SYNC_ALARM = "bookmarks-plus-sync";
const MIN_SYNC_INTERVAL_MS = 60_000;

let syncing = false;
let lastSyncAttempt = 0;

// ---- Setup ------------------------------------------------------------------

ext.runtime.onInstalled.addListener(async (details) => {
  debugLog("Extension installed, running initial sync");
  await setupAlarm();
  await sync();

  // First-time install only: show a welcome page that nudges the user to pin the extension
  // (browsers offer no API to pin programmatically).
  if (details.reason === "install") {
    ext.tabs.create({ url: ext.runtime.getURL("onboarding/onboarding.html") });
  }
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    sync();
  }
});

// Keep the alarm period in step with the settings (global interval or a
// per-provider override changed). Previously the alarm was only created in
// onInstalled, so interval changes silently never took effect.
ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    setupAlarm();
  }
});

// Chromium-only: keyboard shortcut to TOGGLE the side panel (the command is declared only in the
// Chrome manifest; Firefox toggles its sidebar via the built-in _execute_sidebar_action command).
//
// Chrome has no reliable close() for a global panel, so we track which windows currently have the
// panel open via a connection port the panel opens on load (and that disconnects when it closes).
// Toggle = if open, ask the panel to close itself (window.close()); else open it. open() is called
// directly in the handler so the user gesture isn't lost to an await.
const openSidePanels = new Map<number, chrome.runtime.Port>();

if (typeof chrome !== "undefined" && chrome.runtime?.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    const match = /^sidepanel:(-?\d+)$/.exec(port.name);
    if (!match) return;
    const windowId = Number(match[1]);
    openSidePanels.set(windowId, port);
    port.onDisconnect.addListener(() => {
      if (openSidePanels.get(windowId) === port) openSidePanels.delete(windowId);
    });
  });
}

if (typeof chrome !== "undefined" && chrome.commands && chrome.sidePanel) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== "open-side-panel" || tab?.windowId == null) return;
    const open = openSidePanels.get(tab.windowId);
    if (open) {
      open.postMessage({ type: "close" });
    } else {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}

// ---- Message handling -------------------------------------------------------

ext.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    if (message.type === "sync_requested") {
      // Explicit user-initiated sync: bypass the time-based debounce.
      sync(true);
      sendResponse({ accepted: true });
      return false;
    }
    if (message.type === "sync_provider" && message.providerId) {
      // "Sync now" on one provider: respond only once the sync finished, so
      // the options page can reload the sync state afterwards. Returning true
      // keeps the message channel open for the async sendResponse.
      sync(true, message.providerId).then(() => sendResponse({ done: true }));
      return true;
    }
    return false;
  }
);

// ---- Alarm ------------------------------------------------------------------

async function setupAlarm(): Promise<void> {
  const settings = await getSettings();
  await ext.alarms.clearAll();
  // Tick as often as the most impatient provider (per-provider overrides can
  // be shorter than the global interval); each tick only syncs providers due.
  ext.alarms.create(SYNC_ALARM, {
    periodInMinutes: alarmPeriodMinutes(settings),
  });
}

// ---- Sync -------------------------------------------------------------------

// force bypasses the debounce and the per-provider schedule (not the
// incremental logic). onlyProviderId narrows a forced sync to one provider
// (the "Sync now" button).
async function sync(force = false, onlyProviderId?: string): Promise<void> {
  if (syncing) {
    debugLog("Sync already in progress, skipping");
    return;
  }

  const now = Date.now();
  if (!force && now - lastSyncAttempt < MIN_SYNC_INTERVAL_MS) {
    debugLog("Sync debounced, too soon since last attempt");
    return;
  }

  syncing = true;
  lastSyncAttempt = now;

  try {
    const settings = await getSettings();
    const syncState = await getProviderSyncState();
    let map = await getBookmarks();
    const errors: SyncError[] = [];
    const attempted = new Set<string>();
    let anyChange = false;

    for (const config of settings.providers) {
      if (onlyProviderId !== undefined && config.id !== onlyProviderId) continue;
      const interval = effectiveIntervalMinutes(config, settings.syncIntervalMinutes);
      const state = syncState[config.id];
      // force (user-initiated) bypasses the schedule, not the incremental path —
      // fingerprint changes and the periodic full sync still decide `full`.
      if (!force && !isDue(state, interval, now)) continue;
      attempted.add(config.id);

      const fingerprint = providerFingerprint(config);
      const full = needsFullSync(state, fingerprint, now, fullSyncMaxAgeMs(config));
      const ctx: SyncContext = {
        full,
        since: state?.cursor,
        etag: state?.etag,
        lastModified: state?.lastModified,
      };
      const attemptIso = new Date().toISOString();

      try {
        const provider = createProvider(config);
        const result = await provider.sync(ctx);
        map = applySyncResult(map, config.id, result);
        if (result.kind !== "unchanged") anyChange = true;
        syncState[config.id] = nextSyncState(state, fingerprint, attemptIso, result);
        debugLog(`Provider "${config.name}": ${result.kind}, ${result.bookmarks.length} bookmarks`);
      } catch (err) {
        console.error(`Provider "${config.name}" sync failed:`, err);
        errors.push({ name: config.name, message: describeError(err), providerId: config.id });
        // Record the attempt so a failing provider retries at its own interval
        // instead of on every alarm tick.
        syncState[config.id] = state
          ? { ...state, lastAttemptAt: attemptIso }
          : { lastSyncAt: "", lastAttemptAt: attemptIso, lastFullSyncAt: "", fingerprint };
      }
    }

    // Reconcile removed providers: drop their bookmarks and sync state.
    const activeIds = settings.providers.map((p) => p.id);
    const pruned = pruneBookmarks(map, activeIds);
    if (Object.keys(pruned).length !== Object.keys(map).length) anyChange = true;
    map = pruned;
    for (const id of Object.keys(syncState)) {
      if (!activeIds.includes(id)) delete syncState[id];
    }

    if (!force && attempted.size === 0 && !anyChange) {
      debugLog("Sync tick: no provider due, nothing to do");
      return;
    }

    // force always recomputes folders — an options Save may have changed folder
    // rules even when every provider reported "unchanged".
    if (force || anyChange) {
      const folders = await getFolders();
      const recomputed = computeFolderMembership(map, folders);
      await saveBookmarksAndSync(map, recomputed, new Date().toISOString());
    }
    await saveProviderSyncState(syncState);

    const previous = await getSyncStatus();
    const merged = mergeSyncErrors(previous?.errors ?? [], attempted, errors, activeIds);
    await saveSyncStatus({ at: new Date().toISOString(), errors: merged });
    debugLog(`Sync complete: ${attempted.size} providers attempted, ${Object.keys(map).length} bookmarks total`);
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    syncing = false;
  }
}

// The provider's new sync state after a successful sync.
function nextSyncState(
  state: ProviderSyncState | undefined,
  fingerprint: string,
  attemptIso: string,
  result: SyncResult
): ProviderSyncState {
  if (result.kind === "unchanged") {
    // Keep cursor/validators; just record the successful check.
    return {
      lastSyncAt: attemptIso,
      lastAttemptAt: attemptIso,
      lastFullSyncAt: state?.lastFullSyncAt ?? "",
      fingerprint,
      ...(state?.cursor ? { cursor: state.cursor } : {}),
      ...(state?.etag ? { etag: state.etag } : {}),
      ...(state?.lastModified ? { lastModified: state.lastModified } : {}),
    };
  }
  const full = result.kind === "full";
  // Full: rebuild the cursor from the complete corpus (a stale one could skip
  // updates if the source rolled back). Incremental: advance it.
  const cursor = maxModifiedCursor(result.bookmarks, full ? undefined : state?.cursor);
  return {
    lastSyncAt: attemptIso,
    lastAttemptAt: attemptIso,
    lastFullSyncAt: full ? attemptIso : state?.lastFullSyncAt ?? "",
    fingerprint,
    ...(cursor ? { cursor } : {}),
    ...(result.etag ? { etag: result.etag } : {}),
    ...(result.lastModified ? { lastModified: result.lastModified } : {}),
  };
}

// A short, user-facing reason for a provider failure. Linkding throws
// "Linkding API error: HTTP 401"; a network/CORS failure surfaces as a TypeError.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TypeError") return "Couldn't connect (network, CORS, or host permission).";
    return err.message;
  }
  return String(err);
}
