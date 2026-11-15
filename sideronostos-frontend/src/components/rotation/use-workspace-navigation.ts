"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export function useWorkspaceNavigation(path: "/fields" | "/field-shift/map" | "/field-shift/rotation") {
  const router = useRouter(), search = useSearchParams(), latestSearch = useRef(search.toString())
  const [revision, setRevision] = useState(1)
  useEffect(() => { latestSearch.current = search.toString() }, [search])
  function href(patch: Record<string, string | null> = {}, nextPath = path) {
    const params = new URLSearchParams(latestSearch.current)
    for (const [key, value] of Object.entries(patch)) { if (value) params.set(key, value); else params.delete(key) }
    return `${nextPath}${params.size ? "?" + params : ""}`
  }
  function navigate(patch: Record<string, string | null>, nextPath = path) {
    setRevision(v => v + 1)
    const url = href(patch, nextPath)
    latestSearch.current = url.split("?")[1] ?? ""
    if (nextPath === path) globalThis.history.replaceState(null, "", url)
    else router.replace(url, { scroll: false })
  }
  return { search, latestSearch, revision, setRevision, navigate, href }
}
