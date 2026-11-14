"use client"

import { useState } from "react"
import Map, { Layer, NavigationControl, Source, type LayerProps } from "react-map-gl/maplibre"
import type { StyleSpecification } from "maplibre-gl"

import type { NASAAnalysisData } from "@/features/fields/nasa-analysis-types"

const mapStyle: string | StyleSpecification = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "(c) OpenStreetMap contributors",
    },
  },
  layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
}
const gpmLayer: LayerProps = {
  id: "gpm-grid-fill", type: "fill", source: "gpm-grid",
  paint: {
    "fill-color": ["interpolate", ["linear"], ["get", "mean_annual_rain_mm"], 700, "#b65b32", 900, "#d5bf75", 1100, "#5e9d76"],
    "fill-opacity": 0.62,
    "fill-outline-color": "#20251f",
  },
}
const fieldsLayer: LayerProps = {
  id: "synthetic-field-fill", type: "fill", source: "synthetic-fields",
  paint: { "fill-color": "#f0e6a4", "fill-opacity": 0.34, "fill-outline-color": "#fff4be" },
}
const fieldsOutline: LayerProps = {
  id: "synthetic-field-outline", type: "line", source: "synthetic-fields",
  paint: { "line-color": "#f5f1d8", "line-width": 2 },
}
const terrainLayer: LayerProps = {
  id: "srtm-raster", type: "raster", source: "srtm-image",
  paint: { "raster-opacity": 0.78 },
}

function imageBounds(data: NASAAnalysisData) {
  const [west, south, east, north] = data.terrain.bounds
  return [[west, north], [east, north], [east, south], [west, south]] as [
    [number, number], [number, number], [number, number], [number, number],
  ]
}

export function NASAAnalysisMap({ data }: { data: NASAAnalysisData }) {
  const [layer, setLayer] = useState<"gpm" | "terrain">("gpm")
  return <section aria-labelledby="spatial-heading" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs text-muted-foreground">Spatial data</p><h2 id="spatial-heading" className="text-base font-semibold">GPM grid and synthetic fields</h2></div>
      <div className="flex border p-0.5" role="group" aria-label="Map layer">
        <button type="button" aria-pressed={layer === "gpm"} onClick={() => setLayer("gpm")} className={"min-h-9 px-3 text-xs " + (layer === "gpm" ? "bg-foreground text-background" : "text-muted-foreground")}>GPM annual rain</button>
        <button type="button" aria-pressed={layer === "terrain"} onClick={() => setLayer("terrain")} className={"min-h-9 px-3 text-xs " + (layer === "terrain" ? "bg-foreground text-background" : "text-muted-foreground")}>SRTM terrain</button>
      </div>
    </div>
    <div className="h-[320px] overflow-hidden border sm:h-[400px]" data-testid="nasa-analysis-map">
      <Map initialViewState={{ longitude: -93.5, latitude: 42, zoom: 8.2 }} mapStyle={mapStyle} reuseMaps>
        <NavigationControl position="top-right" showCompass={false} />
        {layer === "gpm" ? <Source key="gpm" id="gpm-grid" type="geojson" data={data.gpm_grid}>
          <Layer {...gpmLayer} />
        </Source> : <Source key="terrain" id="srtm-image" type="image" url="/api/nasa-analysis/terrain" coordinates={imageBounds(data)}>
          <Layer {...terrainLayer} />
        </Source>}
        <Source id="synthetic-fields" type="geojson" data={data.fields}>
          <Layer {...fieldsLayer} />
          <Layer {...fieldsOutline} />
        </Source>
      </Map>
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {layer === "gpm" ? <><span className="flex items-center gap-2"><i className="size-3 bg-[#b65b32]" /> lower mean annual rain</span><span className="flex items-center gap-2"><i className="size-3 bg-[#5e9d76]" /> higher mean annual rain</span></> : <span>SRTM elevation image · {data.terrain.min_elevation_m.toFixed(0)}–{data.terrain.max_elevation_m.toFixed(0)} m</span>}
      <span className="flex items-center gap-2"><i className="size-3 border border-foreground bg-[#f0e6a4]/50" /> synthetic field boundaries</span>
    </div>
  </section>
}
