import area from "@turf/area"
import bbox from "@turf/bbox"
import booleanValid from "@turf/boolean-valid"
import centroid from "@turf/centroid"
import kinks from "@turf/kinks"
import type { Feature, GeoJsonProperties, Polygon, Position } from "geojson"

import type { FarmBoundarySource, FarmFeature, FarmProperties, FieldFeature, FieldProperties } from "@/types/workspace"

const MAX_MERCATOR_LATITUDE = 85.051129

export interface GeometryValidation {
  valid: boolean
  errors: string[]
}

function positionsEqual(a: Position, b: Position) {
  return a[0] === b[0] && a[1] === b[1]
}

export function validatePolygon(feature: Feature<Polygon, GeoJsonProperties>): GeometryValidation {
  const errors: string[] = []
  const rings = feature.geometry.coordinates
  const exterior = rings[0]

  if (!exterior || exterior.length < 4) {
    errors.push("A field needs at least three corners and a closed boundary.")
    return { valid: false, errors }
  }

  for (const ring of rings) {
    if (ring.length < 4 || !positionsEqual(ring[0], ring[ring.length - 1])) {
      errors.push("Every boundary ring must be closed.")
      break
    }
  }

  const distinct = new Set(exterior.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`))
  if (distinct.size < 3) errors.push("A field needs at least three distinct corners.")

  const positions = rings.flat()
  if (positions.some(([lng, lat]) => lng < -180 || lng > 180 || lat < -90 || lat > 90)) {
    errors.push("Coordinates must use WGS84 longitude and latitude.")
  }
  if (positions.some(([, lat]) => Math.abs(lat) > MAX_MERCATOR_LATITUDE)) {
    errors.push("Fields outside the Web Mercator latitude limit are not supported.")
  }
  if (
    rings.some((ring) =>
      ring.slice(1).some((position, index) => Math.abs(position[0] - ring[index][0]) > 180),
    )
  ) {
    errors.push("Fields crossing the international date line are not supported in this prototype.")
  }
  if (!booleanValid(feature)) errors.push("The boundary is not a valid GeoJSON polygon.")
  if (kinks(feature).features.length > 0) errors.push("The boundary cannot intersect itself.")
  if (area(feature) <= 1) errors.push("The field area must be greater than one square metre.")

  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function featureAreaHectares(feature: Feature<Polygon>) {
  return area(feature) / 10_000
}

export function featureBounds(feature: Feature<Polygon>) {
  return bbox(feature) as [number, number, number, number]
}

export function featureCentroid(feature: Feature<Polygon>) {
  return centroid(feature).geometry.coordinates as [number, number]
}

export function createFieldFeature(
  geometry: Polygon,
  farmId: string,
  index: number,
  status: "candidate" | "confirmed" = "candidate",
  id = crypto.randomUUID(),
): FieldFeature {
  const now = new Date().toISOString()
  const properties: FieldProperties = {
    id,
    farmId,
    name: `Field ${index}`,
    status,
    partitionIndex: index,
    boundarySource: "generated",
    farmerConfirmed: status === "confirmed",
    createdAt: now,
    updatedAt: now,
  }
  return { type: "Feature", id, geometry, properties }
}

export function createFarmFeature(
  geometry: Polygon,
  source: FarmBoundarySource,
  index: number,
  id = crypto.randomUUID(),
): FarmFeature {
  const now = new Date().toISOString()
  const properties: FarmProperties = {
    id,
    name: source === "synthetic" ? `Demo farm ${index}` : `Farm ${index}`,
    boundarySource: source,
    partitionCount: 4,
    partitionMethod: "equal-area-strips",
    partitionOrientation: "farm-axis",
    partitionGridRows: null,
    partitionGridColumns: null,
    partitionStatus: "draft",
    createdAt: now,
    updatedAt: now,
  }
  return { type: "Feature", id, geometry, properties }
}

export function parseFarmGeoJson(value: unknown, startIndex: number): FarmFeature[] {
  if (!value || typeof value !== "object") throw new Error("The file is not valid GeoJSON.")
  const root = value as Record<string, unknown>
  const sourceFeatures = root.type === "FeatureCollection" ? root.features : [root]
  if (!Array.isArray(sourceFeatures)) throw new Error("The GeoJSON feature list is missing.")
  let rawFeatures: unknown[] = sourceFeatures
  const explicitFarms = rawFeatures.filter((raw) => {
    if (!raw || typeof raw !== "object") return false
    const properties = (raw as Feature).properties
    return properties?.partitionStatus === "draft" || properties?.partitionStatus === "confirmed"
  })
  if (explicitFarms.length > 0) rawFeatures = explicitFarms
  if (rawFeatures.length === 0) throw new Error("The GeoJSON file contains no farm boundaries.")
  if (rawFeatures.length > 50) throw new Error("Import at most 50 farms at a time.")

  return rawFeatures.map((raw, offset) => {
    if (!raw || typeof raw !== "object") throw new Error(`Feature ${offset + 1} is invalid.`)
    const feature = raw as Feature
    if (feature.type !== "Feature" || feature.geometry?.type !== "Polygon") {
      throw new Error(`Feature ${offset + 1} must be a Polygon; MultiPolygon is not supported.`)
    }
    const validation = validatePolygon(feature as Feature<Polygon>)
    if (!validation.valid) throw new Error(`Feature ${offset + 1}: ${validation.errors[0]}`)
    const result = createFarmFeature(feature.geometry, "imported", startIndex + offset)
    const name = feature.properties?.name
    if (typeof name === "string" && name.trim()) result.properties.name = name.trim().slice(0, 80)
    if (feature.properties?.partitionMethod === "regular-grid") result.properties.partitionMethod = "regular-grid"
    if (feature.properties?.partitionOrientation === "cardinal") result.properties.partitionOrientation = "cardinal"
    const partitionCount = feature.properties?.partitionCount
    if (typeof partitionCount === "number" && Number.isFinite(partitionCount)) {
      result.properties.partitionCount = Math.max(2, Math.min(12, Math.round(partitionCount)))
    }
    return result
  })
}
