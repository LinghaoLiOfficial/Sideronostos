import type { GibsLayerConfig } from "@/types/workspace"

export const GIBS_LAYERS: GibsLayerConfig[] = [
  {
    id: "smap-day",
    title: "SMAP soil moisture · day",
    description: "L3 passive radiometer surface soil moisture from the daytime overpass.",
    layerId: "SMAP_L3_Passive_Day_Soil_Moisture",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    minDate: "2015-03-31",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 6,
    nativeResolutionLabel: "36 km native grid; regional context",
    unit: "m³/m³",
    legendUrl: "https://gibs.earthdata.nasa.gov/legends/SMAP_Soil_Moisture_H.svg",
    attribution: "NASA EOSDIS GIBS / SMAP",
  },
  {
    id: "smap-night",
    title: "SMAP soil moisture · night",
    description: "L3 passive radiometer surface soil moisture from the nighttime overpass.",
    layerId: "SMAP_L3_Passive_Night_Soil_Moisture",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    minDate: "2015-03-31",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 6,
    nativeResolutionLabel: "36 km native grid; regional context",
    unit: "m³/m³",
    legendUrl: "https://gibs.earthdata.nasa.gov/legends/SMAP_Soil_Moisture_H.svg",
    attribution: "NASA EOSDIS GIBS / SMAP",
  },
]

export function buildGibsTileUrl(layer: GibsLayerConfig, date: string) {
  return [
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best",
    layer.layerId,
    "default",
    date,
    layer.tileMatrixSet,
    "{z}",
    "{y}",
    `{x}.${layer.format}`,
  ].join("/")
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return toIsoDate(value)
}

export function clampLayerDate(date: string, layer: GibsLayerConfig) {
  const today = toIsoDate(new Date())
  const max = layer.maxDate === "today" ? today : layer.maxDate
  if (layer.minDate && date < layer.minDate) return layer.minDate
  if (max && date > max) return max
  return date
}
