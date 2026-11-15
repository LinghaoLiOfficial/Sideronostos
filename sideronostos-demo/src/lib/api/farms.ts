import type { Polygon } from "geojson"
import { apiRequest } from "./client"
import type { Field, FieldInput } from "./field-shift-types"

export type PartitionMetadata = {
  method: "equal-area-strips" | "regular-grid"
  orientation: "farm-axis" | "cardinal"
  requested_count: number
  generated_count: number
  grid_rows: number | null
  grid_columns: number | null
  boundary_source: "drawn" | "imported" | "synthetic"
}
export type FarmHeaderInput = {
  local_id: string; name: string; geometry: Polygon; partition_revision: string
  expected_version?: number; partition?: PartitionMetadata
}
export type FarmSyncInput = {
  idempotency_key: string; farm: FarmHeaderInput
  fields: { local_id: string; expected_version?: number; field: FieldInput }[]
}
export type ServerFarmHeader = Omit<FarmHeaderInput, "expected_version"> & {
  id: string; version: number; resource_group_id: string; created_at: string; updated_at: string
}
export type ServerFarm = ServerFarmHeader & { fields: Field[] }
export type FarmSyncResult = {
  farm: ServerFarmHeader; complete: boolean
  items: { local_id: string; status: "synced" | "invalid" | "conflict"; field: Field | null; error: string | null }[]
}
const ownerHeaders = (ownerId?: string) => ownerId ? { "X-Workspace-Owner": ownerId } : undefined
export const listFarms = (signal?: AbortSignal, ownerId?: string) => apiRequest<{ items: ServerFarmHeader[] }>("/field-shift/farms", { signal, headers: ownerHeaders(ownerId) })
export const getFarm = (id: string, signal?: AbortSignal, ownerId?: string) => apiRequest<ServerFarm>(`/field-shift/farms/${encodeURIComponent(id)}`, { signal, headers: ownerHeaders(ownerId) })
export const syncFarm = (body: FarmSyncInput, signal?: AbortSignal, ownerId?: string) => apiRequest<FarmSyncResult>("/field-shift/farms/sync", { method: "POST", body, signal, headers: ownerHeaders(ownerId) })
export async function restoreFarms(signal?: AbortSignal, ownerId?: string) {
  const headers = await listFarms(signal, ownerId)
  return Promise.all(headers.items.map(farm => getFarm(farm.id, signal, ownerId)))
}
