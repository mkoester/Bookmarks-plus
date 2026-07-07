import { FOLDER_SOURCE_ID } from "./folderSource";
import type { SyncStatus } from "./types";

// Builds the "couldn't reach a provider" banner, or null when the last sync was
// clean. Shared by the new-tab, popup, and sidebar surfaces so the wording and
// markup stay consistent. All text goes through textContent — never innerHTML —
// because provider names and error messages are untrusted.
export function renderSyncErrorBanner(status: SyncStatus | null): HTMLElement | null {
  if (!status || status.errors.length === 0) return null;

  const banner = document.createElement("div");
  banner.className = "sync-error";
  banner.setAttribute("role", "alert");

  // The remote folder source fails differently from a bookmark provider (it's
  // the folder definitions that are stale, not the bookmarks) — say which.
  const hasFolderError = status.errors.some((e) => e.providerId === FOLDER_SOURCE_ID);
  const hasProviderError = status.errors.some((e) => e.providerId !== FOLDER_SOURCE_ID);

  const heading = document.createElement("strong");
  heading.textContent =
    hasFolderError && !hasProviderError
      ? "The folder source couldn't be synced"
      : hasProviderError && hasFolderError
        ? "Some syncs failed"
        : status.errors.length === 1
          ? "A provider couldn't be reached"
          : "Some providers couldn't be reached";
  banner.appendChild(heading);

  const list = document.createElement("ul");
  for (const error of status.errors) {
    const li = document.createElement("li");
    li.textContent = `${error.name}: ${error.message}`;
    list.appendChild(li);
  }
  banner.appendChild(list);

  const note = document.createElement("p");
  note.className = "sync-error-note";
  note.textContent =
    hasFolderError && !hasProviderError
      ? "Showing the folders from the last successful sync."
      : hasProviderError && hasFolderError
        ? "Showing the last bookmarks and folders that did sync."
        : "Showing the last bookmarks that did sync.";
  banner.appendChild(note);

  return banner;
}
