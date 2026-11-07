"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveWorkspaceFileContent } from "@/lib/api/client";

export function useFileAutosave(organizationId: string, fileId: string, initialContent: unknown) {
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const latest = useRef(initialContent);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);

  const flush = useCallback((): Promise<boolean> => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (active.current) return active.current;
    if (revision.current === savedRevision.current) return Promise.resolve(true);
    setStatus("saving");
    // One worker drains the newest snapshots; no two PATCH requests overlap.
    const worker = async () => {
      try {
        while (savedRevision.current < revision.current) {
          const savingRevision = revision.current;
          await saveWorkspaceFileContent(organizationId, fileId, latest.current);
          savedRevision.current = savingRevision;
        }
        if (mounted.current) setStatus("saved");
        return true;
      } catch {
        if (mounted.current) setStatus("error");
        return false;
      } finally {
        active.current = null;
      }
    };
    active.current = worker();
    return active.current;
  }, [organizationId, fileId]);

  const change = useCallback((content: unknown) => {
    latest.current = content;
    revision.current += 1;
    setStatus("saving");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { void flush(); }, 800);
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      if (pending.current) clearTimeout(pending.current);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  return { status, change, flush };
}
