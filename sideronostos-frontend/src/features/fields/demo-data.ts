import type { Polygon } from "geojson"

import { createFarmFeature } from "@/features/fields/geometry"
import { partitionFarm } from "@/features/fields/partition"
import type { FarmFeature, FieldFeature, FieldObservation } from "@/types/workspace"

const DEMO_FARM_GEOMETRY: Polygon =
  {
    type: "Polygon",
    coordinates: [[
      [-103.8106, 36.6905],
      [-103.7837, 36.6915],
      [-103.7828, 36.6705],
      [-103.8078, 36.6698],
      [-103.8106, 36.6905],
    ]],
  }

export function createDemoFarm(index = 1): { farm: FarmFeature; fields: FieldFeature[] } {
  const farm = createFarmFeature(DEMO_FARM_GEOMETRY, "synthetic", index)
  const result = partitionFarm(farm, farm.properties.partitionCount)
  farm.properties.partitionGridRows = result.gridLayout?.rows ?? null
  farm.properties.partitionGridColumns = result.gridLayout?.columns ?? null
  return { farm, fields: result.fields }
}

function stableNumber(id: string, offset: number) {
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return hash % offset
}

export function createDemoObservations(field: FieldFeature, date: string): FieldObservation[] {
  const moisture = 0.18 + stableNumber(field.properties.id, 13) / 100
  const temperature = 24 + stableNumber(field.properties.id, 70) / 10
  const ndvi = 0.42 + stableNumber(field.properties.id, 18) / 100
  return [
    {
      id: `${field.properties.id}:moisture:${date}`,
      fieldId: field.properties.id,
      metric: "Surface soil moisture",
      value: Number(moisture.toFixed(2)),
      unit: "m³/m³",
      observedAt: date,
      sourceProduct: "SMAP L3 Passive (demo-derived value)",
      evidenceKind: "synthetic",
      spatialSupport: "regional-background",
      nativeResolutionMeters: 36_000,
      uncertainty: "Illustrative value only; not sampled from the GIBS image.",
    },
    {
      id: `${field.properties.id}:temperature:${date}`,
      fieldId: field.properties.id,
      metric: "Land surface temperature",
      value: Number(temperature.toFixed(1)),
      unit: "°C",
      observedAt: date,
      sourceProduct: "ECOSTRESS-compatible demo metric",
      evidenceKind: "synthetic",
      spatialSupport: "field",
      nativeResolutionMeters: 70,
      uncertainty: "Synthetic prototype value.",
    },
    {
      id: `${field.properties.id}:ndvi:${date}`,
      fieldId: field.properties.id,
      metric: "Vegetation index",
      value: Number(ndvi.toFixed(2)),
      unit: "NDVI",
      observedAt: date,
      sourceProduct: "HLS-compatible demo metric",
      evidenceKind: "synthetic",
      spatialSupport: "field",
      nativeResolutionMeters: 30,
      uncertainty: "Synthetic prototype value.",
    },
  ]
}
