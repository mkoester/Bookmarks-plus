/* Options-page invariants: folder editor layout, the sort/weight controls, and
   the pointer-based rule reordering (drag + live drop marker). Runs against the
   real options bundle with mocked chrome.* (screenshot-harness demo data). */
window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#tab-bar button"));
  Array.from(document.querySelectorAll("#tab-bar button"))
    .find((b) => b.textContent === "Folders")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const fe = () => document.querySelector(".folder-editor");
  check("folder editors render", !!fe());

  // Header holds the drag handle, the name and the JSON/Remove buttons;
  // Latest/Sort live on their own row below (the layout fix that stopped the
  // header overflowing).
  check("folder-header has handle + name + 2 buttons", fe().querySelector(".folder-header").children.length === 4);
  check("folder editors are drag rows with a header handle", fe().classList.contains("drag-row") && !!fe().querySelector(".folder-header > .drag-handle"));
  const settings = fe().querySelector(".folder-settings");
  check("folder-settings row has Latest + Sort", !!settings?.querySelector(".folder-limit") && !!settings?.querySelector(".folder-sort"));

  const sortSelect = fe().querySelector(".folder-sort-select");
  check(
    "sort dropdown offers Default/added/modified/alphabetical",
    sortSelect && Array.from(sortSelect.options).map((o) => o.value).join(",") === ",added,modified,alphabetical"
  );
  check(
    "Sort/Weight help block present",
    Array.from(document.querySelectorAll("details.sort-help summary")).some((s) => s.textContent.includes("Sort and Weight"))
  );

  // Weight only ranks bookmarks between OR alternatives, so it's hidden until an
  // "any" group has 2+ conditions. The demo folders start with a single "any"
  // condition, so no weight field should be shown yet.
  check("no weight field on a single-condition ANY group", !fe().querySelector("label.condition-weight"));

  // --- Tag condition fuzzy autocomplete ---
  // The first demo folder's condition is a `tag` condition; its value control is
  // the autocomplete wrapper, not a bare input.
  const tagInput = () => fe().querySelector(".condition .tag-autocomplete input[type=text]");
  check("tag condition value uses the autocomplete wrapper", !!tagInput());

  const ac = tagInput();
  ac.value = "de";
  ac.dispatchEvent(new Event("input", { bubbles: true }));
  const sugList = () => fe().querySelector(".tag-suggestions");
  check("typing a query opens the suggestion dropdown", !!sugList() && !sugList().hidden);
  const sugNames = () => Array.from(fe().querySelectorAll(".tag-suggestion-name")).map((n) => n.textContent);
  check(
    "dropdown fuzzy-matches existing tags for 'de' (" + sugNames().join(",") + ")",
    sugNames().includes("dev") && sugNames().includes("design")
  );
  check("suggestions show a per-tag count", !!fe().querySelector(".tag-suggestion-count"));
  // The matched character run(s) are bolded via <mark class="tag-suggestion-match">.
  // For "de" every suggestion contains those chars, so each row has a highlight.
  const marks = () => Array.from(fe().querySelectorAll(".tag-suggestion .tag-suggestion-match")).map((m) => m.textContent);
  check(
    "matched characters are highlighted in the suggestions (" + marks().join(",") + ")",
    marks().length >= 2 && marks().every((t) => t.toLowerCase().replace(/[^de]/g, "").length > 0)
  );

  // Keyboard: ArrowDown moves the highlight, Enter fills the input with it.
  const kd = (key) => ac.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  kd("ArrowDown");
  const picked = fe().querySelector(".tag-suggestion.is-highlighted .tag-suggestion-name").textContent;
  kd("Enter");
  check(
    "Enter selects the highlighted suggestion (" + picked + ") and closes the list",
    tagInput().value === picked && sugList().hidden
  );

  // Free text: a tag in no source is still accepted, just with no dropdown.
  const ac2 = tagInput();
  ac2.value = "brand-new-tag";
  ac2.dispatchEvent(new Event("input", { bubbles: true }));
  check(
    "a tag not in any source is accepted with no dropdown",
    sugList().hidden && tagInput().value === "brand-new-tag"
  );

  // Non-tag conditions keep the plain input (autocomplete is tag-only).
  const typeSel = () => fe().querySelector(".condition select");
  typeSel().value = "url_contains";
  typeSel().dispatchEvent(new Event("change", { bubbles: true }));
  check(
    "non-tag conditions use a plain value input (no autocomplete)",
    !fe().querySelector(".condition .tag-autocomplete") && !!fe().querySelector(".condition input[type=text]")
  );
  // Restore the tag type so the downstream reorder checks see the original shape.
  typeSel().value = "tag";
  typeSel().dispatchEvent(new Event("change", { bubbles: true }));
  check("switching back to Tag restores the autocomplete", !!fe().querySelector(".condition .tag-autocomplete"));

  const handle = fe().querySelector(".drag-handle");
  check("drag handle present", !!handle);
  check("reorder is pointer-based (handle is NOT native-draggable)", handle && handle.draggable === false);

  // --- Pointer-drag reorder + live marker ---
  const addCond = () =>
    Array.from(fe().querySelectorAll(".group-buttons button"))
      .find((b) => b.textContent === "+ Add condition")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  addCond();

  // Now 2 conditions in the "any" group → weight fields appear, with a visible
  // label (not a placeholder that vanishes on input).
  const weightLabel = fe().querySelector("label.condition-weight");
  check("weight field appears once the ANY group has 2 conditions", !!weightLabel && weightLabel.textContent.includes("Weight"));

  addCond();

  let rows = fe().querySelectorAll(".conditions > .drag-row");
  check("three condition rows to reorder", rows.length === 3);
  rows.forEach((r, i) => {
    const inp = r.querySelector("input[type=text]");
    inp.value = "row" + i;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });

  rows = fe().querySelectorAll(".conditions > .drag-row");
  const handle0 = rows[0].querySelector(".drag-handle");
  const belowAll = rows[2].getBoundingClientRect().bottom + 5;
  const pe = (type, y) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, clientX: 12, clientY: y });

  handle0.dispatchEvent(pe("pointerdown", rows[0].getBoundingClientRect().top + 5));
  const marker = fe().querySelector(".drop-marker");
  check("drop marker appears while dragging", !!marker);
  check("dragged row is dimmed (.dragging)", rows[0].classList.contains("dragging"));

  handle0.dispatchEvent(pe("pointermove", belowAll));
  check("marker tracks the pointer (positioned)", marker && parseFloat(marker.style.top) > 0);

  handle0.dispatchEvent(pe("pointerup", belowAll));

  const orderAfter = Array.from(fe().querySelectorAll(".conditions > .drag-row")).map(
    (r) => r.querySelector("input[type=text]").value
  );
  check("dropping row0 at the end reorders to row1,row2,row0 (" + orderAfter.join(",") + ")", orderAfter.join(",") === "row1,row2,row0");
  check("marker cleared after drop", !fe().querySelector(".drop-marker"));
  check("no row left dimmed after drop", !fe().querySelector(".dragging"));

  // --- Folder drag-reorder (same pointer mechanism, folders array) ---
  const folderRows = () => Array.from(document.querySelectorAll(".folders-list > .drag-row"));
  const folderNames = () =>
    folderRows().map((r) => r.querySelector(".folder-header input[type=text]").value);
  check("demo folders render as drag rows", folderRows().length >= 2);

  const namesBefore = folderNames();
  const expected = namesBefore.slice(1).concat(namesBefore[0]).join(",");
  const fHandle = folderRows()[0].querySelector(".folder-header .drag-handle");
  const fBelowAll = folderRows()[folderRows().length - 1].getBoundingClientRect().bottom + 5;

  fHandle.dispatchEvent(pe("pointerdown", folderRows()[0].getBoundingClientRect().top + 5));
  check("folder drop marker appears in the folders list", !!document.querySelector(".folders-list > .drop-marker"));
  fHandle.dispatchEvent(pe("pointermove", fBelowAll));
  fHandle.dispatchEvent(pe("pointerup", fBelowAll));

  const namesAfter = folderNames().join(",");
  check("dropping folder0 at the end reorders the folders (" + namesAfter + ")", namesAfter === expected);
  check("folder marker cleared after drop", !document.querySelector(".folders-list .drop-marker"));

  // --- Overview: Sync now button on remote-source provider rows ---
  Array.from(document.querySelectorAll("#tab-bar button"))
    .find((b) => b.textContent === "Overview")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const overviewRow = document.querySelector(".provider-header");
  check("overview provider row has a Sync now button", !!overviewRow.querySelector(".sync-now-btn"));
  check(
    "overview linkding row has a Full sync now button",
    !!overviewRow.querySelector(".full-sync-now-btn")
  );

  // --- Provider tab: interval override, full-sync interval, last-synced, Sync now ---
  Array.from(document.querySelectorAll("#tab-bar button"))
    .find((b) => b.textContent === "linkding (me)")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const panel = document.getElementById("tab-panels");
  const override = panel.querySelector("input.sync-interval-override");
  check(
    "linkding tab has a sync-interval override input (empty = global)",
    !!override && override.value === "" && override.placeholder === "global"
  );
  const fullSync = panel.querySelector("input.full-sync-interval");
  check(
    "linkding tab has a full-sync interval input (empty = 24h default)",
    !!fullSync && fullSync.value === "" && fullSync.placeholder === "24"
  );
  check(
    "provider tab shows the last-synced time",
    Array.from(panel.querySelectorAll(".hint")).some((h) => h.textContent.startsWith("Last synced:"))
  );

  // Sync now sits in the actions row next to Remove and asks the background
  // to sync exactly this provider.
  const sent = [];
  chrome.runtime.sendMessage = (msg) => { sent.push(msg); return Promise.resolve({ done: true }); };
  const syncNow = panel.querySelector(".provider-actions .sync-now-btn");
  check(
    "provider tab has Sync now next to Remove provider",
    !!syncNow && !!panel.querySelector(".provider-actions .remove-provider-btn")
  );
  syncNow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  check(
    "Sync now sends sync_provider for this provider id (incremental — no full flag)",
    sent.length === 1 && sent[0].type === "sync_provider" && sent[0].providerId === "ld" &&
      sent[0].full === undefined
  );
  check("Sync now disables itself while syncing", syncNow.disabled === true);

  // "Full sync now" (linkding only): same message plus the full flag, which
  // makes the background bypass the incremental modified_since cursor.
  const fullSyncNow = panel.querySelector(".provider-actions .full-sync-now-btn");
  check("linkding tab has a Full sync now button", !!fullSyncNow);
  fullSyncNow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  check(
    "Full sync now sends sync_provider with full:true",
    sent.length === 2 && sent[1].type === "sync_provider" && sent[1].providerId === "ld" &&
      sent[1].full === true
  );

  // --- Folders tab: remote folder source flips the editor to read-only ---
  Array.from(document.querySelectorAll("#tab-bar button"))
    .find((b) => b.textContent === "Folders")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const srcInput = () => document.querySelector(".folder-source-url");
  check("Folders tab has a folder-source URL input", !!srcInput());
  check(
    "folder-source interval input present (empty = manual refresh only)",
    !!document.querySelector(".folder-source-interval") &&
      document.querySelector(".folder-source-interval").placeholder === "manual"
  );
  check("editor is editable while no source is set", !!document.querySelector(".folder-editor"));

  // Type a source URL and leave the field: the editor must become read-only
  // (a remote refresh replaces all folders, local edits would be lost).
  srcInput().value = "https://example.com/folders.json";
  srcInput().dispatchEvent(new Event("input", { bubbles: true }));
  srcInput().dispatchEvent(new Event("change", { bubbles: true }));
  check(
    "configuring a source switches folders to read-only",
    !document.querySelector(".folder-editor") && !!document.querySelector(".folder-readonly")
  );
  const buttons = () => Array.from(document.querySelectorAll("#tab-panels button"));
  check(
    "import is hidden in read-only mode, export stays",
    !buttons().some((b) => b.textContent.startsWith("Import")) &&
      buttons().some((b) => b.textContent === "Export folders")
  );
  check(
    "no folder-source Sync now before the source was ever saved",
    !document.querySelector(".sync-folders-now-btn")
  );

  // Pause toggle: a URL shows the enabled checkbox (checked by default). Unchecking
  // it pauses the source — folders become editable again WITHOUT clearing the URL.
  const toggle = () => document.querySelector(".folder-source-enabled");
  check("configuring a source shows the enabled toggle, checked", !!toggle() && toggle().checked);
  toggle().checked = false;
  toggle().dispatchEvent(new Event("change", { bubbles: true }));
  check(
    "pausing the source (URL kept) restores the editable folder editor",
    !!document.querySelector(".folder-editor") &&
      !document.querySelector(".folder-readonly") &&
      srcInput().value === "https://example.com/folders.json"
  );
  // Re-enabling hands ownership back to the file → read-only again.
  toggle().checked = true;
  toggle().dispatchEvent(new Event("change", { bubbles: true }));
  check(
    "re-enabling the source switches folders back to read-only",
    !document.querySelector(".folder-editor") && !!document.querySelector(".folder-readonly")
  );

  // Clearing the URL restores the editor.
  srcInput().value = "";
  srcInput().dispatchEvent(new Event("input", { bubbles: true }));
  srcInput().dispatchEvent(new Event("change", { bubbles: true }));
  check("clearing the source restores the folder editor", !!document.querySelector(".folder-editor"));
});
