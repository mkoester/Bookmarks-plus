/* Shared helpers for the headless UI-verification drivers (see
   scripts/verify-ui.mjs). Injected as a classic script AFTER a page's own
   bundle so the page's DOMContentLoaded init is already registered, and BEFORE
   the per-surface driver. Exposes window.__verify. */
window.__verify = (() => {
  const results = [];

  const check = (name, cond) => {
    results.push(`${cond ? "PASS" : "FAIL"}: ${name}`);
    return cond;
  };

  // Only a page's initial init() (storage load) is async. Wait for it via a
  // macrotask-yielding loop, then keep driver code synchronous — renderTabs()
  // and the like rebuild the DOM synchronously, so no further awaits are needed
  // (and fewer idle ticks for chromium --dump-dom to fire on prematurely).
  async function waitFor(fn, maxMacro = 40) {
    for (let m = 0; m < maxMacro; m++) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 0));
    }
    return fn();
  }

  // Writes a <pre id="verify-result"> the runner greps, and encodes the overall
  // verdict in the title so the runner can double-check.
  function finish() {
    const pre = document.createElement("pre");
    pre.id = "verify-result";
    pre.textContent = results.join("\n");
    document.body.appendChild(pre);
    const ok = results.length > 0 && results.every((r) => r.startsWith("PASS"));
    document.title = ok ? "VERIFY-PASS" : "VERIFY-FAIL";
  }

  // Wrap a driver body so a thrown error becomes a FAIL line instead of an
  // empty dump.
  async function run(body) {
    try {
      await body(api);
    } catch (err) {
      check(`driver threw: ${(err && err.stack) || err}`, false);
    }
    finish();
  }

  const api = { check, waitFor, finish, run };
  return api;
})();
