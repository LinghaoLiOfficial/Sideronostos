"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

const eventName = "field-shift:draft-updated";
const unavailable = "__storage_unavailable__";

// Drafts are session-scoped and namespaced by authenticated user and field.
export function useDraft<T>(key: string, initial: T) {
  const [fallback, setFallback] = useState(initial);
  const [edited, setEdited] = useState(false);
  const [fallbackDirty, setFallbackDirty] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const subscribe = useCallback((notify: () => void) => {
    const handle = (event: Event) => { if (!(event instanceof CustomEvent) || event.detail === key) notify(); };
    window.addEventListener(eventName, handle); window.addEventListener("storage", handle);
    return () => { window.removeEventListener(eventName, handle); window.removeEventListener("storage", handle); };
  }, [key]);
  const snapshot = useCallback(() => { try { return sessionStorage.getItem(key); } catch { return unavailable; } }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  let value = fallback;
  if (raw && raw !== unavailable && !writeFailed) { try { value = JSON.parse(raw) as T; } catch { /* A malformed draft falls back to current inputs. */ } }
  function update(next: T) {
    setFallback(next); setEdited(true); setFallbackDirty(true);
    try { sessionStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new CustomEvent(eventName, { detail: key })); }
    catch { setWriteFailed(true); }
  }
  function clearIfUnchanged(submitted: T) {
    try {
      const current = sessionStorage.getItem(key);
      if (current !== null && current !== JSON.stringify(submitted)) return false;
      sessionStorage.removeItem(key); window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
    } catch { /* Saving to the server still succeeds. */ }
    setEdited(true); setFallbackDirty(false); return true;
  }
  return { value, update, clearIfUnchanged, dirty: raw === unavailable || writeFailed ? fallbackDirty : Boolean(raw), restored: Boolean(raw && raw !== unavailable && !edited), storageAvailable: raw !== unavailable && !writeFailed };
}
