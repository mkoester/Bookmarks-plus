import ext from "@shared/browser";
import {
  getBookmarks,
  getFolders,
  getFolderSourceState,
  getProviderSyncState,
  getSettings,
  getSyncStatus,
  saveFolders,
  saveSettings,
} from "@shared/storage";
import { applyStoredTheme, setTheme } from "@shared/theme";
import { applyBuildBadge, installedVersion } from "@shared/buildBadge";
import { FOLDER_SOURCE_ID } from "@shared/folderSource";
import type {
  BookmarkMap,
  BrowserProviderConfig,
  Folder,
  FolderSourceConfig,
  FolderSourceState,
  FeedProviderConfig,
  LinkdingProviderConfig,
  JsonProviderConfig,
  MatchMode,
  Message,
  ProviderConfig,
  ProviderSyncStateMap,
  ProviderType,
  RuleCondition,
  RuleGroup,
  Settings,
  Surface,
  Theme,
} from "@shared/types";
import { isRuleGroup } from "@shared/types";
import { parseFolders, parseRuleGroup } from "@shared/validation";
import { insertionIndexForY } from "@shared/reorder";
import { fuzzyFilterTags, highlightRuns, type TagCount, type TagSuggestion } from "@shared/fuzzy";

// Provider types that may only exist once (no per-instance config to distinguish them).
const SINGLETON_PROVIDER_TYPES = new Set<ProviderType>(["static", "browser"]);

// The bundled demo bookmarks/folders, so users can see what tags/titles/URLs the
// static provider supplies when crafting folder rules.
const STATIC_DATA_URL =
  "https://raw.githubusercontent.com/mkoester/Bookmarks-plus/refs/heads/main/shared/data/static.ts";

let folders: Folder[] = [];
let providers: ProviderConfig[] = [];
let bookmarks: BookmarkMap = {};
let providerSyncState: ProviderSyncStateMap = {};
let syncIntervalMinutes = 15;
let theme: Theme = "system";
let newTabCloseOnOpenAll = false;
// Remote folder source — form state (persisted on Save) plus the last SAVED
// config: "Sync folders now" and the origin-revocation logic act on what the
// background actually uses, not on unsaved edits.
let folderSourceUrl = "";
let folderSourceIntervalMinutes: number | undefined;
// Pause toggle (form state): false = source is dormant and folders edit locally
// again. Its URL/permission are kept so it resumes with one click.
let folderSourceEnabled = true;
let savedFolderSource: FolderSourceConfig | undefined;
let folderSourceState: FolderSourceState | null = null;
// Snapshot of the folders as they were when the source last OWNED them (set on
// load while active, and when the toggle is switched to paused). The re-enable
// guard compares against it to tell whether local edits would be lost when the
// remote file takes over again. null = we can't prove nothing changed.
let foldersBaseline: string | null = null;
// The folder source's sticky sync error (from syncStatus), shown inline on the
// Folders tab so a failing source is visible right where it's configured.
let folderSourceError: string | null = null;
let grantedHostOrigins: string[] = [];
let activeTabId = "overview";
let tagSort: { key: "tag" | "count"; dir: "asc" | "desc" } = { key: "count", dir: "desc" };

async function init(): Promise<void> {
  const [settings, savedFolders, savedBookmarks, savedSyncState, savedFolderSourceState, syncStatus] =
    await Promise.all([
      getSettings(),
      getFolders(),
      getBookmarks(),
      getProviderSyncState(),
      getFolderSourceState(),
      getSyncStatus(),
    ]);

  folders = savedFolders;
  providers = settings.providers;
  bookmarks = savedBookmarks;
  providerSyncState = savedSyncState;
  syncIntervalMinutes = settings.syncIntervalMinutes;
  theme = settings.theme;
  newTabCloseOnOpenAll = settings.newTabCloseOnOpenAll;
  savedFolderSource = settings.folderSource;
  folderSourceUrl = settings.folderSource?.url ?? "";
  folderSourceIntervalMinutes = settings.folderSource?.syncIntervalMinutes;
  folderSourceEnabled = settings.folderSource?.enabled !== false;
  // If the source is active on load, the folders in storage are the remote-owned
  // ones — snapshot them as the baseline the re-enable guard compares against.
  foldersBaseline = folderSourceActive() ? JSON.stringify(folders) : null;
  folderSourceState = savedFolderSourceState;
  folderSourceError =
    syncStatus?.errors.find((e) => e.providerId === FOLDER_SOURCE_ID)?.message ?? null;

  await applyStoredTheme();
  applyBuildBadge();
  await loadGrantedOrigins();

  // Installed build's version (version_name on Chromium / version on Firefox for
  // non-release builds — see installedVersion()). Undefined under the screenshot
  // harness's manifest mock, so the header stays untouched there.
  const version = installedVersion();
  if (version) {
    document.getElementById("version")!.textContent = `v${version}`;
  }

  document.getElementById("save")?.addEventListener("click", save);
  renderTabs();
}

// ---- Tabs -------------------------------------------------------------------

interface TabDef {
  id: string;
  label: string;
  render: () => HTMLElement;
}

function buildTabs(): TabDef[] {
  const tabs: TabDef[] = [
    { id: "overview", label: "Overview", render: renderOverviewPanel },
    { id: "folders", label: "Folders", render: renderFoldersPanel },
  ];

  providers.forEach((provider) => {
    tabs.push({
      id: `provider:${provider.id}`,
      label: providerTabLabel(provider),
      render: () => renderProviderPanel(provider.id),
    });
  });

  if (grantedHostOrigins.length > 0) {
    tabs.push({ id: "permissions", label: "Permissions", render: renderPermissionsPanel });
  }

  return tabs;
}

function renderTabs(): void {
  const tabs = buildTabs();
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = "overview";
  }

  const bar = document.getElementById("tab-bar")!;
  bar.innerHTML = "";
  tabs.forEach((tab) => {
    const btn = document.createElement("button");
    btn.className = tab.id === activeTabId ? "tab active" : "tab";
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      activeTabId = tab.id;
      renderTabs();
    });
    bar.appendChild(btn);
  });

  const panels = document.getElementById("tab-panels")!;
  panels.innerHTML = "";
  panels.appendChild(tabs.find((t) => t.id === activeTabId)!.render());
}

// ---- Overview panel ---------------------------------------------------------

function renderOverviewPanel(): HTMLElement {
  const root = document.createElement("div");

  // Providers
  const providerSection = document.createElement("section");
  providerSection.appendChild(sectionHeading("Providers"));
  providerSection.appendChild(
    hint("Bookmarks are fetched from one or more providers and merged into a single collection.")
  );

  providers.forEach((provider) => {
    providerSection.appendChild(renderProviderRow(provider));
  });

  const addRow = document.createElement("div");
  addRow.className = "add-provider-row";
  const select = document.createElement("select");
  const existingTypes = new Set(providers.map((p) => p.type));
  ([
    ["static", "Static (built-in demo data)"],
    ["json", "JSON (paste your own)"],
    ["browser", "Browser bookmarks"],
    ["linkding", "Linkding"],
    ["feed", "Web feed (RSS, Atom, JSON Feed)"],
  ] as Array<[ProviderType, string]>)
    // static and browser are singletons — hide them from the menu once one exists
    .filter(([value]) => !(SINGLETON_PROVIDER_TYPES.has(value) && existingTypes.has(value)))
    .forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add provider";
  addBtn.addEventListener("click", () => addProvider(select.value as ProviderType));
  addRow.appendChild(select);
  addRow.appendChild(addBtn);
  providerSection.appendChild(addRow);

  root.appendChild(providerSection);

  // Sync
  const syncSection = document.createElement("section");
  syncSection.appendChild(sectionHeading("Sync"));
  const intervalLabel = document.createElement("label");
  intervalLabel.textContent = "Sync interval (minutes)";
  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.min = "1";
  intervalInput.max = "60";
  intervalInput.value = String(syncIntervalMinutes);
  intervalInput.addEventListener("input", () => {
    syncIntervalMinutes = parseInt(intervalInput.value, 10) || syncIntervalMinutes;
  });
  intervalLabel.appendChild(intervalInput);
  syncSection.appendChild(intervalLabel);
  syncSection.appendChild(
    hint(
      "Providers whose source can change on its own (Linkding, web feeds, browser bookmarks) " +
      "can override this interval on their own tab."
    )
  );
  root.appendChild(syncSection);

  // Appearance
  const appearanceSection = document.createElement("section");
  appearanceSection.appendChild(sectionHeading("Appearance"));
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Theme";
  const themeSelect = document.createElement("select");
  ([
    ["system", "System (match your OS)"],
    ["light", "Light"],
    ["dark", "Dark"],
  ] as Array<[Theme, string]>).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (theme === value) opt.selected = true;
    themeSelect.appendChild(opt);
  });
  themeSelect.addEventListener("change", () => {
    theme = themeSelect.value as Theme;
    setTheme(theme); // live preview; persisted on Save
  });
  themeLabel.appendChild(themeSelect);
  appearanceSection.appendChild(themeLabel);
  root.appendChild(appearanceSection);

  // New Tab page (informational — the browser, not the extension, controls whether it's used)
  const newTabSection = document.createElement("section");
  newTabSection.appendChild(sectionHeading("New Tab page"));
  newTabSection.appendChild(
    hint(
      "Bookmarks+ can replace your New Tab page. Your browser controls this, not this setting: " +
      "Firefox shows a notification (or Settings → Home → New Tabs); Chromium shows a keep/revert " +
      "prompt the first time. When New Tab is handed to Bookmarks+, new tabs show the launcher."
    )
  );

  const closeLabel = document.createElement("label");
  closeLabel.className = "checkbox";
  const closeInput = document.createElement("input");
  closeInput.type = "checkbox";
  closeInput.checked = newTabCloseOnOpenAll;
  closeInput.addEventListener("change", () => {
    newTabCloseOnOpenAll = closeInput.checked;
  });
  closeLabel.appendChild(closeInput);
  closeLabel.append(
    "Close the New Tab page after \"Open all in background tabs\" on a folder " +
    "(unchecked: the launcher stays open)"
  );
  newTabSection.appendChild(closeLabel);

  root.appendChild(newTabSection);

  return root;
}

// ---- Folders panel ----------------------------------------------------------

function renderFoldersPanel(): HTMLElement {
  const section = document.createElement("section");
  section.appendChild(sectionHeading("Folders"));
  section.appendChild(
    hint(
      "Folders are defined as rules that match bookmarks by tag, URL, title, or provider. " +
      "Conditions can be nested into ALL / ANY / NONE groups, e.g. A AND (B OR C)."
    )
  );
  section.appendChild(renderFolderSourceSection());

  // While a remote source is active, the file is the single source of truth:
  // every refresh replaces all folders, so local edits would be silently
  // overwritten — show the folders read-only instead. A PAUSED source falls
  // through to the editable view below. Export stays available (it's how a
  // remote file is seeded from the current folders).
  if (folderSourceActive()) {
    jsonEdit.clear();
    section.appendChild(
      hint(
        "Folders are managed by the remote source above — local editing is disabled because " +
        "every refresh replaces all folders. Clear the source URL (and Save) to edit them " +
        "here again."
      )
    );
    const list = document.createElement("div");
    list.className = "folders-readonly";
    folders.forEach((folder) => list.appendChild(renderFolderReadOnly(folder)));
    section.appendChild(list);
    section.appendChild(renderFolderBackupSection(false));
    return section;
  }

  section.appendChild(renderLogicHelp());
  section.appendChild(renderSortHelp());

  // Dedicated container so folder drag-reorder has a clean sibling list (and a
  // positioning context for its .drop-marker) — the section also holds
  // headings, help blocks and buttons.
  const list = document.createElement("div");
  list.className = "folders-list";
  folders.forEach((folder, index) => {
    list.appendChild(renderFolderEditor(folder, index, list));
  });
  section.appendChild(list);

  const addFolderBtn = document.createElement("button");
  addFolderBtn.textContent = "+ Add folder";
  addFolderBtn.addEventListener("click", addFolder);
  section.appendChild(addFolderBtn);

  section.appendChild(renderFolderBackupSection(true));

  return section;
}

// ---- Remote folder source -----------------------------------------------------

// A URL is entered (the toggle + sync button are relevant).
function folderSourceConfigured(): boolean {
  return folderSourceUrl.trim() !== "";
}

// Configured AND not paused — only then does the file own the folders (read-only
// editor, save skips saveFolders). Mirrors isFolderSourceActive on the settings.
function folderSourceActive(): boolean {
  return folderSourceConfigured() && folderSourceEnabled;
}

// The re-enable guard: true = safe to resume (no local edits at risk, or the
// user accepted losing them). Skips the prompt when the folders still match the
// remote-owned snapshot; a null baseline means we can't prove that, so it asks.
function confirmReEnableFolderSource(): boolean {
  const foldersDiverged = foldersBaseline === null || JSON.stringify(folders) !== foldersBaseline;
  if (!foldersDiverged) return true;
  return window.confirm(
    "Enable the remote folder source?\n\n" +
    "Its next refresh will REPLACE all folders with the file at:\n" +
    `${folderSourceUrl.trim()}\n\n` +
    "Any local folder edits not yet uploaded to that file will be lost. " +
    "Export and upload them first if you want to keep them."
  );
}

function renderFolderSourceSection(): HTMLElement {
  const div = document.createElement("div");
  div.className = "folder-source";

  div.appendChild(sectionHeading("Remote folder source"));
  div.appendChild(
    hint(
      "Optionally load all folder definitions from a JSON file on a web server (same format " +
      "as Export/Import). Use a RAW file URL — e.g. raw.githubusercontent.com or " +
      "gist.githubusercontent.com, not the github.com page — Save asks for permission to " +
      "access exactly that host. Provider conditions reference this installation's provider " +
      "ids, so they don't port across machines; tag/URL/title rules do."
    )
  );

  const urlLabel = document.createElement("label");
  urlLabel.textContent = "Source URL (empty = folders are edited locally)";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "folder-source-url";
  urlInput.value = folderSourceUrl;
  urlInput.placeholder = "https://raw.githubusercontent.com/you/repo/main/folders.json";
  urlInput.addEventListener("input", () => {
    folderSourceUrl = urlInput.value.trim();
  });
  // Whether the folder editor below is editable depends on this field; only
  // re-render when the user leaves it (per keystroke would steal the focus).
  urlInput.addEventListener("change", () => renderTabs());
  urlLabel.appendChild(urlInput);
  div.appendChild(urlLabel);

  const intervalLabel = document.createElement("label");
  intervalLabel.textContent =
    "Refresh automatically every N minutes (empty = only via \"Sync folders now\")";
  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.className = "folder-source-interval";
  intervalInput.min = "1";
  intervalInput.placeholder = "manual";
  intervalInput.value =
    folderSourceIntervalMinutes !== undefined ? String(folderSourceIntervalMinutes) : "";
  intervalInput.addEventListener("input", () => {
    const n = parseInt(intervalInput.value, 10);
    folderSourceIntervalMinutes = Number.isInteger(n) && n > 0 ? n : undefined;
  });
  intervalLabel.appendChild(intervalInput);
  div.appendChild(intervalLabel);

  // Pause toggle — only meaningful once a URL is entered. Pausing keeps the URL
  // (and its host permission) but lets you edit folders locally; re-enabling
  // hands ownership back to the file. Lets you iterate locally, upload, resume.
  if (folderSourceConfigured()) {
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "checkbox";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "folder-source-enabled";
    toggle.checked = folderSourceEnabled;
    toggle.addEventListener("change", () => {
      if (toggle.checked) {
        // Re-enable guard: resuming hands folder ownership back to the file,
        // whose next fetch REPLACES all folders. If edits made while paused
        // would be lost (diverged from the snapshot, or we can't prove they
        // didn't), confirm before resuming; on cancel, stay paused.
        if (!confirmReEnableFolderSource()) {
          toggle.checked = false;
          return;
        }
        folderSourceEnabled = true;
      } else {
        // Snapshot the remote-owned folders at the moment of pausing, so a later
        // re-enable can tell whether the edits made while paused diverge.
        foldersBaseline = JSON.stringify(folders);
        folderSourceEnabled = false;
      }
      renderTabs();
    });
    toggleLabel.appendChild(toggle);
    toggleLabel.append("Sync folders from this URL (uncheck to edit folders locally)");
    div.appendChild(toggleLabel);
    if (!folderSourceEnabled) {
      div.appendChild(
        hint(
          "Paused — folders are editable below. When you're happy, Export and upload them to the " +
          "URL above, then re-check this box to hand ownership back to the file."
        )
      );
    }
  }

  // Only a SAVED, active source can be synced — a paused one would no-op in the
  // background, so its button is hidden.
  if (savedFolderSource?.url && savedFolderSource.enabled !== false) {
    const actions = document.createElement("div");
    actions.className = "provider-actions";
    const syncBtn = document.createElement("button");
    syncBtn.className = "sync-now-btn sync-folders-now-btn";
    syncBtn.textContent = "Sync folders now";
    syncBtn.title = "Fetch the folder source now (uses the last saved URL)";
    syncBtn.addEventListener("click", () => syncFolderSourceNow(syncBtn));
    actions.appendChild(syncBtn);
    div.appendChild(actions);
    if (folderSourceState?.lastSyncAt) {
      div.appendChild(
        hint(`Last synced: ${new Date(folderSourceState.lastSyncAt).toLocaleString()}`)
      );
    }
    if (folderSourceError) {
      const error = document.createElement("p");
      error.className = "inline-error";
      error.textContent = `Last sync failed — ${folderSourceError}`;
      div.appendChild(error);
    }
  }

  return div;
}

// Forces a fetch of the folder source and re-renders with the replaced folders
// once the background responds (same shape as syncProviderNow).
async function syncFolderSourceNow(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    await ext.runtime.sendMessage({
      type: "sync_provider",
      providerId: FOLDER_SOURCE_ID,
    } satisfies Message);
  } catch {
    // background not ready — fall through, re-render restores the button
  }
  let syncStatus;
  [folderSourceState, folders, syncStatus] = await Promise.all([
    getFolderSourceState(),
    getFolders(),
    getSyncStatus(),
  ]);
  folderSourceError =
    syncStatus?.errors.find((e) => e.providerId === FOLDER_SOURCE_ID)?.message ?? null;
  // Folders were just replaced from the source — re-baseline the re-enable guard.
  foldersBaseline = folderSourceActive() ? JSON.stringify(folders) : null;
  renderTabs();
}

// Read-only view of one remotely managed folder: name + Latest/Sort summary,
// rules as collapsed JSON.
function renderFolderReadOnly(folder: Folder): HTMLElement {
  const details = document.createElement("details");
  details.className = "folder-readonly";

  const summary = document.createElement("summary");
  summary.textContent = folder.name;
  const meta: string[] = [];
  if (folder.limit !== undefined) meta.push(`latest ${folder.limit}`);
  if (folder.sort) meta.push(`sort: ${folder.sort}`);
  if (folder.surfaces) meta.push(`surfaces: ${folder.surfaces.join(", ") || "none"}`);
  if (meta.length > 0) {
    const span = document.createElement("span");
    span.className = "folder-readonly-meta";
    span.textContent = ` (${meta.join(", ")})`;
    summary.appendChild(span);
  }
  details.appendChild(summary);

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(folder.rules, null, 2);
  details.appendChild(pre);

  return details;
}

// ---- Per-provider panel -----------------------------------------------------

function renderProviderPanel(providerId: string): HTMLElement {
  const section = document.createElement("section");
  const index = providers.findIndex((p) => p.id === providerId);
  if (index === -1) {
    section.appendChild(hint("This provider no longer exists."));
    return section;
  }

  const provider = providers[index];
  section.appendChild(sectionHeading(providerTabLabel(provider)));

  const config = renderProviderConfig(provider, index);
  if (config) section.appendChild(config);

  // Distinguish "nothing synced" from "synced but tagless", and remind that
  // feed items are a changing list of links, not stored bookmarks.
  const linkCount = providerBookmarkCount(provider.id);
  section.appendChild(sectionHeading("Synced content"));
  const lastSyncAt = providerSyncState[provider.id]?.lastSyncAt;
  if (lastSyncAt) {
    section.appendChild(hint(`Last synced: ${new Date(lastSyncAt).toLocaleString()}`));
  }
  if (linkCount === 0) {
    section.appendChild(
      hint("Nothing synced from this provider yet — save settings to trigger a sync, then reopen.")
    );
  } else if (isFeedProvider(provider)) {
    section.appendChild(
      hint(
        `Currently ${linkCount} links from this feed. This is a live list, not stored ` +
        "bookmarks — it changes whenever the site updates its feed."
      )
    );
  } else {
    section.appendChild(hint(`${linkCount} bookmarks synced from this provider.`));
  }

  const tags = sortTagCounts(providerTagCounts(provider.id));
  if (linkCount > 0) {
    section.appendChild(sectionHeading("Tags"));
    if (tags.length === 0) {
      section.appendChild(
        hint(
          "None of them have tags — a folder rule with a Provider condition still " +
          "collects them into a folder."
        )
      );
    } else {
      section.appendChild(renderTagTable(tags));
    }
  }

  const actions = document.createElement("div");
  actions.className = "provider-actions";
  const syncBtn = renderSyncNowButton(provider);
  if (syncBtn) actions.appendChild(syncBtn);
  const fullSyncBtn = renderFullSyncNowButton(provider);
  if (fullSyncBtn) actions.appendChild(fullSyncBtn);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-provider-btn";
  removeBtn.textContent = "Remove provider";
  removeBtn.addEventListener("click", () => removeProvider(provider.id));
  actions.appendChild(removeBtn);
  section.appendChild(actions);

  return section;
}

// "Sync now" only exists for providers whose source changes on its own — the
// same set that gets a sync-interval override; static/JSON data only changes
// via Save, which already triggers a sync.
function renderSyncNowButton(provider: ProviderConfig): HTMLElement | null {
  if (provider.type !== "linkding" && provider.type !== "browser" && !isFeedProvider(provider)) {
    return null;
  }
  const btn = document.createElement("button");
  btn.className = "sync-now-btn";
  btn.textContent = "Sync now";
  btn.title = "Sync this provider now (uses the last saved settings)";
  btn.addEventListener("click", () => syncProviderNow(provider.id, btn));
  return btn;
}

// "Full sync now" (linkding only): re-downloads everything, bypassing the
// modified_since cursor — the only way to pick up deletions/archiving
// immediately instead of waiting for the periodic full sync. Feeds don't need
// it (a feed response is always the complete current list).
function renderFullSyncNowButton(provider: ProviderConfig): HTMLElement | null {
  if (provider.type !== "linkding") return null;
  const btn = document.createElement("button");
  btn.className = "sync-now-btn full-sync-now-btn";
  btn.textContent = "Full sync now";
  btn.title =
    "Re-download all bookmarks from scratch — picks up deletions and archiving immediately, " +
    "which the incremental \"Sync now\" can't see (uses the last saved settings)";
  btn.addEventListener("click", () => syncProviderNow(provider.id, btn, true));
  return btn;
}

// Forces a sync of one provider and refreshes the panel afterwards (the
// background responds once the sync finished, so last-synced/tag counts are
// fresh on re-render). full = bypass the incremental cursor ("Full sync now").
async function syncProviderNow(
  providerId: string,
  button: HTMLButtonElement,
  full = false
): Promise<void> {
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    await ext.runtime.sendMessage({
      type: "sync_provider",
      providerId,
      ...(full ? { full: true } : {}),
    } satisfies Message);
  } catch {
    // background not ready — fall through, re-render restores the button
  }
  [providerSyncState, bookmarks] = await Promise.all([getProviderSyncState(), getBookmarks()]);
  renderTabs();
}

function providerTabLabel(provider: ProviderConfig): string {
  // Linkding always shows its username when set, regardless of how many linkding providers exist.
  if (provider.type === "linkding" && provider.username) {
    return `linkding (${provider.username})`;
  }
  // Feeds show their host — subscribing to several feeds is the normal case.
  if (isFeedProvider(provider) && provider.url) {
    try {
      return `feed (${new URL(provider.url).hostname})`;
    } catch {
      // fall through to the generic label while the URL is still being typed
    }
  }
  // Otherwise only disambiguate with a 0-based index when more than one of the type exists.
  const sameType = providers.filter((p) => p.type === provider.type);
  if (sameType.length > 1) {
    return `${provider.type} (${sameType.findIndex((p) => p.id === provider.id)})`;
  }
  return provider.type;
}

// ---- Per-provider tag table -------------------------------------------------

function providerBookmarkCount(providerId: string): number {
  const prefix = `${providerId}:`;
  return Object.keys(bookmarks).filter((id) => id.startsWith(prefix)).length;
}

function providerTagCounts(providerId: string): Array<{ tag: string; count: number }> {
  const prefix = `${providerId}:`;
  const counts = new Map<string, number>();
  for (const [id, bm] of Object.entries(bookmarks)) {
    if (!id.startsWith(prefix)) continue;
    for (const tag of bm.tag_names) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count }));
}

// Every tag across ALL sources, counts summed. A `tag` folder condition matches
// bookmarks provider-agnostically (matchesNode checks tag_names regardless of
// source), so the Tag autocomplete suggests the union, not one provider's slice.
function allTagCounts(): TagCount[] {
  const counts = new Map<string, number>();
  for (const bm of Object.values(bookmarks)) {
    for (const tag of bm.tag_names) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count }));
}

function sortTagCounts(
  rows: Array<{ tag: string; count: number }>
): Array<{ tag: string; count: number }> {
  const factor = tagSort.dir === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    if (tagSort.key === "tag") {
      return a.tag.localeCompare(b.tag) * factor;
    }
    // count: primary by count, stable tiebreak by tag name (ascending)
    if (a.count !== b.count) return (a.count - b.count) * factor;
    return a.tag.localeCompare(b.tag);
  });
}

function renderTagTable(rows: Array<{ tag: string; count: number }>): HTMLElement {
  const table = document.createElement("table");
  table.className = "tag-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.appendChild(sortableTh("Tag", "tag"));
  headerRow.appendChild(sortableTh("Count", "count"));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(({ tag, count }) => {
    const tr = document.createElement("tr");
    const tagTd = document.createElement("td");
    tagTd.textContent = tag;
    const countTd = document.createElement("td");
    countTd.textContent = String(count);
    tr.appendChild(tagTd);
    tr.appendChild(countTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

function sortableTh(label: string, key: "tag" | "count"): HTMLElement {
  const th = document.createElement("th");
  const active = tagSort.key === key;
  const arrow = active ? (tagSort.dir === "asc" ? " ▲" : " ▼") : "";
  th.textContent = label + arrow;
  th.className = active ? "sortable active" : "sortable";
  th.addEventListener("click", () => {
    tagSort = active
      ? { key, dir: tagSort.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "tag" ? "asc" : "desc" };
    renderTabs();
  });
  return th;
}

// ---- Permissions panel ------------------------------------------------------

function renderPermissionsPanel(): HTMLElement {
  const section = document.createElement("section");
  section.appendChild(sectionHeading("Granted host permissions"));
  section.appendChild(
    hint(
      "These per-host permissions let the extension read each provider's API across origins. " +
      "Revoking one stops that provider from syncing until you save its settings again."
    )
  );

  grantedHostOrigins.forEach((origin) => {
    const row = document.createElement("div");
    row.className = "perm-row";

    const code = document.createElement("code");
    code.textContent = origin;

    const revokeBtn = document.createElement("button");
    revokeBtn.textContent = "Revoke";
    revokeBtn.addEventListener("click", async () => {
      await ext.permissions.remove({ origins: [origin] });
      await loadGrantedOrigins();
      renderTabs();
    });

    row.appendChild(code);
    row.appendChild(revokeBtn);
    section.appendChild(row);
  });

  return section;
}

// ---- Save -------------------------------------------------------------------

async function save(): Promise<void> {
  // Apply any open per-folder JSON editors first (synchronous, so the permission
  // request below stays the first await). Invalid JSON blocks the save.
  if (!applyPendingJsonEdits()) {
    renderTabs();
    const status = document.getElementById("status")!;
    status.textContent = "Fix invalid folder-rules JSON before saving.";
    setTimeout(() => { status.textContent = ""; }, 4000);
    return;
  }

  const folderSource: FolderSourceConfig | undefined = folderSourceUrl.trim()
    ? {
        url: folderSourceUrl.trim(),
        ...(folderSourceIntervalMinutes !== undefined
          ? { syncIntervalMinutes: folderSourceIntervalMinutes }
          : {}),
        // Persist the pause explicitly; absent = enabled (the common case), so
        // configs from before this toggle keep syncing unchanged.
        ...(folderSourceEnabled ? {} : { enabled: false }),
      }
    : undefined;
  const settings: Settings = {
    syncIntervalMinutes,
    providers,
    theme,
    newTabCloseOnOpenAll,
    ...(folderSource ? { folderSource } : {}),
  };

  // Permission request must be the first await — user gesture activation expires after the first
  // async operation in Firefox. Bundle the bookmarks permission (browser provider) and the host
  // permissions for each remote origin (linkding, feeds, folder source) into a single request so
  // the gesture is only spent once.
  const hasBrowserProvider = settings.providers.some((p) => p.type === "browser");
  const folderSourceOrigin = folderSource ? originPattern(folderSource.url) : null;
  const remoteOriginPatterns = [
    ...new Set([
      ...remoteProviderOrigins(settings.providers),
      ...(folderSourceOrigin ? [folderSourceOrigin] : []),
    ]),
  ];
  const needsPermissions = hasBrowserProvider || remoteOriginPatterns.length > 0;

  let permissionsGranted = !needsPermissions;
  if (needsPermissions) {
    permissionsGranted = await ext.permissions.request({
      ...(hasBrowserProvider ? { permissions: ["bookmarks"] } : {}),
      ...(remoteOriginPatterns.length > 0 ? { origins: remoteOriginPatterns } : {}),
    });
  }

  await saveSettings(settings);
  // Only an ACTIVE source owns the folders — writing the (possibly stale) local
  // copy could outlive its next "unchanged" fetch. A paused source is exactly
  // the case where we DO persist local edits (that's what pausing is for).
  if (!folderSource || folderSource.enabled === false) {
    await saveFolders(folders);
  }

  // A folder-source origin that is no longer needed by anything gets revoked
  // (mirrors what removeProvider does for provider origins).
  const previousFolderSourceOrigin = savedFolderSource ? originPattern(savedFolderSource.url) : null;
  if (previousFolderSourceOrigin && !remoteOriginPatterns.includes(previousFolderSourceOrigin)) {
    await ext.permissions.remove({ origins: [previousFolderSourceOrigin] });
  }
  savedFolderSource = folderSource;
  // Reset the guard baseline to the just-saved reality so further edits in this
  // session are judged against it (active = folders are now remote-owned again).
  foldersBaseline = folderSourceActive() ? JSON.stringify(folders) : null;

  if (permissionsGranted) {
    await ext.runtime.sendMessage({ type: "sync_requested" });
  }

  // Refresh the granted-host list so the Permissions tab appears/updates after a grant.
  await loadGrantedOrigins();
  renderTabs();

  const status = document.getElementById("status")!;
  status.textContent = permissionsGranted
    ? "Saved."
    : "Saved, but permissions were declined — those providers won't sync until granted.";
  setTimeout(() => { status.textContent = ""; }, 4000);
}

// ---- Provider editors -------------------------------------------------------

// Overview row: a navigational summary (label links to the provider's own tab) + remove.
// The actual configuration fields live only in the provider's tab.
function renderProviderRow(provider: ProviderConfig): HTMLElement {
  const div = document.createElement("div");
  div.className = "provider-editor";

  const header = document.createElement("div");
  header.className = "provider-header";

  const link = document.createElement("button");
  link.className = "provider-link";
  link.textContent = providerTabLabel(provider);
  link.title = "Open this provider's settings";
  link.addEventListener("click", () => {
    activeTabId = `provider:${provider.id}`;
    renderTabs();
  });

  const typeBadge = document.createElement("span");
  typeBadge.className = "provider-type-badge";
  typeBadge.textContent = provider.type;

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => removeProvider(provider.id));

  header.appendChild(link);
  header.appendChild(typeBadge);
  const syncBtn = renderSyncNowButton(provider);
  if (syncBtn) header.appendChild(syncBtn);
  const fullSyncBtn = renderFullSyncNowButton(provider);
  if (fullSyncBtn) header.appendChild(fullSyncBtn);
  header.appendChild(removeBtn);
  div.appendChild(header);

  return div;
}

async function removeProvider(providerId: string): Promise<void> {
  const index = providers.findIndex((p) => p.id === providerId);
  if (index === -1) return;
  const [removed] = providers.splice(index, 1);

  await revokeProviderPermissions(removed);
  await loadGrantedOrigins();

  if (activeTabId === `provider:${providerId}`) activeTabId = "overview";
  renderTabs();
}

// When a provider is removed, drop the permission only it needed — unless another remaining
// provider still relies on the same one. (Note: this acts immediately, like the Permissions-tab
// Revoke button; the provider list itself is still only persisted on Save.)
async function revokeProviderPermissions(removed: ProviderConfig): Promise<void> {
  if (removed.type === "browser" && !providers.some((p) => p.type === "browser")) {
    await ext.permissions.remove({ permissions: ["bookmarks"] });
  }
  const removedUrl = remoteProviderUrl(removed);
  if (removedUrl) {
    const origin = originPattern(removedUrl);
    const stillNeeded =
      origin !== null &&
      (providers.some((p) => {
        const url = remoteProviderUrl(p);
        return url !== null && originPattern(url) === origin;
      }) ||
        // The saved folder source may share the origin (e.g. two GitHub raw URLs).
        (savedFolderSource !== undefined && originPattern(savedFolderSource.url) === origin));
    if (origin !== null && !stillNeeded) {
      await ext.permissions.remove({ origins: [origin] });
    }
  }
}

// "jsonfeed" is the pre-RSS legacy alias for the unified feed provider.
function isFeedProvider(provider: ProviderConfig): provider is FeedProviderConfig {
  return provider.type === "feed" || provider.type === "jsonfeed";
}

// The user-configured URL of a provider that fetches from a remote origin (and
// therefore needs a host permission), or null for local/pasted providers.
function remoteProviderUrl(provider: ProviderConfig): string | null {
  if ((provider.type === "linkding" || isFeedProvider(provider)) && provider.url) {
    return provider.url;
  }
  return null;
}

function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

function renderProviderConfig(provider: ProviderConfig, index: number): HTMLElement | null {
  if (provider.type === "linkding") {
    return renderLinkdingConfig(provider, index);
  }
  if (provider.type === "json") {
    return renderJsonConfig(provider, index);
  }
  if (isFeedProvider(provider)) {
    return renderFeedConfig(provider, index);
  }
  if (provider.type === "browser") {
    const div = document.createElement("div");
    div.className = "provider-config";
    const note = document.createElement("p");
    note.className = "provider-note";
    note.textContent =
      "Imports browser bookmarks. Each bookmark is tagged with the names of the folders it lives in " +
      "(e.g. a bookmark in \"Bookmarks Toolbar / crowdsourcing\" gets the tags \"Bookmarks Toolbar\" and " +
      "\"crowdsourcing\"). Firefox's native bookmark tags are NOT readable via the extension API — only the " +
      "folder structure is. To match a folder rule by tag, put the bookmark inside a folder of that name. " +
      "Requests the bookmarks permission on first sync.";
    div.appendChild(note);
    div.appendChild(renderSyncIntervalOverride(provider));
    return div;
  }
  if (provider.type === "static") {
    const div = document.createElement("div");

    const note = document.createElement("p");
    note.className = "provider-note";
    note.textContent =
      "A predefined set of demo bookmarks bundled with the extension, meant for trying things out " +
      "before you connect a real provider. Nothing to configure here — add a Linkding, JSON, or " +
      "browser-bookmarks provider when you're ready to use your own data.";
    div.appendChild(note);

    const tip = document.createElement("p");
    tip.className = "provider-note";
    const link = document.createElement("a");
    link.href = STATIC_DATA_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View the demo data";
    tip.append(
      link,
      " to see the exact tags, titles, and URLs it contains — handy when experimenting " +
      "with match rules in the Folders tab."
    );
    div.appendChild(tip);

    return div;
  }
  return null;
}

// Optional per-provider override of the global sync interval — only offered on
// providers whose source changes independently of the extension (linkding,
// feeds, browser bookmarks); static/JSON data only changes via Save, which
// triggers a sync anyway.
function renderSyncIntervalOverride(
  config: LinkdingProviderConfig | FeedProviderConfig | BrowserProviderConfig
): HTMLElement {
  const label = document.createElement("label");
  label.textContent = "Sync interval override (minutes; empty = use the global Sync setting)";
  const input = document.createElement("input");
  input.type = "number";
  input.className = "sync-interval-override";
  input.min = "1";
  input.placeholder = "global";
  input.value = config.syncIntervalMinutes !== undefined ? String(config.syncIntervalMinutes) : "";
  input.addEventListener("input", () => {
    const n = parseInt(input.value, 10);
    if (Number.isInteger(n) && n > 0) {
      config.syncIntervalMinutes = n;
    } else {
      delete config.syncIntervalMinutes;
    }
  });
  label.appendChild(input);
  return label;
}

// How often an incremental-capable provider (linkding, feeds) is forced
// through a full sync. Incremental updates can't see deletions — linkding's
// modified_since never reports deleted/archived bookmarks — so this is the
// worst-case staleness for them.
function renderFullSyncInterval(
  config: LinkdingProviderConfig | FeedProviderConfig
): HTMLElement {
  const label = document.createElement("label");
  label.textContent =
    "Full sync every N hours (default 24) — partial syncs can't detect deleted entries; " +
    "this bounds how long a deletion can go unnoticed";
  const input = document.createElement("input");
  input.type = "number";
  input.className = "full-sync-interval";
  input.min = "1";
  input.placeholder = "24";
  input.value =
    config.fullSyncIntervalHours !== undefined ? String(config.fullSyncIntervalHours) : "";
  input.addEventListener("input", () => {
    const n = parseInt(input.value, 10);
    if (Number.isInteger(n) && n > 0) {
      config.fullSyncIntervalHours = n;
    } else {
      delete config.fullSyncIntervalHours;
    }
  });
  label.appendChild(input);
  return label;
}

function renderLinkdingConfig(provider: LinkdingProviderConfig, index: number): HTMLElement {
  const div = document.createElement("div");
  div.className = "provider-config";

  const urlLabel = document.createElement("label");
  urlLabel.textContent = "URL";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.value = provider.url;
  urlInput.placeholder = "https://my-linkding-instance.example.com";
  urlInput.addEventListener("input", () => {
    (providers[index] as LinkdingProviderConfig).url = urlInput.value.trim();
  });
  urlLabel.appendChild(urlInput);

  const usernameLabel = document.createElement("label");
  usernameLabel.textContent = "Username (optional, for display only)";
  const usernameInput = document.createElement("input");
  usernameInput.type = "text";
  usernameInput.value = provider.username ?? "";
  usernameInput.placeholder = "your-linkding-username";
  usernameInput.addEventListener("input", () => {
    (providers[index] as LinkdingProviderConfig).username = usernameInput.value.trim();
  });
  usernameLabel.appendChild(usernameInput);

  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = "API token";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.value = provider.token;
  tokenInput.placeholder = "Token …";
  tokenInput.addEventListener("input", () => {
    (providers[index] as LinkdingProviderConfig).token = tokenInput.value.trim();
  });
  tokenLabel.appendChild(tokenInput);

  div.appendChild(urlLabel);
  div.appendChild(usernameLabel);
  div.appendChild(tokenLabel);
  div.appendChild(renderSyncIntervalOverride(provider));
  div.appendChild(renderFullSyncInterval(provider));
  return div;
}

function renderJsonConfig(provider: JsonProviderConfig, index: number): HTMLElement {
  const div = document.createElement("div");
  div.className = "provider-config";

  const label = document.createElement("label");
  label.textContent = "Bookmarks JSON";
  const textarea = document.createElement("textarea");
  textarea.rows = 6;
  textarea.value = provider.data;
  textarea.placeholder = '[{"url":"https://example.com","title":"Example","tag_names":["tag1"]}]';
  textarea.addEventListener("input", () => {
    (providers[index] as JsonProviderConfig).data = textarea.value;
  });
  label.appendChild(textarea);

  div.appendChild(label);
  return div;
}

function renderFeedConfig(provider: FeedProviderConfig, index: number): HTMLElement {
  const div = document.createElement("div");
  div.className = "provider-config";

  const note = document.createElement("p");
  note.className = "provider-note";
  note.textContent =
    "Subscribes to a web feed — RSS, Atom, or JSON Feed, detected automatically — and shows " +
    "its current items as bookmarks. Each sync mirrors the feed, so items that drop out of it " +
    "disappear here too. Feed categories/tags become bookmark tags, but many feeds set none — " +
    "a folder rule matching this provider collects its items regardless.";
  div.appendChild(note);

  const urlLabel = document.createElement("label");
  urlLabel.textContent = "Feed URL";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.value = provider.url;
  urlInput.placeholder = "https://example.com/feed.xml";
  urlInput.addEventListener("input", () => {
    (providers[index] as FeedProviderConfig).url = urlInput.value.trim();
  });
  urlLabel.appendChild(urlInput);
  div.appendChild(urlLabel);

  const externalLabel = document.createElement("label");
  externalLabel.className = "checkbox";
  const externalInput = document.createElement("input");
  externalInput.type = "checkbox";
  externalInput.checked = provider.preferExternalUrl;
  externalInput.addEventListener("change", () => {
    (providers[index] as FeedProviderConfig).preferExternalUrl = externalInput.checked;
  });
  externalLabel.appendChild(externalInput);
  externalLabel.append(
    "Prefer the linked page over the feed's own post (JSON Feed linkblogs like Daring " +
    "Fireball point their posts at an external article; RSS/Atom feeds are unaffected)"
  );
  div.appendChild(externalLabel);

  const maxLabel = document.createElement("label");
  maxLabel.textContent = "Maximum items to keep (empty = all; some feeds ship 150+)";
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "1";
  maxInput.placeholder = "all";
  maxInput.value = provider.maxItems !== undefined ? String(provider.maxItems) : "";
  maxInput.addEventListener("input", () => {
    const n = parseInt(maxInput.value, 10);
    const config = providers[index] as FeedProviderConfig;
    if (Number.isInteger(n) && n > 0) {
      config.maxItems = n;
    } else {
      delete config.maxItems;
    }
  });
  maxLabel.appendChild(maxInput);
  div.appendChild(maxLabel);

  div.appendChild(renderSyncIntervalOverride(provider));
  div.appendChild(renderFullSyncInterval(provider));

  return div;
}

function addProvider(type: ProviderType): void {
  if (SINGLETON_PROVIDER_TYPES.has(type) && providers.some((p) => p.type === type)) return;

  const base = { id: crypto.randomUUID(), name: type, type };

  let config: ProviderConfig;
  switch (type) {
    case "static":  config = { ...base, type: "static" }; break;
    case "json":    config = { ...base, type: "json", data: "" }; break;
    case "browser": config = { ...base, type: "browser" }; break;
    case "linkding": config = { ...base, type: "linkding", url: "", token: "" }; break;
    case "feed":     // "jsonfeed" is the legacy alias; the menu only offers "feed"
    case "jsonfeed": config = { ...base, type: "feed", url: "", preferExternalUrl: true }; break;
  }

  providers.push(config);
  renderTabs();
}

// Whether the boolean-logic help is expanded; module-level so it survives the
// full re-render every edit triggers (same pattern as tagSort/jsonEdit).
let logicHelpOpen = false;

function renderLogicHelp(): HTMLElement {
  const details = document.createElement("details");
  details.className = "logic-help";
  details.open = logicHelpOpen;
  details.addEventListener("toggle", () => {
    logicHelpOpen = details.open;
  });

  const summary = document.createElement("summary");
  summary.textContent = "Boolean logic tips for complex folders";
  details.appendChild(summary);

  const intro = document.createElement("p");
  intro.textContent =
    "The match modes are the boolean operators: ALL = AND (∧), ANY = OR (∨), " +
    "and NONE = NOT (¬) applied to the whole group: ¬(A ∨ B ∨ …). " +
    "For more complex folders these identities help restructure rules:";
  details.appendChild(intro);

  const laws = document.createElement("ul");
  [
    "Distribution: A ∧ (B ∨ C) = (A ∧ B) ∨ (A ∧ C)",
    "De Morgan: ¬(A ∧ B) = ¬A ∨ ¬B",
    "De Morgan: ¬(A ∨ B) = ¬A ∧ ¬B",
    "Double negation: ¬(¬A) = A",
  ].forEach((law) => {
    const li = document.createElement("li");
    li.textContent = law;
    laws.appendChild(li);
  });
  details.appendChild(laws);

  const note = document.createElement("p");
  note.textContent =
    "Note: a NONE group with several conditions means ¬(A ∨ B) — by De Morgan " +
    "the same as ¬A ∧ ¬B. Empty groups never match.";
  details.appendChild(note);

  return details;
}

// Whether the sort/weight help is expanded; module-level so it survives the
// full re-render every edit triggers (same pattern as logicHelpOpen).
let sortHelpOpen = false;

function renderSortHelp(): HTMLElement {
  const details = document.createElement("details");
  details.className = "logic-help sort-help";
  details.open = sortHelpOpen;
  details.addEventListener("toggle", () => {
    sortHelpOpen = details.open;
  });

  const summary = document.createElement("summary");
  summary.textContent = "How Sort and Weight order a folder's bookmarks";
  details.appendChild(summary);

  const intro = document.createElement("p");
  intro.textContent =
    "\"Latest\" (above, in each folder) picks WHICH bookmarks are shown — the newest N " +
    "matches. \"Sort\" and \"Weight\" only decide the ORDER of whichever bookmarks were picked:";
  details.appendChild(intro);

  const laws = document.createElement("ul");
  [
    "Weight always wins first: on a condition inside an ANY (OR) group, a higher " +
      "Weight means bookmarks matching it are shown before ones matching a lower-weighted " +
      "(or unweighted) condition.",
    "Sort only breaks ties: among bookmarks with the same Weight (e.g. no weights are " +
      "set anywhere in the folder, the normal case), Sort decides the order — Newest " +
      "added, Recently modified, or Alphabetical.",
    "The Weight field only appears on conditions inside an ANY (OR) group with two or " +
      "more conditions — that's the only place ranking between alternatives makes sense.",
    "Leaving Sort as \"Default\" and every Weight empty keeps today's plain order.",
  ].forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    laws.appendChild(li);
  });
  details.appendChild(laws);

  return details;
}

// ---- Folder editors ---------------------------------------------------------

// Per-folder JSON editor state, keyed by folder id. Module-level so it survives
// renderTabs() re-renders (same pattern as tagSort).
const jsonEdit = new Map<string, { text: string; error: string | null }>();

const SURFACE_LABELS: ReadonlyArray<{ value: Surface; label: string }> = [
  { value: "popup", label: "Popup" },
  { value: "sidebar", label: "Sidebar" },
  { value: "newtab", label: "New tab" },
];

// The "Show on" checkboxes for a folder's surface targeting. Absent surfaces =
// shown everywhere (all boxes checked). Canonicalise: all checked stores nothing
// (omitted = everywhere); any subset stores that array; none = [] (hidden
// everywhere). Mutates the live folder only — never renderTabs() (focus theft),
// same as the Latest/Sort inputs; Save persists it.
function renderFolderSurfaces(folder: Folder): HTMLElement {
  const group = document.createElement("div");
  group.className = "folder-surfaces";
  group.title =
    "Which surfaces show this folder. All checked = everywhere (the default). " +
    "Uncheck all to hide the folder everywhere without deleting it.";

  const caption = document.createElement("span");
  caption.className = "folder-surfaces-caption";
  caption.textContent = "Show on";
  group.appendChild(caption);

  const inputs: Array<{ value: Surface; input: HTMLInputElement }> = [];
  const sync = (): void => {
    const selected = inputs.filter((c) => c.input.checked).map((c) => c.value);
    if (selected.length === SURFACE_LABELS.length) {
      delete folder.surfaces;
    } else {
      folder.surfaces = selected;
    }
  };

  SURFACE_LABELS.forEach(({ value, label }) => {
    const lbl = document.createElement("label");
    lbl.className = "folder-surface";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = folder.surfaces === undefined || folder.surfaces.includes(value);
    input.addEventListener("change", sync);
    lbl.appendChild(input);
    lbl.append(label);
    group.appendChild(lbl);
    inputs.push({ value, input });
  });

  return group;
}

function renderFolderEditor(folder: Folder, index: number, listContainer: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = "folder-editor";

  const header = document.createElement("div");
  header.className = "folder-header";

  // Folder order is the display order on every surface (folders are saved as
  // an array), so folders reorder with the same pointer-drag as rule rows.
  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder";
  handle.textContent = "⠿";
  header.appendChild(handle);
  div.classList.add("drag-row");
  wireReorderHandle(handle, div, listContainer, folders, index);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = folder.name;
  nameInput.placeholder = "Folder name";
  nameInput.addEventListener("input", () => {
    folder.name = nameInput.value;
  });

  const limitLabel = document.createElement("label");
  limitLabel.className = "folder-limit";
  limitLabel.title =
    "Show only the newest N matching items (by date; undated items last). Empty = show all.";
  limitLabel.append("Latest");
  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.className = "folder-limit-input";
  limitInput.min = "1";
  limitInput.placeholder = "All";
  limitInput.value = folder.limit !== undefined ? String(folder.limit) : "";
  limitInput.addEventListener("input", () => {
    const n = parseInt(limitInput.value, 10);
    if (Number.isInteger(n) && n > 0) {
      folder.limit = n;
    } else {
      delete folder.limit;
    }
  });
  limitLabel.appendChild(limitInput);

  const sortLabel = document.createElement("label");
  sortLabel.className = "folder-sort";
  sortLabel.title =
    "Secondary display order, applied after any condition weights. Empty = original order.";
  sortLabel.append("Sort");
  const sortSelect = document.createElement("select");
  sortSelect.className = "folder-sort-select";
  const sortModes: Array<{ value: NonNullable<Folder["sort"]> | ""; label: string }> = [
    { value: "", label: "Default" },
    { value: "added", label: "Newest added" },
    { value: "modified", label: "Recently modified" },
    { value: "alphabetical", label: "Alphabetical" },
  ];
  sortModes.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if ((folder.sort ?? "") === value) opt.selected = true;
    sortSelect.appendChild(opt);
  });
  sortSelect.addEventListener("change", () => {
    if (sortSelect.value) {
      folder.sort = sortSelect.value as Folder["sort"];
    } else {
      delete folder.sort;
    }
  });
  sortLabel.appendChild(sortSelect);

  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = jsonEdit.has(folder.id) ? "Edit visually" : "Edit as JSON";
  jsonBtn.addEventListener("click", () => {
    if (jsonEdit.has(folder.id)) {
      jsonEdit.delete(folder.id);
    } else {
      jsonEdit.set(folder.id, { text: JSON.stringify(folder.rules, null, 2), error: null });
    }
    renderTabs();
  });

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    folders.splice(index, 1);
    jsonEdit.delete(folder.id);
    renderTabs();
  });

  header.appendChild(nameInput);
  header.appendChild(jsonBtn);
  header.appendChild(removeBtn);
  div.appendChild(header);

  const settingsRow = document.createElement("div");
  settingsRow.className = "folder-settings";
  settingsRow.appendChild(limitLabel);
  settingsRow.appendChild(sortLabel);
  settingsRow.appendChild(renderFolderSurfaces(folder));
  div.appendChild(settingsRow);

  div.appendChild(
    jsonEdit.has(folder.id)
      ? renderFolderJsonEditor(folder)
      : renderGroupEditor(folder.rules, true, null)
  );
  return div;
}

function renderGroupEditor(
  group: RuleGroup,
  isRoot: boolean,
  onRemove: (() => void) | null
): HTMLElement {
  const div = document.createElement("div");
  div.className = isRoot ? "rule-group rule-group-root" : "rule-group";

  const header = document.createElement("div");
  header.className = "group-header";

  const matchSelect = document.createElement("select");
  const matchModes: Array<{ value: MatchMode; label: string }> = [
    { value: "all", label: "Match ALL" },
    { value: "any", label: "Match ANY" },
    { value: "none", label: "Match NONE (exclude)" },
  ];
  matchModes.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (group.match === value) opt.selected = true;
    matchSelect.appendChild(opt);
  });
  matchSelect.addEventListener("change", () => {
    group.match = matchSelect.value as MatchMode;
    // Whether a weight input is shown on a direct child depends on this
    // group's match mode, so a mode change needs to re-render its children.
    renderTabs();
  });
  header.appendChild(matchSelect);

  if (!isRoot && onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = "Remove group";
    removeBtn.addEventListener("click", onRemove);
    header.appendChild(removeBtn);
  }
  div.appendChild(header);

  const conditionsDiv = document.createElement("div");
  conditionsDiv.className = "conditions";

  if (group.conditions.length === 0) {
    conditionsDiv.appendChild(hint("Empty groups never match."));
  }
  group.conditions.forEach((node, i) => {
    const remove = () => {
      group.conditions.splice(i, 1);
      renderTabs();
    };
    // Weight only ranks bookmarks between alternatives in an OR group, so it's
    // only meaningful for a leaf inside an "any" group that has 2+ conditions
    // (with a single condition there's nothing to rank it against).
    const showWeight = group.match === "any" && group.conditions.length >= 2;
    const child = isRuleGroup(node)
      ? renderGroupEditor(node, false, remove)
      : renderConditionEditor(node, showWeight, remove);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.title = "Drag to reorder";
    handle.textContent = "⠿";
    const handleParent = isRuleGroup(node) ? child.querySelector(".group-header") : child;
    handleParent?.insertBefore(handle, handleParent.firstChild);

    child.classList.add("drag-row"); // query hook for the reorder geometry below
    wireReorderHandle(handle, child, conditionsDiv, group.conditions, i);

    conditionsDiv.appendChild(child);
  });
  div.appendChild(conditionsDiv);

  const buttons = document.createElement("div");
  buttons.className = "group-buttons";

  const addCondBtn = document.createElement("button");
  addCondBtn.textContent = "+ Add condition";
  addCondBtn.addEventListener("click", () => {
    group.conditions.push({ type: "tag", value: "" });
    renderTabs();
  });
  buttons.appendChild(addCondBtn);

  const addGroupBtn = document.createElement("button");
  addGroupBtn.textContent = "+ Add group";
  addGroupBtn.addEventListener("click", () => {
    group.conditions.push({ match: "any", conditions: [] });
    renderTabs();
  });
  buttons.appendChild(addGroupBtn);

  div.appendChild(buttons);
  return div;
}

// Pointer-based drag reorder for one row within its backing array — used for
// rule rows (a group's conditions) and for whole folder editors (the folders
// list). Chosen over native HTML5 drag-and-drop because native DnD can't
// reliably start from a row full of form controls in Firefox, gives no easy
// live drop indicator, and doesn't work on touch. Reorders siblings only.
// A floating .drop-marker shows where the row would land.
function wireReorderHandle(
  handle: HTMLElement,
  row: HTMLElement,
  container: HTMLElement,
  items: unknown[],
  fromIndex: number
): void {
  handle.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    const rows = Array.from(container.querySelectorAll<HTMLElement>(":scope > .drag-row"));
    const marker = document.createElement("div");
    marker.className = "drop-marker";
    container.appendChild(marker);
    row.classList.add("dragging");
    let toIndex = fromIndex;

    const positionMarker = (): void => {
      const cTop = container.getBoundingClientRect().top;
      const y =
        toIndex >= rows.length
          ? rows[rows.length - 1].getBoundingClientRect().bottom - cTop
          : rows[toIndex].getBoundingClientRect().top - cTop;
      marker.style.top = `${y}px`;
    };

    const onMove = (ev: PointerEvent): void => {
      const midpoints = rows.map((r) => {
        const rect = r.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      toIndex = insertionIndexForY(ev.clientY, midpoints);
      positionMarker();
    };

    const cleanup = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      marker.remove();
      row.classList.remove("dragging");
    };

    const onUp = (): void => {
      const to = toIndex;
      cleanup();
      // toIndex is an "insert before" position; before self or the slot right
      // after self are both no-ops.
      if (to === fromIndex || to === fromIndex + 1) return;
      const [moved] = items.splice(fromIndex, 1);
      items.splice(fromIndex < to ? to - 1 : to, 0, moved);
      renderTabs();
    };

    const onCancel = (): void => cleanup();

    // setPointerCapture keeps move/up events coming to the handle even once the
    // pointer leaves it. Guarded: it can throw in edge cases (e.g. a stale
    // pointer id), and the listeners below still work without capture.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not required */
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    positionMarker();
  });
}

function renderConditionEditor(
  condition: RuleCondition,
  showWeight: boolean,
  onRemove: () => void
): HTMLElement {
  const div = document.createElement("div");
  div.className = "condition";

  const typeSelect = document.createElement("select");
  const conditionTypes: Array<{ value: RuleCondition["type"]; label: string }> = [
    { value: "tag", label: "Tag" },
    { value: "url_contains", label: "URL contains" },
    { value: "title_contains", label: "Title contains" },
    { value: "provider", label: "Provider" },
    { value: "browser_base", label: "Browser base" },
  ];
  conditionTypes.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (condition.type === value) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    const previous = condition.type;
    condition.type = typeSelect.value as RuleCondition["type"];
    // The select-backed types (provider id, browser base) carry enum-like values that
    // make no sense as free-text tag/URL/title (and vice versa), so reset the value when
    // crossing that boundary; re-render swaps the control.
    if (condition.type === "provider") {
      condition.value = providers[0]?.id ?? "";
    } else if (condition.type === "browser_base") {
      condition.value = "firefox";
    } else if (previous === "provider" || previous === "browser_base") {
      condition.value = "";
    }
    renderTabs();
  });

  const valueControl =
    condition.type === "provider"
      ? renderProviderValueSelect(condition)
      : condition.type === "browser_base"
        ? renderBrowserBaseValueSelect(condition)
        : renderConditionValueInput(condition);

  div.appendChild(typeSelect);
  div.appendChild(valueControl);

  if (showWeight) {
    const weightLabel = document.createElement("label");
    weightLabel.className = "condition-weight";
    weightLabel.title =
      "A bigger number lists bookmarks matching this condition higher up in the folder. Leave empty for no effect on the order.";
    weightLabel.append("Weight");
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.className = "condition-weight-input";
    weightInput.placeholder = "—";
    weightInput.value = condition.weight !== undefined ? String(condition.weight) : "";
    weightInput.addEventListener("input", () => {
      const n = Number(weightInput.value);
      if (weightInput.value.trim() !== "" && Number.isFinite(n)) {
        condition.weight = n;
      } else {
        delete condition.weight;
      }
    });
    weightLabel.appendChild(weightInput);
    div.appendChild(weightLabel);
  }

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", onRemove);
  div.appendChild(removeBtn);

  return div;
}

function renderConditionValueInput(condition: RuleCondition): HTMLElement {
  if (condition.type === "tag") {
    return renderTagValueInput(condition);
  }
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.value = condition.value;
  valueInput.placeholder = "Value";
  valueInput.addEventListener("input", () => {
    condition.value = valueInput.value;
  });
  return valueInput;
}

// Free-text tag input with a fuzzy autocomplete dropdown of existing tags (union
// across all sources, ranked by frequency). Values not in the collection are
// still accepted — the dropdown only assists, it never constrains. Keeps the
// live `condition.value = input.value` mutation of the plain input; never calls
// renderTabs() on keystroke (documented focus-theft) — the dropdown manages its
// own DOM directly.
function renderTagValueInput(condition: RuleCondition): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tag-autocomplete";

  const input = document.createElement("input");
  input.type = "text";
  input.value = condition.value;
  input.placeholder = "Value";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const list = document.createElement("ul");
  list.className = "tag-suggestions";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  // Bookmarks don't change while editing (a sync/save re-renders the whole tab),
  // so snapshot the candidate tags once per widget instead of per keystroke.
  const candidates = allTagCounts();
  let matches: TagSuggestion[] = [];
  let highlighted = -1;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    highlighted = -1;
  };

  const setHighlight = (index: number): void => {
    highlighted = index;
    [...list.children].forEach((li, i) => {
      const selected = i === index;
      li.classList.toggle("is-highlighted", selected);
      li.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) li.scrollIntoView({ block: "nearest" });
    });
  };

  const selectMatch = (index: number): void => {
    const match = matches[index];
    if (!match) return;
    input.value = match.tag;
    condition.value = match.tag;
    close();
    input.focus();
  };

  const refresh = (): void => {
    matches = fuzzyFilterTags(input.value, candidates);
    // Nothing to add if the only suggestion is exactly what's already typed.
    if (
      matches.length === 0 ||
      (matches.length === 1 && matches[0].tag === input.value)
    ) {
      close();
      return;
    }
    list.replaceChildren(
      ...matches.map(({ tag, count, matchedIndexes }, i) => {
        const li = document.createElement("li");
        li.className = "tag-suggestion";
        li.setAttribute("role", "option");
        const name = document.createElement("span");
        name.className = "tag-suggestion-name";
        // Bold the character runs that fuzzy-matched the query.
        name.append(
          ...highlightRuns(tag, matchedIndexes).map((run) => {
            if (!run.matched) return document.createTextNode(run.text);
            const mark = document.createElement("mark");
            mark.className = "tag-suggestion-match";
            mark.textContent = run.text;
            return mark;
          })
        );
        const badge = document.createElement("span");
        badge.className = "tag-suggestion-count";
        badge.textContent = String(count);
        li.append(name, badge);
        // mousedown (not click) + preventDefault so the input doesn't blur —
        // and hide the list — before the selection registers.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectMatch(i);
        });
        return li;
      })
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setHighlight(0);
  };

  input.addEventListener("input", () => {
    condition.value = input.value;
    refresh();
  });
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (list.hidden) refresh();
        else setHighlight(Math.min(highlighted + 1, matches.length - 1));
        break;
      case "ArrowUp":
        if (list.hidden) break;
        e.preventDefault();
        setHighlight(Math.max(highlighted - 1, 0));
        break;
      case "Enter":
        if (!list.hidden && highlighted >= 0) {
          e.preventDefault();
          selectMatch(highlighted);
        }
        break;
      case "Escape":
        if (!list.hidden) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  });

  wrapper.append(input, list);
  return wrapper;
}

// Dropdown of configured providers; value is the provider config id (the
// namespace prefix of bookmark ids). A value pointing at a removed provider is
// kept as an explicit "unknown" entry instead of being silently rewritten.
function renderProviderValueSelect(condition: RuleCondition): HTMLElement {
  const select = document.createElement("select");

  // The browser preselects the first option; keep the data in sync so an
  // untouched dropdown doesn't leave an empty value behind at Save time.
  if (!condition.value && providers.length > 0) {
    condition.value = providers[0].id;
  }

  if (condition.value && !providers.some((p) => p.id === condition.value)) {
    const opt = document.createElement("option");
    opt.value = condition.value;
    opt.textContent = `Unknown provider (${condition.value})`;
    opt.selected = true;
    select.appendChild(opt);
  }

  providers.forEach((provider) => {
    const opt = document.createElement("option");
    opt.value = provider.id;
    opt.textContent = providerTabLabel(provider);
    if (condition.value === provider.id) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    condition.value = select.value;
  });
  return select;
}

// Dropdown for the browser_base condition; value is "firefox" | "chromium" and is
// matched at sync time against the running build's compile-time browser base.
function renderBrowserBaseValueSelect(condition: RuleCondition): HTMLElement {
  const select = document.createElement("select");

  // Keep the data in sync with the browser's preselected first option.
  if (!condition.value) condition.value = "firefox";

  const options: Array<{ value: string; label: string }> = [
    { value: "firefox", label: "Firefox" },
    { value: "chromium", label: "Chromium (Chrome, Edge, …)" },
  ];
  options.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (condition.value === value) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    condition.value = select.value;
  });
  return select;
}

// ---- Per-folder JSON editor ---------------------------------------------------

function renderFolderJsonEditor(folder: Folder): HTMLElement {
  const state = jsonEdit.get(folder.id)!;

  const div = document.createElement("div");
  div.className = "json-editor";

  const textarea = document.createElement("textarea");
  textarea.rows = 12;
  textarea.value = state.text;
  textarea.addEventListener("input", () => {
    state.text = textarea.value;
  });
  div.appendChild(textarea);

  if (state.error) {
    const error = document.createElement("p");
    error.className = "inline-error";
    error.textContent = state.error;
    div.appendChild(error);
  }

  const buttons = document.createElement("div");
  buttons.className = "group-buttons";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    const error = applyJsonEdit(folder, state);
    if (error) state.error = error;
    renderTabs();
  });
  buttons.appendChild(applyBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    jsonEdit.delete(folder.id);
    renderTabs();
  });
  buttons.appendChild(cancelBtn);

  div.appendChild(buttons);
  return div;
}

// Parses and applies a folder's pending JSON edit. Returns an error message, or
// null on success (the folder's rules are replaced and the editor closed).
function applyJsonEdit(folder: Folder, state: { text: string; error: string | null }): string | null {
  let data: unknown;
  try {
    data = JSON.parse(state.text);
  } catch (e) {
    return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
  const result = parseRuleGroup(data);
  if (!result.valid || !result.group) {
    return result.errors.join("\n");
  }
  folder.rules = result.group;
  jsonEdit.delete(folder.id);
  return null;
}

// Applies all open JSON editors before saving. Returns true when every pending
// edit parsed cleanly; on failure the offending editors show inline errors.
function applyPendingJsonEdits(): boolean {
  let ok = true;
  for (const [folderId, state] of jsonEdit) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      jsonEdit.delete(folderId);
      continue;
    }
    const error = applyJsonEdit(folder, state);
    if (error) {
      state.error = error;
      ok = false;
    }
  }
  return ok;
}

function addFolder(): void {
  const newFolder: Folder = {
    id: crypto.randomUUID(),
    name: "",
    rules: { match: "any", conditions: [] },
    bookmark_ids: [],
  };
  folders.push(newFolder);
  renderTabs();
}

// ---- Folder export / import ---------------------------------------------------

// withImport = false while a remote folder source is configured: importing
// would fight the source (every refresh replaces all folders), but exporting
// stays useful — it's how a remote file is seeded from the current folders.
function renderFolderBackupSection(withImport: boolean): HTMLElement {
  const div = document.createElement("div");
  div.className = "folder-backup";

  div.appendChild(sectionHeading(withImport ? "Export / Import" : "Export"));
  div.appendChild(
    hint(
      withImport
        ? "Export downloads all folder definitions as a JSON file (without the computed bookmark " +
          "lists). Import replaces all folders with the pasted or loaded JSON — like every change " +
          "on this page, nothing is persisted until you press Save."
        : "Export downloads all folder definitions as a JSON file (without the computed bookmark " +
          "lists) — the exact format the remote folder source expects."
    )
  );

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export folders";
  exportBtn.addEventListener("click", exportFolders);
  div.appendChild(exportBtn);

  if (!withImport) return div;

  const importLabel = document.createElement("label");
  importLabel.textContent = "Import from file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  importLabel.appendChild(fileInput);
  div.appendChild(importLabel);

  const textarea = document.createElement("textarea");
  textarea.rows = 8;
  textarea.placeholder = '[{"name":"Dev","rules":{"match":"any","conditions":[{"type":"tag","value":"dev"}]}}]';
  div.appendChild(textarea);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result ?? "");
    };
    reader.readAsText(file);
  });

  const errorBox = document.createElement("p");
  errorBox.className = "inline-error";
  errorBox.hidden = true;
  div.appendChild(errorBox);

  const importBtn = document.createElement("button");
  importBtn.textContent = "Import (replace all)";
  importBtn.addEventListener("click", () => {
    // On failure, show errors in place (no re-render, so the textarea survives).
    const showError = (message: string) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    let data: unknown;
    try {
      data = JSON.parse(textarea.value);
    } catch (e) {
      showError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = parseFolders(data);
    if (!result.valid) {
      showError(result.errors.join("\n"));
      return;
    }
    const confirmed = confirm(
      `Replace all ${folders.length} existing folders with ${result.folders.length} imported folders?`
    );
    if (!confirmed) return;
    folders = result.folders;
    jsonEdit.clear();
    renderTabs();
  });
  div.appendChild(importBtn);

  return div;
}

function exportFolders(): void {
  const data = folders.map(({ bookmark_ids: _, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bookmarks-plus-folders-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Permissions helpers ----------------------------------------------------

async function loadGrantedOrigins(): Promise<void> {
  const all = await ext.permissions.getAll();
  grantedHostOrigins = (all.origins ?? []).filter(isSpecificHost);
}

// A concrete single host (e.g. "https://links.example.com/*"), as opposed to a broad wildcard
// like "<all_urls>" or "*://*/*" — only the former are worth listing/revoking here.
function isSpecificHost(origin: string): boolean {
  return origin !== "<all_urls>" && !origin.includes("://*");
}

// Origin match patterns ("https://host/*") for each configured remote provider, so we can
// request host access for exactly those hosts (a subset of the manifest's <all_urls>) instead
// of making the user enable all-sites access by hand. Invalid/blank URLs are skipped.
function remoteProviderOrigins(providerList: ProviderConfig[]): string[] {
  const origins = new Set<string>();
  for (const provider of providerList) {
    const url = remoteProviderUrl(provider);
    if (url) {
      try {
        origins.add(`${new URL(url).origin}/*`);
      } catch {
        // ignore invalid URL; user is still editing
      }
    }
  }
  return [...origins];
}

// ---- Small DOM helpers ------------------------------------------------------

function sectionHeading(text: string): HTMLElement {
  const h2 = document.createElement("h2");
  h2.textContent = text;
  return h2;
}

function hint(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
}

// ---- Boot -------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);
