import ext from "@shared/browser";
import { getFolders, getSettings, saveFolders, saveSettings } from "@shared/storage";
import type {
  Folder,
  FolderRules,
  LinkdingProviderConfig,
  JsonProviderConfig,
  ProviderConfig,
  ProviderType,
  RuleCondition,
  Settings,
} from "@shared/types";

let folders: Folder[] = [];
let providers: ProviderConfig[] = [];

async function init(): Promise<void> {
  const [settings, savedFolders] = await Promise.all([
    getSettings(),
    getFolders(),
  ]);

  folders = savedFolders;
  providers = settings.providers;

  (document.getElementById("sync-interval") as HTMLInputElement).value =
    String(settings.syncIntervalMinutes);

  renderProviderList();
  renderFolderList();

  document.getElementById("save")?.addEventListener("click", save);
  document.getElementById("add-provider")?.addEventListener("click", addProvider);
  document.getElementById("add-folder")?.addEventListener("click", addFolder);
}

// ---- Save -------------------------------------------------------------------

async function save(): Promise<void> {
  const settings: Settings = {
    syncIntervalMinutes: parseInt(
      (document.getElementById("sync-interval") as HTMLInputElement).value,
      10
    ),
    providers,
  };

  // Permission request must be the first await — user gesture activation expires after the first
  // async operation in Firefox. Bundle the bookmarks permission (browser provider) and the host
  // permissions for each linkding origin into a single request so the gesture is only spent once.
  const hasBrowserProvider = settings.providers.some((p) => p.type === "browser");
  const linkdingOriginPatterns = linkdingOrigins(settings.providers);
  const needsPermissions = hasBrowserProvider || linkdingOriginPatterns.length > 0;

  let permissionsGranted = !needsPermissions;
  if (needsPermissions) {
    permissionsGranted = await ext.permissions.request({
      ...(hasBrowserProvider ? { permissions: ["bookmarks"] } : {}),
      ...(linkdingOriginPatterns.length > 0 ? { origins: linkdingOriginPatterns } : {}),
    });
  }

  await saveSettings(settings);
  await saveFolders(folders);

  if (permissionsGranted) {
    await ext.runtime.sendMessage({ type: "sync_requested" });
  }

  const status = document.getElementById("status")!;
  status.textContent = permissionsGranted
    ? "Saved."
    : "Saved, but permissions were declined — those providers won't sync until granted.";
  setTimeout(() => { status.textContent = ""; }, 4000);
}

// Origin match patterns ("https://host/*") for each configured linkding provider, so we can
// request host access for exactly those hosts (a subset of the manifest's <all_urls>) instead
// of making the user enable all-sites access by hand. Invalid/blank URLs are skipped.
function linkdingOrigins(providerList: ProviderConfig[]): string[] {
  const origins = new Set<string>();
  for (const provider of providerList) {
    if (provider.type === "linkding" && provider.url) {
      try {
        origins.add(`${new URL(provider.url).origin}/*`);
      } catch {
        // ignore invalid URL; user is still editing
      }
    }
  }
  return [...origins];
}

// ---- Provider list ----------------------------------------------------------

function renderProviderList(): void {
  const container = document.getElementById("provider-list")!;
  container.innerHTML = "";
  providers.forEach((provider, index) => {
    container.appendChild(renderProviderEditor(provider, index));
  });
}

function renderProviderEditor(provider: ProviderConfig, index: number): HTMLElement {
  const div = document.createElement("div");
  div.className = "provider-editor";

  const header = document.createElement("div");
  header.className = "provider-header";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = provider.name;
  nameInput.placeholder = "Provider name";
  nameInput.addEventListener("input", () => {
    providers[index] = { ...providers[index], name: nameInput.value };
  });

  const typeBadge = document.createElement("span");
  typeBadge.className = "provider-type-badge";
  typeBadge.textContent = provider.type;

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    providers.splice(index, 1);
    renderProviderList();
  });

  header.appendChild(nameInput);
  header.appendChild(typeBadge);
  header.appendChild(removeBtn);
  div.appendChild(header);

  const configDiv = renderProviderConfig(provider, index);
  if (configDiv) div.appendChild(configDiv);

  return div;
}

function renderProviderConfig(provider: ProviderConfig, index: number): HTMLElement | null {
  if (provider.type === "linkding") {
    return renderLinkdingConfig(provider, index);
  }
  if (provider.type === "json") {
    return renderJsonConfig(provider, index);
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
  // static: no config
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

function addProvider(): void {
  const select = document.getElementById("provider-type-select") as HTMLSelectElement;
  const type = select.value as ProviderType;

  const base = { id: crypto.randomUUID(), name: type, type };

  let config: ProviderConfig;
  switch (type) {
    case "static":  config = { ...base, type: "static" }; break;
    case "json":    config = { ...base, type: "json", data: "" }; break;
    case "browser": config = { ...base, type: "browser" }; break;
    case "linkding": config = { ...base, type: "linkding", url: "", token: "" }; break;
  }

  providers.push(config);
  renderProviderList();
}

// ---- Folder list rendering --------------------------------------------------

function renderFolderList(): void {
  const container = document.getElementById("folder-list")!;
  container.innerHTML = "";
  folders.forEach((folder, index) => {
    container.appendChild(renderFolderEditor(folder, index));
  });
}

function renderFolderEditor(folder: Folder, index: number): HTMLElement {
  const div = document.createElement("div");
  div.className = "folder-editor";

  const header = document.createElement("div");
  header.className = "folder-header";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = folder.name;
  nameInput.placeholder = "Folder name";
  nameInput.addEventListener("input", () => {
    folders[index].name = nameInput.value;
  });

  const matchSelect = document.createElement("select");
  ["all", "any"].forEach((val) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val === "all" ? "Match ALL" : "Match ANY";
    if (folder.rules.match === val) opt.selected = true;
    matchSelect.appendChild(opt);
  });
  matchSelect.addEventListener("change", () => {
    folders[index].rules.match = matchSelect.value as "all" | "any";
  });

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    folders.splice(index, 1);
    renderFolderList();
  });

  header.appendChild(nameInput);
  header.appendChild(matchSelect);
  header.appendChild(removeBtn);
  div.appendChild(header);

  const conditionsDiv = document.createElement("div");
  conditionsDiv.className = "conditions";

  folder.rules.conditions.forEach((condition, ci) => {
    conditionsDiv.appendChild(renderConditionEditor(condition, index, ci));
  });

  const addCondBtn = document.createElement("button");
  addCondBtn.textContent = "+ Add condition";
  addCondBtn.addEventListener("click", () => {
    folders[index].rules.conditions.push({ type: "tag", value: "" });
    renderFolderList();
  });

  div.appendChild(conditionsDiv);
  div.appendChild(addCondBtn);
  return div;
}

function renderConditionEditor(
  condition: RuleCondition,
  folderIndex: number,
  conditionIndex: number
): HTMLElement {
  const div = document.createElement("div");
  div.className = "condition";

  const typeSelect = document.createElement("select");
  const conditionTypes: Array<{ value: RuleCondition["type"]; label: string }> = [
    { value: "tag", label: "Tag" },
    { value: "url_contains", label: "URL contains" },
    { value: "title_contains", label: "Title contains" },
  ];
  conditionTypes.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (condition.type === value) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    folders[folderIndex].rules.conditions[conditionIndex].type =
      typeSelect.value as RuleCondition["type"];
  });

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.value = condition.value;
  valueInput.placeholder = "Value";
  valueInput.addEventListener("input", () => {
    folders[folderIndex].rules.conditions[conditionIndex].value = valueInput.value;
  });

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    folders[folderIndex].rules.conditions.splice(conditionIndex, 1);
    renderFolderList();
  });

  div.appendChild(typeSelect);
  div.appendChild(valueInput);
  div.appendChild(removeBtn);
  return div;
}

// ---- Add folder -------------------------------------------------------------

function addFolder(): void {
  const newFolder: Folder = {
    id: crypto.randomUUID(),
    name: "",
    rules: { match: "any", conditions: [] } as FolderRules,
    bookmark_ids: [],
  };
  folders.push(newFolder);
  renderFolderList();
}

// ---- Boot -------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);
