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
});
