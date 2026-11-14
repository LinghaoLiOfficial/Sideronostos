import type { FarmFeature, FieldFeature } from "@/types/workspace"

/** Explicit copies get new identities; no server links or uncertain request receipts follow them. */
export function copyLocalFarm(farm: FarmFeature, fields: FieldFeature[], ownerId: string) {
  const farmId = crypto.randomUUID(), now = new Date().toISOString()
  return {
    farm: { ...farm, id: farmId, properties: { ...farm.properties, id: farmId, ownerUserId: ownerId,
      backendFarmId: undefined, backendVersion: undefined, pendingSync: undefined, syncError: null,
      partitionRevision: crypto.randomUUID(), createdAt: now, updatedAt: now } } as FarmFeature,
    fields: fields.filter(f => f.properties.farmId === farm.properties.id).map(field => {
      const id = crypto.randomUUID()
      return { ...field, id, properties: { ...field.properties, id, farmId, ownerUserId: ownerId,
        backendFieldId: undefined, backendVersion: undefined, syncStatus: "needs-details" as const, syncError: null,
        createdAt: now, updatedAt: now } }
    }),
  }
}
