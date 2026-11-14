import { describe, expect, it, vi } from "vitest"

import { createDemoFarm } from "@/features/fields/demo-data"

function deleteWorkspaceDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("field-shift-workspace")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

describe("workspace storage v2", () => {
  it("clears the v1 prototype stores during migration", async () => {
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
