import { expect, it } from "vitest"
import { createDemoFarm } from "./demo-data"
import { toFieldFeature } from "./map-feature"
it("preserves the trusted owned identity and form metadata through drawing edits", () => {
  const { fields } = createDemoFarm(); const previous = fields[0]
  previous.properties.ownerUserId = "owner"; previous.properties.backendFieldId = "server-field"; previous.properties.backendVersion = 4
  previous.properties.details = { name: "Latest name", area_ha: 2, latitude: 40, longitude: -90, profile_id: "demo", soil_texture: "loam", irrigation_available: true, history: [] }
  const drawing = { ...previous, properties: { id: previous.properties.id, name: "stale draw state", backendFieldId: "wrong" } }
  const result = toFieldFeature(drawing, 0, fields)
  expect(result?.properties.details).toEqual(previous.properties.details)
  expect(result?.properties.backendFieldId).toBe("server-field")
  expect(result?.properties.backendVersion).toBe(4)
  expect(result?.properties.ownerUserId).toBe("owner")
})
it("returns confirmed boundaries unchanged even when drawing state has rounding drift", () => {
  const { fields } = createDemoFarm(); fields[0].properties.status = "confirmed"
  const draw = structuredClone(fields[0]); draw.geometry.coordinates[0][0][0] += 0.001
  expect(toFieldFeature(draw, 0, fields)).toBe(fields[0])
})
it("ignores drawing-library rounding and selection-only changes but detects a real boundary edit", () => {
  const { fields } = createDemoFarm(); const previous = fields[0]
  const rounded = structuredClone(previous)
  rounded.geometry.coordinates = rounded.geometry.coordinates.map(ring => ring.map(p => p.map(v => Number(v.toFixed(7)))))
  expect(toFieldFeature(rounded, 0, fields)).toBe(previous)
  rounded.geometry.coordinates[0][1][0] += 0.0001
  expect(toFieldFeature(rounded, 0, fields)).not.toBe(previous)
})
