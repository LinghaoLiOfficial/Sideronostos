import type { GibsLayerConfig } from "@/types/workspace"

export const GIBS_LAYERS: GibsLayerConfig[] = []

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
