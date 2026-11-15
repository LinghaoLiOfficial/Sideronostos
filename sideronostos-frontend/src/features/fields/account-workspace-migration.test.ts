import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createDemoFarm } from "@/features/fields/demo-data"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

const remote = vi.hoisted(() => ({
  value: { version: 1, farms: [] as FarmFeature[], fields: [] as FieldFeature[], initialized_from: null as string | null,
    created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" },
  saves: [] as Array<{ farms: FarmFeature[]; fields: FieldFeature[] }>, failNextSave: false,
}))

vi.mock("@/lib/api/field-workspace", () => ({
  getFieldWorkspace: vi.fn(async () => structuredClone(remote.value)),
  restoreFieldWorkspaceSample: vi.fn(),
  saveFieldWorkspace: vi.fn(async (_version: number, farms: FarmFeature[], fields: FieldFeature[]) => {
    remote.saves.push({ farms: structuredClone(farms), fields: structuredClone(fields) })
    if (remote.failNextSave) { remote.failNextSave = false; throw new Error("offline") }
    remote.value = { ...remote.value, version: remote.value.version + 1, farms: structuredClone(farms), fields: structuredClone(fields) }
    return structuredClone(remote.value)
  }),
}))

vi.mock("@/lib/api/farms", () => ({ restoreFarms: vi.fn(async () => []), syncFarm: vi.fn() }))

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("field-shift-workspace")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function seedLegacyFarm() {
  const { farm, fields } = createDemoFarm()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("field-shift-workspace", 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("farms")
      request.result.createObjectStore("fields")
      request.result.createObjectStore("observations")
    }
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(["farms", "fields"], "readwrite")
      transaction.objectStore("farms").put(farm, farm.properties.id)
      fields.forEach(field => transaction.objectStore("fields").put(field, field.properties.id))
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
    request.onerror = () => reject(request.error)
  })
}

describe("account workspace legacy migration", () => {
  beforeEach(async () => {
    await deleteDatabase()
    vi.resetModules()
    remote.value = { version: 1, farms: [], fields: [], initialized_from: null,
      created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" }
    remote.saves = []
    remote.failNextSave = false
  })
  afterEach(() => vi.clearAllMocks())

  it("keeps legacy data after save failure and retries without duplicating the imported farm", async () => {
    await seedLegacyFarm()
    const { OwnedWorkspace } = await import("./owned-workspace")
    const { getLegacyWorkspace } = await import("./storage")
    const store = new OwnedWorkspace("migration-owner", true)
    await store.start()
    const savesBeforeMigration = remote.saves.length
    remote.failNextSave = true

    await expect(store.migrateLegacyAndClear()).rejects.toThrow("offline")
    expect((await getLegacyWorkspace()).farms).toHaveLength(1)
    expect(remote.saves).toHaveLength(savesBeforeMigration + 1)

    await store.migrateLegacyAndClear()
    expect((await getLegacyWorkspace()).farms).toHaveLength(0)
    expect(remote.saves).toHaveLength(savesBeforeMigration + 2)
    expect(remote.saves[savesBeforeMigration].farms.map(farm => farm.properties.id))
      .toEqual(remote.saves[savesBeforeMigration + 1].farms.map(farm => farm.properties.id))
    expect(remote.value.farms).toHaveLength(1)
    expect(remote.value.fields).toHaveLength(4)
    store.dispose()
  })
})
