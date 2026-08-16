/**
 * Copy text to the clipboard, working over plain HTTP too.
 *
 * The async Clipboard API (`navigator.clipboard`) is only exposed in a SECURE CONTEXT — HTTPS, or
 * `localhost`. A self-host dashboard opened at `http://<vps-ip>:8080` is neither, so
 * `navigator.clipboard` is `undefined` there and `navigator.clipboard?.writeText(...)` silently
 * no-ops — which is why a copy button flashed its success check but nothing landed on the clipboard.
 *
 * Fall back to the legacy hidden-`<textarea>` + `document.execCommand("copy")`, which still works in
 * a non-secure context. Returns whether the copy ACTUALLY succeeded so callers only show a success
 * state when it did (never a lying check).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* secure-context copy blocked/denied — fall through to the legacy path */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
