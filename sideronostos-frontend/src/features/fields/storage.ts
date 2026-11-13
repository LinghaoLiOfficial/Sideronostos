import { openDB, type DBSchema } from "idb"

import type { FarmFeature, FieldFeature, FieldObservation } from "@/types/workspace"

type Workspace = { farms: FarmFeature[]; fields: FieldFeature[] }
type LocalSource = "legacy" | "anonymous"

function scopeKey(ownerId: string | null) {
  if (ownerId !== null && !ownerId.trim()) throw new Error("Workspace owner is empty")
  return ownerId === null ? "anonymous" : `user:${ownerId}`
}

function normalizeFarm(farm: FarmFeature): FarmFeature {
  const regularGrid = farm.properties.partitionMethod === "regular-grid"
  return {
    ...farm,
    properties: {
      ...farm.properties,
      partitionMethod: regularGrid ? "regular-grid" : "equal-area-strips",
      partitionOrientation: farm.properties.partitionOrientation === "cardinal" ? "cardinal" : "farm-axis",
      partitionGridRows: regularGrid && Number.isInteger(farm.properties.partitionGridRows)
        ? farm.properties.partitionGridRows : null,
      partitionGridColumns: regularGrid && Number.isInteger(farm.properties.partitionGridColumns)
        ? farm.properties.partitionGridColumns : null,
    },
  }
}

interface WorkspaceDb extends DBSchema {
  // Legacy stores are read-only archives. Even unrecognized prototype records stay intact.
  farms: { key: IDBValidKey; value: unknown }
  fields: { key: IDBValidKey; value: unknown }
  observations: { key: IDBValidKey; value: unknown }
  workspaces: { key: string; value: Workspace & { scope: string } }
  scopedObservations: {
    key: [string, string]
    value: { scope: string; id: string; fieldId: string; observation: FieldObservation }
    indexes: { "by-owner-field": [string, string] }
  }
  imports: {
    key: [string, LocalSource, string]
    value: { scope: string; source: LocalSource; originalFarmId: string; targetFarmId: string }
  }
}

const database = openDB<WorkspaceDb>("field-shift-workspace", 3, {
  upgrade(db) {
    // Do not delete/recreate v1/v2 stores, including those with unknown key paths.
    if (!db.objectStoreNames.contains("workspaces")) {
      db.createObjectStore("workspaces", { keyPath: "scope" })
    }
    if (!db.objectStoreNames.contains("scopedObservations")) {
      const observations = db.createObjectStore("scopedObservations", { keyPath: ["scope", "id"] })
      observations.createIndex("by-owner-field", ["scope", "fieldId"])
    }
    if (!db.objectStoreNames.contains("imports")) {
      db.createObjectStore("imports", { keyPath: ["scope", "source", "originalFarmId"] })
    }
  },
  blocking() { void database.then(db => db.close()) },
})

export async function getStoredWorkspace(ownerId: string | null = null): Promise<Workspace> {
  const stored = await (await database).get("workspaces", scopeKey(ownerId))
  return { farms: (stored?.farms ?? []).map(normalizeFarm), fields: stored?.fields ?? [] }
}

export async function replaceStoredWorkspace(
  farms: FarmFeature[], fields: FieldFeature[], ownerId: string | null = null,
) {
  const scope = scopeKey(ownerId)
  for (const feature of [...farms, ...fields]) {
    if (feature.properties.ownerUserId !== undefined && feature.properties.ownerUserId !== ownerId) {
      throw new Error("Workspace owner mismatch; copy local drafts explicitly")
    }
  }
  await (await database).put("workspaces", {
    scope,
    farms: farms.map(farm => normalizeFarm({ ...farm, properties: { ...farm.properties, ownerUserId: ownerId } })),
    fields: fields.map(field => ({ ...field, properties: { ...field.properties, ownerUserId: ownerId } })),
  })
}

function feature(value: unknown): value is FarmFeature | FieldFeature {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<FarmFeature>
  return item.type === "Feature" && item.geometry?.type === "Polygon"
    && Array.isArray(item.geometry.coordinates) && typeof item.properties?.id === "string"
    && typeof item.properties?.name === "string"
}

export async function getLegacyWorkspace() {
  const db = await database
  const [farms, fields, observations]: [unknown[], unknown[], unknown[]] = await Promise.all([
    db.objectStoreNames.contains("farms") ? db.getAll("farms") : [],
    db.objectStoreNames.contains("fields") ? db.getAll("fields") : [],
    db.objectStoreNames.contains("observations") ? db.getAll("observations") : [],
  ])
  const recognizedFarms = farms.filter((item): item is FarmFeature =>
    feature(item) && "partitionCount" in item.properties).map(normalizeFarm)
  const recognizedFields = fields.filter((item): item is FieldFeature =>
    feature(item) && "farmId" in item.properties)
  return {
    farms: recognizedFarms, fields: recognizedFields,
    unrecognizedCount: farms.length + fields.length - recognizedFarms.length - recognizedFields.length,
    raw: { farms, fields, observations },
  }
}

/** Explicit, atomic copy. Repeating it never overwrites an already-imported farm. */
export async function importLocalWorkspace(ownerId: string, source: LocalSource): Promise<Workspace> {
  const scope = scopeKey(ownerId)
  const local = source === "legacy" ? await getLegacyWorkspace() : await getStoredWorkspace()
  const db = await database
  const transaction = db.transaction(["workspaces", "imports"], "readwrite")
  const current = await transaction.objectStore("workspaces").get(scope) ?? { scope, farms: [], fields: [] }
  for (const farm of local.farms) {
    const key: [string, LocalSource, string] = [scope, source, farm.properties.id]
    if (await transaction.objectStore("imports").get(key)) continue
    const farmId = crypto.randomUUID()
    current.farms.push({
      ...farm, id: farmId,
      properties: { ...farm.properties, id: farmId, ownerUserId: ownerId,
        backendFarmId: undefined, backendVersion: undefined, partitionRevision: crypto.randomUUID() },
    })
    for (const field of local.fields.filter(item => item.properties.farmId === farm.properties.id)) {
      const fieldId = crypto.randomUUID()
      current.fields.push({
        ...field, id: fieldId,
        properties: { ...field.properties, id: fieldId, farmId, ownerUserId: ownerId,
          backendFieldId: undefined, backendVersion: undefined, syncStatus: "needs-details", syncError: null },
      })
    }
    await transaction.objectStore("imports").put({ scope, source, originalFarmId: farm.properties.id, targetFarmId: farmId })
  }
  await transaction.objectStore("workspaces").put(current)
  await transaction.done
  return { farms: current.farms, fields: current.fields }
}

export async function getFieldObservations(fieldId: string, ownerId: string | null = null) {
  const rows = await (await database).getAllFromIndex("scopedObservations", "by-owner-field", [scopeKey(ownerId), fieldId])
  return rows.map(row => row.observation)
}

export async function putObservations(observations: FieldObservation[], ownerId: string | null = null) {
  const scope = scopeKey(ownerId)
  const transaction = (await database).transaction("scopedObservations", "readwrite")
  await Promise.all([
    ...observations.map(observation => transaction.store.put({ scope, id: observation.id, fieldId: observation.fieldId, observation })),
    transaction.done,
  ])
}
