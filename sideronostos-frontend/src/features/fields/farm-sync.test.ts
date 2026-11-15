import { describe, expect, it } from "vitest"
import { createDemoFarm } from "./demo-data"
import { applyFarmSync, buildFarmSync, mergeRemoteFarms, pointInsidePolygon } from "./farm-sync"
import type { FarmSyncResult, ServerFarm } from "@/lib/api/farms"

function fixture() {
  const { farm, fields } = createDemoFarm()
  farm.properties.partitionStatus = "confirmed"
  farm.properties.partitionRevision = "revision-one"
  farm.properties.ownerUserId = "owner"
  for (const field of fields) {
    field.properties.status = "confirmed"
    field.properties.farmerConfirmed = true
    field.properties.ownerUserId = "owner"
    field.properties.details = { name: field.properties.name, area_ha: 1, latitude: 0, longitude: 0,
      profile_id: "temperate-demo", soil_texture: "loam", irrigation_available: true, history: [] }
  }
  return { farm, fields }
}

function reply(request: ReturnType<typeof buildFarmSync>): FarmSyncResult {
  return {
    farm: { ...request.farm, id: "server-farm", version: 1, resource_group_id: "server-farm",
      created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" },
    complete: true,
    items: request.fields.map((item, i) => ({ local_id: item.local_id, status: "synced",
      error: null, field: { ...item.field, id: `server-${i}`, version: 1,
        farm_id: "server-farm", partition_revision: "revision-one", local_id: item.local_id,
        created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" } })),
  }
}

describe("managed farm synchronization", () => {
  it("uses reviewed map geometry and stable identities, never the form's stale coordinates", () => {
    const { farm, fields } = fixture()
    const request = buildFarmSync(farm, fields, "attempt-one", "owner")
    expect(request.farm.local_id).toBe(farm.properties.id)
    expect(request.farm.partition_revision).toBe("revision-one")
    expect(request.fields).toHaveLength(4)
    expect(request.fields[0].field.geometry).toEqual(fields[0].geometry)
    expect(request.fields[0].field.area_ha).toBeGreaterThan(1)
    expect(request.fields[0].field.longitude).toBeLessThan(-100)
    expect(request.fields[0].expected_version).toBeUndefined()
  })
  it("blocks unsaved boundaries and another account's data", () => {
    const { farm, fields } = fixture()
    expect(() => buildFarmSync(farm, fields, "attempt-one", "other")).toThrow(/owner/i)
    farm.properties.partitionStatus = "draft"
    expect(() => buildFarmSync(farm, fields, "attempt-one", "owner")).toThrow(/confirm/i)
  })
  it("records individual failures instead of marking every field synced", () => {
    const { farm, fields } = fixture()
    const request = buildFarmSync(farm, fields, "attempt-one", "owner")
    fields.forEach((f, i) => { f.properties.details = request.fields[i].field })
    const response = reply(request)
    response.complete = false
    response.items[1] = { local_id: fields[1].properties.id, status: "invalid", field: null, error: "Missing soil" }
    const applied = applyFarmSync({ farms: [farm], fields }, request, response)
    expect(applied.fields[0].properties.backendFieldId).toBe("server-0")
    expect(applied.fields[0].properties.syncStatus).toBe("synced")
    expect(applied.fields[1].properties.syncStatus).toBe("error")
    expect(applied.fields[1].properties.backendFieldId).toBeUndefined()
  })
  it("retains newer local edits when a submitted response arrives late", () => {
    const { farm, fields } = fixture()
    const request = buildFarmSync(farm, fields, "attempt-one", "owner")
    fields.forEach((f, i) => { f.properties.details = request.fields[i].field })
    fields[0].properties.details = { ...fields[0].properties.details!, name: "New draft" }
    const applied = applyFarmSync({ farms: [farm], fields }, request, reply(request))
    expect(applied.fields[0].properties.details?.name).toBe("New draft")
    expect(applied.fields[0].properties.syncStatus).toBe("needs-details")
    expect(applied.fields[0].properties.backendFieldId).toBe("server-0")
    farm.properties.partitionRevision = "new-partition"
    expect(applyFarmSync({ farms: [farm], fields }, request, reply(request)).fields[0].properties.backendFieldId).toBeUndefined()
  })
  it("restores remote identity without replacing unsynchronized local forms", () => {
    const { farm, fields } = fixture()
    const request = buildFarmSync(farm, fields, "attempt-one", "owner")
    const response = reply(request)
    const remote: ServerFarm = { ...response.farm, fields: response.items.map(i => i.field!) }
    const restored = mergeRemoteFarms({ farms: [], fields: [] }, [remote], "owner")
    expect(restored.farms[0].properties.backendFarmId).toBe("server-farm")
    expect(restored.fields[0].properties.backendFieldId).toBe("server-0")
    restored.fields[0].properties.details = { ...restored.fields[0].properties.details!, name: "Unsaved" }
    restored.fields[0].properties.syncStatus = "needs-details"
    const next = mergeRemoteFarms(restored, [remote], "owner")
    expect(next.fields[0].properties.details?.name).toBe("Unsaved")
  })
})

it("chooses a point in a concave polygon and outside its holes", () => {
  // C-shaped polygon: the average vertex lies in the open notch.
  const concave = { type: "Polygon" as const, coordinates: [[[0,0],[4,0],[4,1],[1,1],[1,3],[4,3],[4,4],[0,4],[0,0]]] }
  const [x,y] = pointInsidePolygon(concave)
  expect(x > 0 && x < 4 && y > 0 && y < 4).toBe(true)
  expect(x < 1 || y < 1 || y > 3).toBe(true)
  const hole = { type: "Polygon" as const, coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[3,1],[3,3],[1,3],[1,1]]] }
  const [hx,hy] = pointInsidePolygon(hole)
  expect(hx > 0 && hx < 4 && hy > 0 && hy < 4).toBe(true)
  expect(hx < 1 || hx > 3 || hy < 1 || hy > 3).toBe(true)
})
