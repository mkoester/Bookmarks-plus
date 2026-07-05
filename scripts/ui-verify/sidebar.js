/* Sidebar invariants: folders render and the open-all / open-in-background
   affordances exist (same shared renderFolderDetails as the popup). */
window.__verify.run(async ({ check, waitFor }) => {
  await waitFor(() => document.querySelector("#folders details"));
  check("folders render", !!document.querySelector("#folders details"));
  const openAll = document.querySelector(".open-all-btn");
  check("folder has an 'open all' button", !!openAll && openAll.tagName === "BUTTON");
  const openBg = document.querySelector(".open-bg-btn");
  check("bookmark row has an 'open in background' button", !!openBg && openBg.tagName === "BUTTON");
});
