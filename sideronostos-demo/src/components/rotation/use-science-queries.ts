"use client"
import { useQuery } from "@tanstack/react-query"
import * as api from "@/lib/api/rotation"

export function useScienceQueries(ownerId: string | null, selectionId: string | null, layerId: string, dates?: { start: string; end: string }) {
  const selection = useQuery({ queryKey: ["rotation", ownerId, "selection", selectionId], queryFn: () => api.getSelection(selectionId!), enabled: Boolean(ownerId && selectionId), retry: false })
  const facts = useQuery({ queryKey: ["rotation", ownerId, "facts", selectionId, selection.data?.revision, dates],
    queryFn: ({ signal }) => api.getRegionFacts(selection.data!, dates, signal), enabled: Boolean(ownerId && selection.data), retry: false })
  const layers = useQuery({ queryKey: ["rotation", ownerId, "layers"], queryFn: api.listLayers, enabled: Boolean(ownerId), retry: false })
  const manifest = useQuery({ queryKey: ["rotation", ownerId, "manifest", layerId], queryFn: () => api.getLayerManifest(layerId), enabled: Boolean(ownerId && layerId), retry: false, staleTime: Infinity })
  return { selection, facts, layers, manifest }
}
