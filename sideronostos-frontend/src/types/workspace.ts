import type { Feature, Polygon } from "geojson"

export type FarmBoundarySource = "drawn" | "imported" | "synthetic"
export type FieldBoundarySource = "generated" | "edited"
export type PartitionMethod = "equal-area-strips" | "regular-grid"
export type PartitionOrientation = "farm-axis" | "cardinal"
export type EvidenceKind = "observed" | "precomputed" | "synthetic"
export type SpatialSupport = "field" | "regional-background"

export interface FarmProperties {
  ownerUserId?: string | null
  backendFarmId?: string
  backendVersion?: number
  partitionRevision?: string
  id: string
  name: string
  boundarySource: FarmBoundarySource
  partitionCount: number
  partitionMethod: PartitionMethod
  partitionOrientation: PartitionOrientation
  partitionGridRows: number | null
  partitionGridColumns: number | null
  partitionStatus: "draft" | "confirmed"
  createdAt: string
  updatedAt: string
}

export type FarmFeature = Feature<Polygon, FarmProperties>

export interface FieldProperties {
  ownerUserId?: string | null
  backendFieldId?: string
  backendVersion?: number
  syncStatus?: "needs-details" | "pending" | "synced" | "conflict" | "error"
  syncError?: string | null
  details?: import("@/lib/api/field-shift-types").FieldInput
  id: string
  farmId: string
  name: string
  status: "candidate" | "confirmed"
  partitionIndex: number
  boundarySource: FieldBoundarySource
  farmerConfirmed: boolean
  createdAt: string
  updatedAt: string
}

export type FieldFeature = Feature<Polygon, FieldProperties>

export interface FieldObservation {
  id: string
  fieldId: string
  metric: string
  value: number
  unit: string
  observedAt: string
  sourceProduct: string
  evidenceKind: EvidenceKind
  spatialSupport: SpatialSupport
  nativeResolutionMeters: number | null
  uncertainty: string | null
}

export interface GibsLayerConfig {
  id: string
  title: string
  description: string
  layerId: string
  format: "png" | "jpg"
  tileMatrixSet: string
  minDate: string | null
  maxDate: string | "today" | null
  defaultDate: string | null
  maxNativeZoom: number
  nativeResolutionLabel: string
  unit: string | null
  legendUrl: string | null
  attribution: string
}

export interface LayerState {
  visible: boolean
  opacity: number
}

export interface WorkspaceSettings {
  version: 1
  longitude: number
  latitude: number
  zoom: number
  basemap: "satellite" | "streets"
  date: string
  layers: Record<string, LayerState>
}
