import type { Polygon } from "geojson"
import type { FarmSyncInput, FarmSyncResult, ServerFarm } from "@/lib/api/farms"
import type { Field, FieldInput } from "@/lib/api/field-shift-types"
import type { FarmFeature, FieldFeature } from "@/types/workspace"
import { createFarmFeature, createFieldFeature, featureAreaHectares, validatePolygon } from "./geometry"

type Workspace = { farms: FarmFeature[]; fields: FieldFeature[] }

export function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableValue(v)}`).join(",")}}`
  return JSON.stringify(value) ?? "null"
}

/** Interior point via even/odd scanlines across exterior and holes (not a centroid). */
export function pointInsidePolygon(geometry: Polygon): [number, number] {
  const heights = [...new Set(geometry.coordinates.flat().map(p => p[1]))].sort((a, b) => a - b)
  let result: [number, number] | undefined
  let width = 0
  for (let row = 1; row < heights.length; row++) {
    const y = (heights[row - 1] + heights[row]) / 2
    const intersections: number[] = []
    for (const ring of geometry.coordinates) for (let i = 1; i < ring.length; i++) {
      const [a, b] = [ring[i - 1], ring[i]]
      if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
    }
    intersections.sort((a, b) => a - b)
    for (let i = 1; i < intersections.length; i += 2) {
      const span = intersections[i] - intersections[i - 1]
      if (span > width) { width = span; result = [(intersections[i] + intersections[i - 1]) / 2, y] }
    }
  }
  if (!result) throw new Error("Boundary has no valid interior point")
  return result
}

export function inputFromField(field: Field): FieldInput {
  return { name: field.name, area_ha: field.area_ha, latitude: field.latitude, longitude: field.longitude,
    soil_texture: field.soil_texture, irrigation_available: field.irrigation_available,
    profile_id: field.profile_id, history: field.history, history_events: field.history_events ?? [],
    geometry: field.geometry }
}

export function managedInput(field: FieldFeature, details: FieldInput): FieldInput {
  const valid = validatePolygon(field)
  if (!valid.valid) throw new Error(valid.errors[0])
  const [longitude, latitude] = pointInsidePolygon(field.geometry)
  return { ...details, area_ha: featureAreaHectares(field), longitude, latitude,
    geometry: { type: "Polygon", coordinates: field.geometry.coordinates.map(ring => ring.map(p => [p[0], p[1]] as [number, number])) }, history_events: details.history_events ?? [] }
}

export function buildFarmSync(farm: FarmFeature, fields: FieldFeature[], key: string, ownerId: string): FarmSyncInput {
  if (farm.properties.ownerUserId !== undefined && farm.properties.ownerUserId !== ownerId) throw new Error("Farm owner mismatch")
  if (farm.properties.partitionStatus !== "confirmed") throw new Error("Confirm the complete partition first")
  const own = fields.filter(field => field.properties.farmId === farm.properties.id)
  if (!own.length) throw new Error("Choose at least one field to synchronize")
  return {
    idempotency_key: key,
    farm: { local_id: farm.properties.id, name: farm.properties.name, geometry: farm.geometry,
      partition_revision: farm.properties.partitionRevision ?? farm.properties.updatedAt,
      expected_version: farm.properties.backendVersion,
      partition: { method: farm.properties.partitionMethod, orientation: farm.properties.partitionOrientation,
        requested_count: farm.properties.partitionCount, generated_count: farm.properties.expectedFieldCount ?? own.length,
        grid_rows: farm.properties.partitionGridRows, grid_columns: farm.properties.partitionGridColumns,
        boundary_source: farm.properties.boundarySource } },
    fields: own.map(field => {
      if (field.properties.ownerUserId !== undefined && field.properties.ownerUserId !== ownerId) throw new Error("Field owner mismatch")
      if (field.properties.status !== "confirmed" || !field.properties.farmerConfirmed) throw new Error("Confirm field boundaries first")
      if (!field.properties.details) throw new Error(`Complete the details for ${field.properties.name}`)
      return { local_id: field.properties.id, expected_version: field.properties.backendFieldId ? field.properties.backendVersion : undefined,
        field: managedInput(field, field.properties.details) }
    }),
  }
}

export function applyFarmSync(workspace: Workspace, request: FarmSyncInput, response: FarmSyncResult): Workspace {
  const farm = workspace.farms.find(f => f.properties.id === request.farm.local_id)
  if (!farm || (farm.properties.partitionRevision ?? farm.properties.updatedAt) !== request.farm.partition_revision) return workspace
  if ((farm.properties.backendVersion ?? 0) > response.farm.version) return workspace
  return {
    farms: workspace.farms.map(f => f !== farm ? f : { ...f, properties: { ...f.properties,
      backendFarmId: response.farm.id, backendVersion: response.farm.version,
      partitionRevision: response.farm.partition_revision, pendingSync: undefined } }),
    fields: workspace.fields.map(field => {
      if (field.properties.farmId !== farm.properties.id) return field
      const result = response.items.find(i => i.local_id === field.properties.id)
      const submitted = request.fields.find(i => i.local_id === field.properties.id)
      if (!result || !submitted) return field
      if (!result.field) return { ...field, properties: { ...field.properties,
        syncStatus: result.status === "conflict" ? "conflict" : "error", syncError: result.error } }
      if ((field.properties.backendVersion ?? 0) > result.field.version) return field
      const unchanged = field.properties.details && stableValue(managedInput(field, field.properties.details)) === stableValue(submitted.field)
      return { ...field, properties: { ...field.properties,
        name: unchanged ? result.field.name : field.properties.name,
        backendFieldId: result.field.id, backendVersion: result.field.version,
        syncStatus: unchanged ? "synced" : "needs-details", syncError: null,
        details: unchanged ? inputFromField(result.field) : field.properties.details } }
    }),
  }
}

export function mergeRemoteFarms(workspace: Workspace, remote: ServerFarm[], ownerId: string): Workspace {
  let farms = [...workspace.farms], fields = [...workspace.fields]
  for (const server of remote) {
    const local = farms.find(f => f.properties.backendFarmId === server.id || f.properties.id === server.local_id)
    if (local && local.properties.ownerUserId !== ownerId) throw new Error("Restore owner mismatch")
    if (local?.properties.pendingSync) continue
    const dirty = local && fields.some(f => f.properties.farmId === local.properties.id && f.properties.syncStatus !== "synced")
    if (local && dirty && (local.properties.partitionRevision !== server.partition_revision || (local.properties.backendVersion ?? 0) < server.version)) {
      farms = farms.map(f => f !== local ? f : { ...f, properties: { ...f.properties, syncError: "服务器农场已更新；本地草稿已保留，请先核对。" } })
      continue
    }
    const restored = createFarmFeature(server.geometry, server.partition?.boundary_source ?? "imported", 1, server.local_id)
    restored.properties = { ...restored.properties, ownerUserId: ownerId, name: server.name,
      backendFarmId: server.id, backendVersion: server.version, partitionRevision: server.partition_revision,
      partitionStatus: "confirmed", expectedFieldCount: server.partition?.generated_count ?? server.fields.length,
      partitionCount: server.partition?.requested_count ?? server.fields.length,
      partitionMethod: server.partition?.method ?? "equal-area-strips", partitionOrientation: server.partition?.orientation ?? "farm-axis",
      partitionGridRows: server.partition?.grid_rows ?? null, partitionGridColumns: server.partition?.grid_columns ?? null,
      createdAt: server.created_at, updatedAt: server.updated_at, partitionMetadataKnown: Boolean(server.partition) }
    farms = [...farms.filter(f => f !== local), restored]
    if (local && local.properties.partitionRevision !== server.partition_revision) fields = fields.filter(f => f.properties.farmId !== local.properties.id)
    for (const [index, saved] of server.fields.entries()) {
      if (saved.geometry?.type !== "Polygon") continue
      const old = fields.find(f => f.properties.backendFieldId === saved.id || (f.properties.farmId === restored.properties.id && f.properties.id === saved.local_id))
      if (old && old.properties.syncStatus !== "synced") {
        if (saved.version > (old.properties.backendVersion ?? 0)) fields = fields.map(f => f !== old ? f : { ...f, properties: { ...f.properties,
          syncStatus: "conflict", syncError: "服务器上有更新版本，本地输入已保留。" } })
        continue
      }
      const next = createFieldFeature(saved.geometry as Polygon, restored.properties.id, index + 1, "confirmed", saved.local_id ?? saved.id)
      next.properties = { ...next.properties, ownerUserId: ownerId, backendFieldId: saved.id, backendVersion: saved.version,
        name: saved.name, details: inputFromField(saved), syncStatus: "synced", syncError: null,
        createdAt: saved.created_at, updatedAt: saved.updated_at }
      fields = [...fields.filter(f => f !== old), next]
    }
  }
  return { farms, fields }
}
