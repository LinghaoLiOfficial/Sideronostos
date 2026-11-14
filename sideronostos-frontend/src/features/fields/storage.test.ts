import { describe, expect, it, vi } from "vitest"

import { createDemoFarm } from "@/features/fields/demo-data"

function deleteWorkspaceDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("field-shift-workspace")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

describe("owner-scoped workspace storage", () => {
  it("preserves the v1 prototype stores without exposing them as owned data", async () => {
    await deleteWorkspaceDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("field-shift-workspace", 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore("fields")
        request.result.createObjectStore("observations")
      }
      request.onsuccess = () => {
        const transaction = request.result.transaction("fields", "readwrite")
        transaction.objectStore("fields").put({ legacy: true }, "legacy-field")
        transaction.oncomplete = () => { request.result.close(); resolve() }
      }
      request.onerror = () => reject(request.error)
    })
    vi.resetModules()
    const storage = await import("@/features/fields/storage")
    const workspace = await storage.getStoredWorkspace()
    expect(workspace).toEqual({ farms: [], fields: [] })
    const legacy = await storage.getLegacyWorkspace()
    expect(legacy.raw.fields).toContainEqual({ legacy: true })
    expect(legacy.unrecognizedCount).toBe(1)
  })

  it("persists farms and their candidate fields", async () => {
    const storage = await import("@/features/fields/storage")
    const { farm, fields } = createDemoFarm()
    await storage.replaceStoredWorkspace([farm], fields)
    const workspace = await storage.getStoredWorkspace()
    expect(workspace.farms).toHaveLength(1)
    expect(workspace.fields).toHaveLength(4)
    expect(workspace.fields.every((field) => field.properties.farmId === farm.properties.id)).toBe(true)
  })

  it("deletes a farm, its fields, and field observations in one operation", async () => {
    const storage = await import("@/features/fields/storage")
    const first = createDemoFarm()
    const second = createDemoFarm(2)
    const observation = {
      id: "observation-1",
      fieldId: first.fields[0].properties.id,
      metric: "Soil moisture",
      value: 0.2,
      unit: "m³/m³",
      observedAt: "2026-11-06",
      sourceProduct: "SMAP",
      evidenceKind: "synthetic" as const,
      spatialSupport: "regional-background" as const,
      nativeResolutionMeters: 36000,
      uncertainty: null,
    }
    const preservedObservation = { ...observation, id: "observation-2", fieldId: second.fields[0].properties.id }
    await storage.replaceStoredWorkspace([first.farm, second.farm], [...first.fields, ...second.fields])
    await storage.putObservations([observation, preservedObservation])

    await expect(storage.deleteStoredFarm(first.farm.properties.id)).resolves.toEqual({ fieldCount: 4 })
    const workspace = await storage.getStoredWorkspace()
    expect(workspace.farms.map((farm) => farm.properties.id)).toEqual([second.farm.properties.id])
    expect(workspace.fields.map((field) => field.properties.id).sort()).toEqual(second.fields.map((field) => field.properties.id).sort())
    await expect(storage.getFieldObservations(first.fields[0].properties.id)).resolves.toEqual([])
    await expect(storage.getFieldObservations(second.fields[0].properties.id)).resolves.toEqual([preservedObservation])
  })

  it("deletes a farm that has no associated fields", async () => {
    const storage = await import("@/features/fields/storage")
    const { farm } = createDemoFarm()
    await storage.replaceStoredWorkspace([farm], [])

    await expect(storage.deleteStoredFarm(farm.properties.id)).resolves.toEqual({ fieldCount: 0 })
    await expect(storage.getStoredWorkspace()).resolves.toEqual({ farms: [], fields: [] })
  })

  it("keeps the workspace intact when the delete transaction fails", async () => {
    const storage = await import("@/features/fields/storage")
    const { farm, fields } = createDemoFarm()
    await storage.replaceStoredWorkspace([farm], fields)
    const deleteSpy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementationOnce(() => {
      throw new Error("simulated IndexedDB failure")
    })

    await expect(storage.deleteStoredFarm(farm.properties.id)).rejects.toThrow("simulated IndexedDB failure")
    deleteSpy.mockRestore()
    const workspace = await storage.getStoredWorkspace()
    expect(workspace.farms.map((storedFarm) => storedFarm.properties.id)).toEqual([farm.properties.id])
    expect(workspace.fields.map((field) => field.properties.id).sort()).toEqual(fields.map((field) => field.properties.id).sort())
  })

  it("defaults legacy v2 farms to equal-area strips", async () => {
    const storage = await import("@/features/fields/storage")
    const { farm, fields } = createDemoFarm()
    const legacyFarm = structuredClone(farm)
    const legacyProperties = legacyFarm.properties as unknown as Record<string, unknown>
    delete legacyProperties.partitionMethod
    delete legacyProperties.partitionOrientation
    delete legacyProperties.partitionGridRows
    delete legacyProperties.partitionGridColumns
    await storage.replaceStoredWorkspace([legacyFarm as typeof farm], fields)
    const workspace = await storage.getStoredWorkspace()
    expect(workspace.farms[0].properties.partitionMethod).toBe("equal-area-strips")
    expect(workspace.farms[0].properties.partitionOrientation).toBe("farm-axis")
    expect(workspace.farms[0].properties.partitionGridRows).toBeNull()
    expect(workspace.farms[0].properties.partitionGridColumns).toBeNull()
  })

  it("persists regular-grid method and layout", async () => {
    const storage = await import("@/features/fields/storage")
    const { farm, fields } = createDemoFarm()
    farm.properties.partitionMethod = "regular-grid"
    farm.properties.partitionOrientation = "cardinal"
    farm.properties.partitionGridRows = 2
    farm.properties.partitionGridColumns = 3
    await storage.replaceStoredWorkspace([farm], fields)
    const workspace = await storage.getStoredWorkspace()
    expect(workspace.farms[0].properties).toMatchObject({
      partitionMethod: "regular-grid",
      partitionOrientation: "cardinal",
      partitionGridRows: 2,
      partitionGridColumns: 3,
    })
  })
})


it("keeps two owners and anonymous drafts isolated even with identical local IDs", async () => {
  const storage = await import("@/features/fields/storage")
  const { farm, fields } = createDemoFarm()
  await storage.replaceStoredWorkspace([farm], fields, "owner-a")
  await storage.replaceStoredWorkspace([{ ...farm, properties: { ...farm.properties, name: "B farm" } }], fields, "owner-b")
  expect((await storage.getStoredWorkspace("owner-a")).farms[0].properties.name).toBe(farm.properties.name)
  expect((await storage.getStoredWorkspace("owner-b")).farms[0].properties.name).toBe("B farm")
  expect((await storage.getStoredWorkspace("never-used-owner")).farms).toEqual([])
  // A delayed A write always targets its captured A scope, never current B.
  await storage.replaceStoredWorkspace([], [], "owner-a")
  expect((await storage.getStoredWorkspace("owner-b")).fields).toHaveLength(4)
})

it("requires an explicit copy to attach anonymous drafts to an account and does not overwrite later edits", async () => {
  const storage = await import("@/features/fields/storage")
  const { farm, fields } = createDemoFarm()
  await storage.replaceStoredWorkspace([farm], fields)
  expect((await storage.getStoredWorkspace("import-owner")).farms).toEqual([])
  const copied = await storage.importLocalWorkspace("import-owner", "anonymous")
  expect(copied.farms).toHaveLength(1)
  expect(copied.fields).toHaveLength(4)
  expect(copied.farms[0].properties.id).not.toBe(farm.properties.id)
  expect(copied.fields.every(f => f.properties.farmId === copied.farms[0].properties.id)).toBe(true)
  copied.farms[0].properties.name = "Reviewed account farm"
  await storage.replaceStoredWorkspace(copied.farms, copied.fields, "import-owner")
  const again = await storage.importLocalWorkspace("import-owner", "anonymous")
  expect(again.farms).toHaveLength(1)
  expect(again.farms[0].properties.name).toBe("Reviewed account farm")
  expect((await storage.getStoredWorkspace()).farms[0].properties.name).toBe(farm.properties.name)
})

it("rejects accidentally writing one owner's loaded records into another owner's scope", async () => {
  const storage = await import("@/features/fields/storage")
  const { farm, fields } = createDemoFarm()
  await storage.replaceStoredWorkspace([farm], fields, "guard-a")
  const loaded = await storage.getStoredWorkspace("guard-a")
  await expect(storage.replaceStoredWorkspace(loaded.farms, loaded.fields, "guard-b")).rejects.toThrow(/owner/i)
  expect((await storage.getStoredWorkspace("guard-b")).farms).toEqual([])
})

it("isolates observations by account even when local field IDs coincide", async () => {
  const storage = await import("@/features/fields/storage")
  const observation = { id: "same-observation", fieldId: "same-field", metric: "test", value: 3,
    unit: "test", observedAt: "2026-01-01", sourceProduct: "test fixture",
    evidenceKind: "synthetic" as const, spatialSupport: "field" as const,
    nativeResolutionMeters: null, uncertainty: null }
  await storage.putObservations([observation], "obs-a")
  await storage.putObservations([{ ...observation, value: 9 }], "obs-b")
  expect((await storage.getFieldObservations("same-field", "obs-a"))[0].value).toBe(3)
  expect((await storage.getFieldObservations("same-field", "obs-b"))[0].value).toBe(9)
  expect(await storage.getFieldObservations("same-field")).toEqual([])
})

it("does not copy an old synchronization receipt into a newly owned local import", async () => {
  const storage = await import("./storage")
  const { farm, fields } = createDemoFarm()
  farm.properties.pendingSync = { idempotency_key: "old-attempt", farm: { local_id: farm.properties.id, name: farm.properties.name, geometry: farm.geometry, partition_revision: "old" }, fields: [] }
  farm.properties.syncError = "old failure"
  await storage.replaceStoredWorkspace([farm], fields)
  const copied = await storage.importLocalWorkspace("receipt-import-owner", "anonymous")
  expect(copied.farms[0].properties.pendingSync).toBeUndefined()
  expect(copied.farms[0].properties.syncError).toBeNull()
})
