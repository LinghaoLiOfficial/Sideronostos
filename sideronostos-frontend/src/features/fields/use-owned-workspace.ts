"use client"
import { useEffect, useState, useSyncExternalStore } from "react"
import { OwnedWorkspace } from "./owned-workspace"

// The caller keys its subtree by ownerId, including anonymous, to clear all in-flight context.
export function useOwnedWorkspace(ownerId: string | null) {
  const [store] = useState(() => new OwnedWorkspace(ownerId))
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { void store.start(); return () => store.dispose() }, [store])
  return { ...snapshot, store }
}
