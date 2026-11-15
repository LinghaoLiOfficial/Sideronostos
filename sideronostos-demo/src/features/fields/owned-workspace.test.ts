import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FarmSyncInput, FarmSyncResult } from "@/lib/api/farms"
import { createDemoFarm } from "./demo-data"
import { OwnedWorkspace } from "./owned-workspace"

const boundary = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), restore: vi.fn(), sync: vi.fn(), import: vi.fn() }))
vi.mock("./storage", () => ({ getStoredWorkspace: boundary.get, replaceStoredWorkspace: boundary.put, importLocalWorkspace: boundary.import }))
vi.mock("@/lib/api/farms", () => ({ restoreFarms: boundary.restore, syncFarm: boundary.sync }))
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture(owner = "a") {
  const { farm, fields } = createDemoFarm()
  farm.properties = { ...farm.properties, ownerUserId: owner, partitionStatus: "confirmed", partitionRevision: "rev", expectedFieldCount: fields.length }
  fields.forEach(f => { f.properties = { ...f.properties, ownerUserId: owner, status: "confirmed", farmerConfirmed: true,
    details: { name: f.properties.name, area_ha: 1, latitude: 0, longitude: 0, soil_texture: "loam", profile_id: "demo", irrigation_available: false, history: [] } } })
  return { farms: [farm], fields }
}
function reply(request: FarmSyncInput): FarmSyncResult {
  const at = "2026-11-14T00:00:00Z"
  return { farm: { ...request.farm, id: "server-farm", version: 1, resource_group_id: "server-farm", created_at: at, updated_at: at }, complete: true,
    items: request.fields.map((f,i) => ({ local_id: f.local_id, status: "synced", error: null,
      field: { ...f.field, id: `server-${i}`, version: 1, created_at: at, updated_at: at } })) }
}
beforeEach(() => {
  vi.resetAllMocks(); boundary.get.mockResolvedValue(fixture()); boundary.put.mockResolvedValue(undefined); boundary.restore.mockResolvedValue([])
  boundary.sync.mockImplementation(async (r: FarmSyncInput) => reply(r))
})
describe("owned workspace lifecycle", () => {
  it("durably records an attempt before posting, and retries the same request after a lost reply", async () => {
    const store = new OwnedWorkspace("a"); await store.start()
    const initial = store.getSnapshot().workspace!; const farmId = initial.farms[0].properties.id
    const saved = deferred<void>(); boundary.put.mockReturnValueOnce(saved.promise)
    boundary.sync.mockRejectedValueOnce(new Error("connection lost"))
    const attempt = store.synchronize(farmId)
    await Promise.resolve(); expect(boundary.sync).not.toHaveBeenCalled()
    saved.resolve(); await expect(attempt).rejects.toThrow("connection lost")
    const request = boundary.sync.mock.calls[0][0]
    expect(store.getSnapshot().workspace!.farms[0].properties.pendingSync).toEqual(request)
    // A later form edit must not alter the uncertain request's payload/key.
    store.update(w => ({ ...w, fields: w.fields.map((f,i) => i ? f : { ...f, properties: { ...f.properties, details: { ...f.properties.details!, name: "New input" } } }) }))
    await store.synchronize(farmId)
    expect(boundary.sync.mock.calls[1][0]).toEqual(request)
    expect(store.getSnapshot().workspace!.fields[0].properties.details!.name).toBe("New input")
    expect(store.getSnapshot().workspace!.fields[0].properties.syncStatus).toBe("needs-details")
    expect(store.getSnapshot().workspace!.fields[1].properties.syncStatus).toBe("synced")
    store.dispose()
  })
  it("keeps writes in their captured owner scope and ignores a reply after account unmount", async () => {
    const a = new OwnedWorkspace("a"); await a.start()
    const response = deferred<FarmSyncResult>(); boundary.sync.mockReturnValueOnce(response.promise)
    const pending = a.synchronize(a.getSnapshot().workspace!.farms[0].properties.id)
    await vi.waitFor(() => expect(boundary.sync).toHaveBeenCalledOnce())
    a.dispose(); boundary.get.mockResolvedValueOnce(fixture("b"))
    const b = new OwnedWorkspace("b"); await b.start()
    const before = b.getSnapshot().workspace
    const writesBefore = boundary.put.mock.calls.length
    response.resolve(reply(boundary.sync.mock.calls[0][0])); await pending
    expect(b.getSnapshot().workspace).toBe(before)
    expect(boundary.put.mock.calls.slice(writesBefore).filter(call => call[2] === "b")).toHaveLength(0)
    expect(a.getSnapshot().workspace!.farms[0].properties.pendingSync).toBeDefined()
    b.dispose()
  })
  it("prevents duplicate concurrent sends and keeps partial failure visible", async () => {
    const store = new OwnedWorkspace("a"); await store.start()
    const remote = deferred<FarmSyncResult>(); boundary.sync.mockReturnValueOnce(remote.promise)
    const farmId = store.getSnapshot().workspace!.farms[0].properties.id
    const pending = store.synchronize(farmId)
    await expect(store.synchronize(farmId)).rejects.toThrow(/正在同步/)
    await vi.waitFor(() => expect(boundary.sync).toHaveBeenCalledOnce())
    const response = reply(boundary.sync.mock.calls[0][0]); response.complete = false
    response.items[1] = { ...response.items[1], status: "conflict", field: null, error: "Newer version" }
    remote.resolve(response); await pending
    const fields = store.getSnapshot().workspace!.fields
    expect(fields[0].properties.syncStatus).toBe("synced")
    expect(fields[1].properties.syncStatus).toBe("conflict")
    expect(store.getSnapshot().workspace!.farms[0].properties.pendingSync).toBeUndefined()
    store.dispose()
  })
  it("does not silently replace an unreadable local workspace with an empty one", async () => {
    boundary.get.mockRejectedValueOnce(new Error("storage unavailable"))
    const store = new OwnedWorkspace("a"); await store.start()
    expect(store.getSnapshot().workspace).toBeNull()
    expect(store.getSnapshot().error).toContain("storage unavailable")
    expect(boundary.put).not.toHaveBeenCalled()
    expect(boundary.restore).not.toHaveBeenCalled()
    store.dispose()
  })
})
it("resolves a reviewed farm conflict by keeping the local partition as a separate draft", async () => {
  const store = new OwnedWorkspace("a"); await store.start()
  const initial = store.getSnapshot().workspace!
  const request = (await import("./farm-sync")).buildFarmSync(initial.farms[0], initial.fields, "attempt-one", "a")
  const response = reply(request)
  await store.adoptServerFarm({ ...response.farm, version: 3, name: "Remote reviewed farm", fields: response.items.map(i => i.field!) })
  const next = store.getSnapshot().workspace!
  expect(next.farms).toHaveLength(2)
  const remote = next.farms.find(f => f.properties.backendFarmId === response.farm.id)!
  const copy = next.farms.find(f => f !== remote)!
  expect(remote.properties.backendVersion).toBe(3)
  expect(copy.properties.name).toContain("本机保留副本")
  expect(copy.properties.backendFarmId).toBeUndefined()
  expect(copy.properties.pendingSync).toBeUndefined()
  expect(next.fields.filter(f => f.properties.farmId === copy.properties.id)).toHaveLength(4)
  expect(next.fields.filter(f => f.properties.farmId === copy.properties.id).every(f => !f.properties.backendFieldId)).toBe(true)
  store.dispose()
})
