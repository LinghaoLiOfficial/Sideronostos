import { openDB, type DBSchema } from "idb"

import type { FarmFeature, FieldFeature, FieldObservation } from "@/types/workspace"

function normalizeFarm(farm: FarmFeature): FarmFeature {
  const regularGrid = farm.properties.partitionMethod === "regular-grid"
  return {
    ...farm,
    properties: {
      ...farm.properties,
      partitionMethod: regularGrid ? "regular-grid" : "equal-area-strips",
      partitionOrientation: farm.properties.partitionOrientation === "cardinal" ? "cardinal" : "farm-axis",
      partitionGridRows: regularGrid && Number.isInteger(farm.properties.partitionGridRows)
        ? farm.properties.partitionGridRows
        : null,
      partitionGridColumns: regularGrid && Number.isInteger(farm.properties.partitionGridColumns)
        ? farm.properties.partitionGridColumns
        : null,
    },
  }
}

interface WorkspaceDb extends DBSchema {
  farms: {
    key: string
    value: FarmFeature
  }
  fields: {
    key: string
    value: FieldFeature
    indexes: { "by-farm": string }
  }
  observations: {
    key: string
    value: FieldObservation
    indexes: { "by-field": string }
  }
}

const database = openDB<WorkspaceDb>("field-shift-workspace", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 2) {
      for (const storeName of ["farms", "fields", "observations"] as const) {
        if (db.objectStoreNames.contains(storeName)) db.deleteObjectStore(storeName)
      }
    }
    if (!db.objectStoreNames.contains("farms")) db.createObjectStore("farms", { keyPath: "properties.id" })
    if (!db.objectStoreNames.contains("fields")) {
      const fields = db.createObjectStore("fields", { keyPath: "properties.id" })
      fields.createIndex("by-farm", "properties.farmId")
    }
    if (!db.objectStoreNames.contains("observations")) {
      const observations = db.createObjectStore("observations", { keyPath: "id" })
      observations.createIndex("by-field", "fieldId")
    }
  },
})

export async function getStoredWorkspace() {
  const db = await database
  return { farms: (await db.getAll("farms")).map(normalizeFarm), fields: await db.getAll("fields") }
}

export async function replaceStoredWorkspace(farms: FarmFeature[], fields: FieldFeature[]) {
  const db = await database
  const transaction = db.transaction(["farms", "fields"], "readwrite")
  await transaction.objectStore("farms").clear()
  await transaction.objectStore("fields").clear()
  for (const farm of farms) await transaction.objectStore("farms").put(farm)
  for (const field of fields) await transaction.objectStore("fields").put(field)
  await transaction.done
}

export async function getFieldObservations(fieldId: string) {
  return (await database).getAllFromIndex("observations", "by-field", fieldId)
}

export async function putObservations(observations: FieldObservation[]) {
  const db = await database
  const transaction = db.transaction("observations", "readwrite")
  await Promise.all([...observations.map((item) => transaction.store.put(item)), transaction.done])
}
