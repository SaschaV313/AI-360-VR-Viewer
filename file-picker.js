// A focus/visibility event can precede the native picker's change event on iOS.
// Only change, cancel, or a new interaction with the page ends the picker pause.
// Never replace the input, prevent its default action, or await before it opens.
export function bindFilePickers(inputs, { suspend, resume, interrupted = () => {} },
  page = document, host = window) {
  let active = null;
  const key = `ai-360-picker:${host.location.pathname}`;
  try {
    if (host.sessionStorage.getItem(key)) interrupted();
    host.sessionStorage.removeItem(key);
  } catch { /* Private storage must not prevent opening a file. */ }

  function finish() {
    active = null;
    try { host.sessionStorage.removeItem(key); } catch { /* Optional recovery hint. */ }
    // Let the change handler claim its operation before trying to restore a view.
    queueMicrotask(() => { if (!page.hidden) resume(); });
  }

  for (const input of inputs) {
    input.addEventListener("click", () => {
      if (input.disabled) return;
      active = input;
      try { host.sessionStorage.setItem(key, "open"); } catch { /* Optional recovery hint. */ }
      suspend();
    }, true);
    input.addEventListener("change", finish, true);
    input.addEventListener("cancel", finish);
  }
  page.addEventListener("visibilitychange", () => {
    if (page.hidden) suspend();
    else if (!active) resume();
  });
  host.addEventListener("pagehide", suspend);
  host.addEventListener("pageshow", () => { if (!page.hidden && !active) resume(); });
  // Older pickers may omit cancel. A real interaction back in the page is a
  // reliable fallback; window focus alone is not evidence the picker closed.
  page.addEventListener("pointerdown", event => {
    if (active && event.isTrusted) finish();
  }, true);
  return { get blocked() { return Boolean(active) || page.hidden; } };
}
