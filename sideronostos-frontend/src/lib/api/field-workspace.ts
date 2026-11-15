import { apiRequest } from "./client"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

export interface FieldWorkspace {
  version: number
  farms: FarmFeature[]
  fields: FieldFeature[]
  initialized_from: string | null
  created_at: string
  updated_at: string
}

export const getFieldWorkspace = () =>
  apiRequest<FieldWorkspace>("/field-shift/workspace")

export const saveFieldWorkspace = (
  expectedVersion: number,
  farms: FarmFeature[],
  fields: FieldFeature[],
  initializedFrom: string | null,
) => apiRequest<FieldWorkspace>("/field-shift/workspace", {
  method: "PUT",
  body: {
    expected_version: expectedVersion,
    farms: farms.map(({ properties, ...farm }) => ({
      ...farm,
      properties: Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "ownerUserId")),
    })),
    fields: fields.map(({ properties, ...field }) => ({
      ...field,
      properties: Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "ownerUserId")),
    })),
    initialized_from: initializedFrom,
  },
})

export const restoreFieldWorkspaceSample = () =>
  apiRequest<FieldWorkspace>("/field-shift/workspace/sample", { method: "POST" })
