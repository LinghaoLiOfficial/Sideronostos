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
