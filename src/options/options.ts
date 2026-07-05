import ext from "@shared/browser";
import { getBookmarks, getFolders, getSettings, saveFolders, saveSettings } from "@shared/storage";
import { applyStoredTheme, setTheme } from "@shared/theme";
import type {
  BookmarkMap,
  Folder,
  FeedProviderConfig,
  LinkdingProviderConfig,
  JsonProviderConfig,
  MatchMode,
  ProviderConfig,
  ProviderType,
  RuleCondition,
  RuleGroup,
  Settings,
  Theme,
} from "@shared/types";
import { isRuleGroup } from "@shared/types";
import { parseFolders, parseRuleGroup } from "@shared/validation";
import { insertionIndexForY } from "@shared/reorder";

// Provider types that may only exist once (no per-instance config to distinguish them).
const SINGLETON_PROVIDER_TYPES = new Set<ProviderType>(["static", "browser"]);

// The bundled demo bookmarks/folders, so users can see what tags/titles/URLs the
// static provider supplies when crafting folder rules.
const STATIC_DATA_URL =
  "https://raw.githubusercontent.com/mkoester/linkding-ext/refs/heads/main/shared/data/static.ts";

let folders: Folder[] = [];
let providers: ProviderConfig[] = [];
let bookmarks: BookmarkMap = {};
let syncIntervalMinutes = 15;
let theme: Theme = "system";
let newTabCloseOnOpenAll = false;
let grantedHostOrigins: string[] = [];
let activeTabId = "overview";
let tagSort: { key: "tag" | "count"; dir: "asc" | "desc" } = { key: "count", dir: "desc" };

async function init(): Promise<void> {
  const [settings, savedFolders, savedBookmarks] = await Promise.all([
    getSettings(),
    getFolders(),
    getBookmarks(),
  ]);

  folders = savedFolders;
  providers = settings.providers;
  bookmarks = savedBookmarks;
  syncIntervalMinutes = settings.syncIntervalMinutes;
  theme = settings.theme;
  newTabCloseOnOpenAll = settings.newTabCloseOnOpenAll;

  await applyStoredTheme();
  await loadGrantedOrigins();

  // Installed build's version, injected into the manifest from package.json at
  // build time. Non-release builds carry the git-decorated version in
  // version_name (Chromium) or version itself (Firefox); prefer version_name so
  // both show it. Guarded: the screenshot harness's manifest mock has no version.
  const manifest = ext.runtime.getManifest() as { version?: string; version_name?: string };
  const version = manifest.version_name ?? manifest.version;
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

  section.appendChild(renderFolderBackupSection());

  return section;
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

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-provider-btn";
  removeBtn.textContent = "Remove provider";
  removeBtn.addEventListener("click", () => removeProvider(provider.id));
  section.appendChild(removeBtn);

  return section;
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

  const settings: Settings = { syncIntervalMinutes, providers, theme, newTabCloseOnOpenAll };

  // Permission request must be the first await — user gesture activation expires after the first
  // async operation in Firefox. Bundle the bookmarks permission (browser provider) and the host
  // permissions for each remote provider origin (linkding, JSON feeds) into a single request so
  // the gesture is only spent once.
  const hasBrowserProvider = settings.providers.some((p) => p.type === "browser");
  const remoteOriginPatterns = remoteProviderOrigins(settings.providers);
  const needsPermissions = hasBrowserProvider || remoteOriginPatterns.length > 0;

  let permissionsGranted = !needsPermissions;
  if (needsPermissions) {
    permissionsGranted = await ext.permissions.request({
      ...(hasBrowserProvider ? { permissions: ["bookmarks"] } : {}),
      ...(remoteOriginPatterns.length > 0 ? { origins: remoteOriginPatterns } : {}),
    });
  }

  await saveSettings(settings);
  await saveFolders(folders);

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
      providers.some((p) => {
        const url = remoteProviderUrl(p);
        return url !== null && originPattern(url) === origin;
      });
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
    const note = document.createElement("p");
    note.className = "provider-note";
    note.textContent =
      "Imports browser bookmarks. Each bookmark is tagged with the names of the folders it lives in " +
      "(e.g. a bookmark in \"Bookmarks Toolbar / crowdsourcing\" gets the tags \"Bookmarks Toolbar\" and " +
      "\"crowdsourcing\"). Firefox's native bookmark tags are NOT readable via the extension API — only the " +
      "folder structure is. To match a folder rule by tag, put the bookmark inside a folder of that name. " +
      "Requests the bookmarks permission on first sync.";
    return note;
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
    // A provider id makes no sense as tag/URL/title text (and vice versa), so
    // reset the value when crossing that boundary; re-render swaps the control.
    if (condition.type === "provider") {
      condition.value = providers[0]?.id ?? "";
    } else if (previous === "provider") {
      condition.value = "";
    }
    renderTabs();
  });

  const valueControl =
    condition.type === "provider"
      ? renderProviderValueSelect(condition)
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
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.value = condition.value;
  valueInput.placeholder = "Value";
  valueInput.addEventListener("input", () => {
    condition.value = valueInput.value;
  });
  return valueInput;
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

function renderFolderBackupSection(): HTMLElement {
  const div = document.createElement("div");
  div.className = "folder-backup";

  div.appendChild(sectionHeading("Export / Import"));
  div.appendChild(
    hint(
      "Export downloads all folder definitions as a JSON file (without the computed bookmark " +
      "lists). Import replaces all folders with the pasted or loaded JSON — like every change " +
      "on this page, nothing is persisted until you press Save."
    )
  );

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export folders";
  exportBtn.addEventListener("click", exportFolders);
  div.appendChild(exportBtn);

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
