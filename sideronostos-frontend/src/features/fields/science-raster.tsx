"use client"
/* eslint-disable react-hooks/set-state-in-effect -- Register an external map protocol before publishing its source. */
import { useEffect, useState } from "react"
import { addProtocol, removeProtocol } from "maplibre-gl"
import { Layer, Source } from "react-map-gl/maplibre"
import { apiBlob } from "@/lib/api/client"
import type { LayerManifest } from "@/lib/api/rotation-types"

/** Authenticated tiles stay on the configured API; credentials never go to GIBS/basemaps. */
export function ScienceRaster({ layer }: { layer: LayerManifest }) {
  const [protocol] = useState(() => `fieldscience${crypto.randomUUID().replaceAll("-", "")}`)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    addProtocol(protocol, async (request, controller) => {
      if (!active) throw new Error("Science layer was closed")
      const path = request.url.slice(`${protocol}://`.length)
      if (!path.startsWith("/agri-data/layers/")) throw new Error("Unexpected science tile path")
      const blob = await apiBlob(path, { signal: controller.signal })
      if (!active) throw new Error("Science layer was closed")
      return { data: await blob.arrayBuffer() }
    })
    setReady(true)
    return () => { active = false; removeProtocol(protocol) }
  }, [protocol])
  if (!ready) return null
  return <Source id="prepared-science" type="raster" tiles={layer.tiles.map(path => `${protocol}://${path}`)} tileSize={layer.tile_size} minzoom={layer.minzoom} maxzoom={layer.maxzoom} bounds={layer.bounds}>
    <Layer id="prepared-science-raster" type="raster" paint={{ "raster-opacity": 0.75, "raster-resampling": "nearest" }} />
  </Source>
}
