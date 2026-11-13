import { describe, expect, it } from "vitest"
import type { Polygon } from "geojson"

import { createFarmFeature } from "@/features/fields/geometry"
import { partitionFarm, validateCandidatePartition } from "@/features/fields/partition"
import type { FieldFeature, PartitionMethod } from "@/types/workspace"

function sharedSegments(fields: FieldFeature[]) {
  const segments = new Map<string, { start: number[]; end: number[]; count: number }>()
  for (const field of fields) {
    const ring = field.geometry.coordinates[0]
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index].slice(0, 2).map((value) => Number(value.toFixed(8)))
      const end = ring[index + 1].slice(0, 2).map((value) => Number(value.toFixed(8)))
      const ordered = [start, end].sort((left, right) => left[0] - right[0] || left[1] - right[1])
      const key = JSON.stringify(ordered)
      const existing = segments.get(key)
      segments.set(key, { start: ordered[0], end: ordered[1], count: (existing?.count ?? 0) + 1 })
    }
  }
  return [...segments.values()].filter((segment) => segment.count > 1)
}

const shapes: Array<{ name: string; geometry: Polygon }> = [
  {
    name: "horizontal rectangle",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0.04, 0], [0.04, 0.015], [0, 0.015], [0, 0]]] },
  },
  {
    name: "rotated farm",
    geometry: { type: "Polygon", coordinates: [[[0, 0.01], [0.03, 0.025], [0.04, 0.015], [0.01, 0], [0, 0.01]]] },
  },
  {
    name: "concave farm",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0.04, 0], [0.04, 0.02], [0.025, 0.02], [0.025, 0.008], [0.015, 0.008], [0.015, 0.02], [0, 0.02], [0, 0]]] },
  },
  {
    name: "farm with a hole",
    geometry: { type: "Polygon", coordinates: [
      [[0, 0], [0.04, 0], [0.04, 0.03], [0, 0.03], [0, 0]],
      [[0.016, 0.01], [0.024, 0.01], [0.024, 0.02], [0.016, 0.02], [0.016, 0.01]],
    ] },
  },
]

describe("farm partitioning", () => {
  for (const shape of shapes) {
    it(`preserves area and topology for a ${shape.name}`, () => {
      const farm = createFarmFeature(shape.geometry, "synthetic", 1)
      const result = partitionFarm(farm, 4)
      const validation = validateCandidatePartition(farm, result.fields)
      expect(result.fields.length).toBeGreaterThanOrEqual(4)
      expect(validation.errors).toEqual([])
      expect(validation.coverageRatio).toBeGreaterThan(0.999)
    })
  }

  it.each([2, 4, 12])("creates %i near-equal strips for a simple farm", (count) => {
    const farm = createFarmFeature(shapes[0].geometry, "synthetic", 1)
    const result = partitionFarm(farm, count)
    const areas = result.fields.map((field) => {
      const ring = field.geometry.coordinates[0]
      return Math.abs(ring.slice(0, -1).reduce((sum, point, index) => sum + point[0] * ring[index + 1][1] - ring[index + 1][0] * point[1], 0) / 2)
    })
    const average = areas.reduce((sum, value) => sum + value, 0) / areas.length
    expect(result.fields).toHaveLength(count)
    expect(Math.max(...areas) / average).toBeLessThan(1.01)
    expect(Math.min(...areas) / average).toBeGreaterThan(0.99)
  })

  for (const shape of shapes) {
    it(`preserves area and topology for a regular grid on a ${shape.name}`, () => {
      const farm = createFarmFeature(shape.geometry, "synthetic", 1)
      const result = partitionFarm(farm, 6, "regular-grid")
      const validation = validateCandidatePartition(farm, result.fields)
      expect(result.method).toBe("regular-grid")
      expect(result.gridLayout).not.toBeNull()
      expect(validation.errors).toEqual([])
      expect(validation.coverageRatio).toBeGreaterThan(0.999)
    })
  }

  it.each([2, 4, 5, 6, 12])("selects a valid complete grid near target %i", (count) => {
    const farm = createFarmFeature(shapes[0].geometry, "synthetic", 1)
    const result = partitionFarm(farm, count, "regular-grid")
    const validation = validateCandidatePartition(farm, result.fields)
    expect(validation.valid).toBe(true)
    expect(Math.abs(result.actualCount - count)).toBeLessThanOrEqual(1)
    expect(result.gridLayout).not.toBeNull()
    if (count === 4) expect(result.gridLayout).toEqual({ rows: 2, columns: 2 })
    if (count === 5) expect([4, 6]).toContain(result.gridLayout!.rows * result.gridLayout!.columns)
  })

  it("orients grid columns along the long axis of a rotated farm", () => {
    const farm = createFarmFeature(shapes[1].geometry, "synthetic", 1)
    const result = partitionFarm(farm, 6, "regular-grid")
    expect(result.gridLayout).not.toBeNull()
    expect(result.gridLayout!.columns).toBeGreaterThanOrEqual(result.gridLayout!.rows)
  })

  it.each(["equal-area-strips", "regular-grid"] as PartitionMethod[])(
    "preserves topology for cardinal %s partitions",
    (method) => {
      const farm = createFarmFeature(shapes[2].geometry, "synthetic", 1)
      const result = partitionFarm(farm, 6, method, "cardinal")
      expect(result.orientation).toBe("cardinal")
      expect(validateCandidatePartition(farm, result.fields).errors).toEqual([])
    },
  )

  it("aligns regular-grid internal boundaries to map axes in cardinal mode", () => {
    const farm = createFarmFeature(shapes[1].geometry, "synthetic", 1)
    const cardinal = partitionFarm(farm, 6, "regular-grid", "cardinal")
    const farmAxis = partitionFarm(farm, 6, "regular-grid", "farm-axis")
    const cardinalShared = sharedSegments(cardinal.fields)
    const farmAxisShared = sharedSegments(farmAxis.fields)
    expect(cardinalShared.length).toBeGreaterThan(0)
    expect(cardinalShared.every(({ start, end }) =>
      Math.abs(start[0] - end[0]) < 1e-7 || Math.abs(start[1] - end[1]) < 1e-7,
    )).toBe(true)
    expect(farmAxisShared.some(({ start, end }) =>
      Math.abs(start[0] - end[0]) >= 1e-7 && Math.abs(start[1] - end[1]) >= 1e-7,
    )).toBe(true)
  })

  it("snaps cardinal strips to the nearest east-west or north-south axis", () => {
    const horizontalFarm = createFarmFeature(shapes[0].geometry, "synthetic", 1)
    const verticalFarm = createFarmFeature({
      type: "Polygon",
      coordinates: [[[0, 0], [0.015, 0], [0.015, 0.04], [0, 0.04], [0, 0]]],
    }, "synthetic", 2)
    const horizontal = sharedSegments(partitionFarm(horizontalFarm, 4, "equal-area-strips", "cardinal").fields)
    const vertical = sharedSegments(partitionFarm(verticalFarm, 4, "equal-area-strips", "cardinal").fields)
    expect(horizontal.every(({ start, end }) => Math.abs(start[1] - end[1]) < 1e-7)).toBe(true)
    expect(vertical.every(({ start, end }) => Math.abs(start[0] - end[0]) < 1e-7)).toBe(true)
  })
})
