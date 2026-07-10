// Fallback for URLs an extension can't open — specifically Firefox's privileged
// about: pages (about:debugging, about:config, …), which every extension API
// refuses to load (see isCopyOnlyUrl in ./url). Instead of silently failing, we
// copy the URL to the clipboard and show a transient hint so the user can paste it
// into the address bar (Ctrl+L) themselves. The toast always shows the full URL, so
// the feature still works even if the clipboard write is blocked.

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export async function copyBookmarkUrl(url: string): Promise<void> {
  let copied = false;
  try {
    // Works from a user-gesture click in an extension page (a secure context) with
    // no extra permission; the catch covers the rare case where it's blocked.
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // ignore — the toast below still shows the URL to copy manually
  }
  showCopyToast(url, copied);
}

function showCopyToast(url: string, copied: boolean): void {
  document.querySelector(".copy-toast")?.remove();

  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.setAttribute("role", "status");

  const heading = document.createElement("strong");
  heading.textContent = copied ? "Copied to clipboard" : "Select and copy this URL:";

  const urlLine = document.createElement("span");
  urlLine.className = "copy-toast-url";
  urlLine.textContent = url;

  const hint = document.createElement("span");
  hint.className = "copy-toast-hint";
  hint.textContent = "Firefox blocks extensions from opening this page — paste it into the address bar (Ctrl+L).";

  toast.append(heading, urlLine, hint);
  document.body.appendChild(toast);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 6000);
}
