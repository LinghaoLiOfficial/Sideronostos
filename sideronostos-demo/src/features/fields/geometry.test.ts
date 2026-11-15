import { describe, expect, it } from "vitest"
import type { Feature, Polygon } from "geojson"

import { featureAreaHectares, parseFarmGeoJson, validatePolygon } from "@/features/fields/geometry"

const validPolygon: Feature<Polygon> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[[-103.81, 36.69], [-103.80, 36.69], [-103.80, 36.68], [-103.81, 36.68], [-103.81, 36.69]]],
  },
}

describe("field geometry", () => {
  it("accepts a closed WGS84 polygon and computes area", () => {
    expect(validatePolygon(validPolygon)).toEqual({ valid: true, errors: [] })
    const [farm] = parseFarmGeoJson(validPolygon, 1)
    expect(featureAreaHectares(farm)).toBeGreaterThan(90)
  })

  it("rejects self intersections", () => {
    const crossed: Feature<Polygon> = {
      ...validPolygon,
      geometry: {
        type: "Polygon",
        coordinates: [[[-103.81, 36.69], [-103.80, 36.68], [-103.80, 36.69], [-103.81, 36.68], [-103.81, 36.69]]],
      },
    }
    expect(validatePolygon(crossed).valid).toBe(false)
    expect(validatePolygon(crossed).errors.join(" ")).toMatch(/intersect|valid/i)
  })

  it("rejects MultiPolygon imports with a clear message", () => {
    expect(() => parseFarmGeoJson({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [] } }, 1)).toThrow(/MultiPolygon/)
  })

  it("preserves a valid imported partition orientation", () => {
    const [farm] = parseFarmGeoJson({
      ...validPolygon,
      properties: { partitionMethod: "regular-grid", partitionOrientation: "cardinal", partitionCount: 6 },
    }, 1)
    expect(farm.properties).toMatchObject({
      partitionMethod: "regular-grid",
      partitionOrientation: "cardinal",
      partitionCount: 6,
    })
  })
})
