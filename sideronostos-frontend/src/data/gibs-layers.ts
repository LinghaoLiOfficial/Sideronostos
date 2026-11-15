import type { GibsLayerConfig } from "@/types/workspace"

export const NASA_REMOTE_SENSING_LAYERS: GibsLayerConfig[] = [
  {
    id: "modis-true-color",
    title: "MODIS Terra true color",
    description: "Daily corrected-reflectance true-color imagery from the Terra satellite.",
    layerId: "MODIS_Terra_CorrectedReflectance_TrueColor",
    format: "jpg",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    minDate: "2000-02-24",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 9,
    nativeResolutionLabel: "250 m imagery; cloud and observation gaps possible",
    unit: null,
    legendUrl: null,
    attribution: "NASA Data",
  },
  {
    id: "modis-ndvi",
    title: "MODIS Terra NDVI",
    description: "Sixteen-day normalized difference vegetation index composite from Terra.",
    layerId: "MODIS_Terra_L3_NDVI_16Day",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    minDate: "2000-02-18",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 9,
    nativeResolutionLabel: "250 m, 16-day vegetation composite",
    unit: "NDVI",
    legendUrl: "/images/legends/modis-ndvi.svg",
    attribution: "NASA Data",
  },
  {
    id: "modis-evi",
    title: "MODIS Terra EVI",
    description: "Eight-day enhanced vegetation index composite from Terra.",
    layerId: "MODIS_Terra_EVI_8Day",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    minDate: "2000-02-18",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 9,
    nativeResolutionLabel: "250 m, 8-day vegetation composite",
    unit: "EVI",
    legendUrl: "/images/legends/modis-evi.svg",
    attribution: "NASA Data",
  },
  {
    id: "imerg-precipitation",
    title: "GPM IMERG precipitation",
    description: "Near-real-time precipitation-rate imagery from the GPM IMERG product.",
    layerId: "IMERG_Precipitation_Rate",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    minDate: "2000-06-01",
    maxDate: "today",
    defaultDate: "2026-11-06",
    maxNativeZoom: 6,
    nativeResolutionLabel: "10 km class regional precipitation context",
    unit: "mm/hr",
    legendUrl: "/images/legends/imerg-precipitation.svg",
    attribution: "NASA Data",
  },
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
    legendUrl: "/images/legends/smap-soil-moisture.svg",
    attribution: "NASA Data",
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
    legendUrl: "/images/legends/smap-soil-moisture.svg",
    attribution: "NASA Data",
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
