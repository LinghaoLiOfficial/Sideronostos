import type { Feature, Polygon } from "geojson"
import type { FieldFeature } from "@/types/workspace"
import { validatePolygon } from "./geometry"

export function toFieldFeature(feature: Feature, index: number, previousFields: FieldFeature[]): FieldFeature | null {
  if (feature.geometry.type !== "Polygon") return null
  const properties = feature.properties as Record<string, unknown>
  const id = typeof properties.id === "string" ? properties.id : String(feature.id)
  const previous = previousFields.find(field => field.properties.id === id)
  if (previous?.properties.status === "confirmed") return previous
  const rounded = (geometry: Polygon) => JSON.stringify(geometry.coordinates.map(ring => ring.map(p => p.map(v => Number(v.toFixed(7))))))
  if (previous && rounded(previous.geometry) === rounded(feature.geometry as Polygon)) return previous
  const now = new Date().toISOString()
  const candidate: FieldFeature = {
    type: "Feature",
    id,
    geometry: feature.geometry as Polygon,
    properties: {
      id,
      farmId: typeof properties.farmId === "string" ? properties.farmId : "",
      name: typeof properties.name === "string" ? properties.name : `Field ${index + 1}`,
      status: properties.status === "confirmed" ? "confirmed" : "candidate",
      partitionIndex: typeof properties.partitionIndex === "number" ? properties.partitionIndex : index + 1,
      boundarySource: properties.boundarySource === "edited" ? "edited" : "generated",
      farmerConfirmed: properties.farmerConfirmed === true,
      createdAt: typeof properties.createdAt === "string" ? properties.createdAt : now,
      ...previous?.properties,
      updatedAt: now,
    },
  }
  return validatePolygon(candidate).valid ? candidate : null
}

