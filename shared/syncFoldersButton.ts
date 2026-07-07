import ext from "./browser";
import { getSettings } from "./storage";
import { FOLDER_SOURCE_ID } from "./folderSource";
import type { Message } from "./types";

// Wiring for the surfaces' "Sync folders now" button (popup/sidebar/newtab):
// the button lives hidden in each surface's HTML next to the Settings button
// and only appears while a remote folder source is configured. Not imported by
// pure modules — it touches ext + DOM (kept out of folderSource.ts so that one
// stays unit-testable).

// Shows/hides the button to match the current settings; also called from the
// sidebar/newtab storage listeners when the settings change.
export async function refreshSyncFoldersButton(): Promise<void> {
  const button = document.getElementById("sync-folders") as HTMLButtonElement | null;
  if (!button) return;
  const settings = await getSettings();
  button.hidden = !settings.folderSource?.url;
}

// Sets the initial visibility and wires the click: a forced sync of the folder
// source only. The background responds once the fetch finished; onSynced lets
// the popup (which has no storage listener) re-render with the fresh folders.
export async function initSyncFoldersButton(
  onSynced?: () => void | Promise<void>
): Promise<void> {
  const button = document.getElementById("sync-folders") as HTMLButtonElement | null;
  if (!button) return;
  await refreshSyncFoldersButton();
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.classList.add("syncing");
    try {
      const message: Message = { type: "sync_provider", providerId: FOLDER_SOURCE_ID };
      await ext.runtime.sendMessage(message);
      await onSynced?.();
    } catch {
      // background not ready — nothing to refresh
    }
    button.disabled = false;
    button.classList.remove("syncing");
  });
}
