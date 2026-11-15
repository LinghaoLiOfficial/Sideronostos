import type { Polygon } from "geojson"

import { createFarmFeature } from "@/features/fields/geometry"
import { partitionFarm } from "@/features/fields/partition"
import { demoFarm } from "@/lib/demo/data"
import type { FarmFeature, FieldFeature, FieldObservation } from "@/types/workspace"

const DEMO_FARM_GEOMETRY: Polygon = demoFarm.geometry

export function createDemoFarm(index = 1): { farm: FarmFeature; fields: FieldFeature[] } {
  const farm = createFarmFeature(DEMO_FARM_GEOMETRY, "imported", index, index === 1 ? demoFarm.properties.id : undefined)
  if (index === 1) farm.properties.name = demoFarm.properties.name
  const result = partitionFarm(farm, farm.properties.partitionCount)
  farm.properties.partitionGridRows = result.gridLayout?.rows ?? null
  farm.properties.partitionGridColumns = result.gridLayout?.columns ?? null
  return { farm, fields: result.fields }
}

export function createDemoObservations(field: FieldFeature, date: string): FieldObservation[] {
  const index = field.properties.partitionIndex
  const moisture = 0.24 + index * 0.01
  const temperature = 25.1 + index * 0.4
  const ndvi = 0.69 + index * 0.015
  return [
    {
      id: `${field.properties.id}:moisture:${date}`,
      fieldId: field.properties.id,
      metric: "Surface soil moisture",
      value: Number(moisture.toFixed(2)),
      unit: "m³/m³",
      observedAt: "2024-07-16",
      sourceProduct: "SMAP SPL4SMGP.008 · Iowa backend release",
      evidenceKind: "precomputed",
      spatialSupport: "regional-background",
      nativeResolutionMeters: 36_000,
      uncertainty: "Regional SMAP context; it does not resolve this individual field.",
    },
    {
      id: `${field.properties.id}:temperature:${date}`,
      fieldId: field.properties.id,
      metric: "Land surface temperature",
      value: Number(temperature.toFixed(1)),
      unit: "°C",
      observedAt: "2024-07-16",
      sourceProduct: "ECOSTRESS L2T LSTE · Iowa backend release",
      evidenceKind: "precomputed",
      spatialSupport: "regional-background",
      nativeResolutionMeters: 70,
      uncertainty: "ECOSTRESS observation support is regional and intermittent.",
    },
    {
      id: `${field.properties.id}:ndvi:${date}`,
      fieldId: field.properties.id,
      metric: "Vegetation index",
      value: Number(ndvi.toFixed(2)),
      unit: "NDVI",
      observedAt: "2024-07-16",
      sourceProduct: "HLSL30/HLSS30 vegetation index · Iowa backend release",
      evidenceKind: "precomputed",
      spatialSupport: "regional-background",
      nativeResolutionMeters: 30,
      uncertainty: "HLS observations are regional context and do not replace field sampling.",
    },
  ]
}
