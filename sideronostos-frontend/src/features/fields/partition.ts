import * as clipping from "polygon-clipping"
import type { Feature, Polygon, Position } from "geojson"

import { createFieldFeature, validatePolygon } from "@/features/fields/geometry"
import type { FarmFeature, FieldFeature, PartitionMethod, PartitionOrientation } from "@/types/workspace"

const polygonClipping = (
  clipping as unknown as { default: typeof import("polygon-clipping") }
).default

const EARTH_RADIUS = 6_371_008.8
const MIN_AREA_SQUARE_METRES = 1

type Point = [number, number]
type LocalPolygon = clipping.Polygon
type LocalMultiPolygon = clipping.MultiPolygon

interface Projection {
  forward: (point: Position) => Point
  inverse: (point: Point) => Point
}

export interface PartitionResult {
  fields: FieldFeature[]
  requestedCount: number
  actualCount: number
  method: PartitionMethod
  orientation: PartitionOrientation
  gridLayout: { rows: number; columns: number } | null
  hasExtraParts: boolean
}

export interface PartitionValidation {
  valid: boolean
  errors: string[]
  coverageRatio: number
}

function createProjection(farm: FarmFeature): Projection {
  const vertices = farm.geometry.coordinates[0].slice(0, -1)
  const longitude = vertices.reduce((sum, point) => sum + point[0], 0) / vertices.length
  const latitude = vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length
  const latitudeRadians = latitude * Math.PI / 180
  return {
    forward: ([lng, lat]) => [
      EARTH_RADIUS * (lng - longitude) * Math.PI / 180 * Math.cos(latitudeRadians),
      EARTH_RADIUS * (lat - latitude) * Math.PI / 180,
    ],
    inverse: ([x, y]) => [
      longitude + x / (EARTH_RADIUS * Math.cos(latitudeRadians)) * 180 / Math.PI,
      latitude + y / EARTH_RADIUS * 180 / Math.PI,
    ],
  }
}

function signedRingArea(ring: Point[]) {
  let result = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    result += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return result / 2
}

function polygonArea(polygon: LocalPolygon) {
  if (!polygon.length) return 0
  return Math.abs(signedRingArea(polygon[0])) - polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedRingArea(ring)), 0)
}

function multiPolygonArea(multiPolygon: LocalMultiPolygon) {
  return multiPolygon.reduce((sum, polygon) => sum + polygonArea(polygon), 0)
}

function mapPolygon(polygon: Polygon, project: (point: Position) => Point): LocalPolygon {
  return polygon.coordinates.map((ring) => ring.map(project))
}

function closeRing(ring: Point[]) {
  if (!ring.length) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

function toGeoJsonPolygon(polygon: LocalPolygon, inverse: (point: Point) => Point): Polygon {
  return { type: "Polygon", coordinates: polygon.map((ring) => closeRing(ring.map(inverse))) }
}

function principalAngle(points: Point[]) {
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length
  let xx = 0
  let yy = 0
  let xy = 0
  for (const [x, y] of points) {
    const dx = x - meanX
    const dy = y - meanY
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy)
}

function rotate([x, y]: Point, angle: number): Point {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [x * cosine - y * sine, x * sine + y * cosine]
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): LocalPolygon {
  return [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]
}

function intersectionArea(farm: LocalPolygon, bounds: LocalPolygon) {
  return multiPolygonArea(polygonClipping.intersection(farm, bounds))
}

interface AlignedFarm {
  aligned: LocalPolygon
  fromAxis: (point: Point) => Point
  projection: Projection
  minX: number
  maxX: number
  minY: number
  maxY: number
  padding: number
  totalArea: number
  orientation: PartitionOrientation
}

function alignFarm(farm: FarmFeature, method: PartitionMethod, orientation: PartitionOrientation): AlignedFarm {
  const projection = createProjection(farm)
  const local = mapPolygon(farm.geometry, projection.forward)
  const exterior = local[0].slice(0, -1)
  const farmAngle = principalAngle(exterior)
  const angle = orientation === "farm-axis"
    ? farmAngle
    : method === "regular-grid"
      ? 0
      : Math.abs(Math.cos(farmAngle)) >= Math.abs(Math.sin(farmAngle)) ? 0 : Math.PI / 2
  const toAxis = (point: Point) => rotate(point, -angle)
  const fromAxis = (point: Point) => rotate(point, angle)
  const aligned = local.map((ring) => ring.map(toAxis))
  const points = aligned.flat()
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.05 + 1
  const totalArea = multiPolygonArea([aligned])
  return { aligned, fromAxis, projection, minX, maxX, minY, maxY, padding, totalArea, orientation }
}

function createFieldsFromComponents(farm: FarmFeature, components: LocalPolygon[], context: AlignedFarm) {
  const fields: FieldFeature[] = []
  for (const component of components) {
    if (polygonArea(component) <= MIN_AREA_SQUARE_METRES) continue
    const geometry = toGeoJsonPolygon(component, (point) => context.projection.inverse(context.fromAxis(point)))
    const field = createFieldFeature(geometry, farm.properties.id, fields.length + 1)
    if (!validatePolygon(field).valid) throw new Error("The farm shape produced an invalid candidate boundary.")
    fields.push(field)
  }
  return fields
}

function partitionIntoStrips(farm: FarmFeature, count: number, context: AlignedFarm): PartitionResult {
  const { aligned, minX, maxX, minY, maxY, padding, totalArea } = context

  const cuts = [minY - padding]
  for (let part = 1; part < count; part += 1) {
    const targetArea = totalArea * part / count
    let low = minY
    let high = maxY
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (low + high) / 2
      const area = intersectionArea(aligned, rectangle(minX - padding, minY - padding, maxX + padding, middle))
      if (area < targetArea) low = middle
      else high = middle
    }
    cuts.push((low + high) / 2)
  }
  cuts.push(maxY + padding)

  const components: LocalPolygon[] = []
  for (let part = 0; part < count; part += 1) {
    const clipped = polygonClipping.intersection(
      aligned,
      rectangle(minX - padding, cuts[part], maxX + padding, cuts[part + 1]),
    )
    for (const component of clipped) {
      if (polygonArea(component) > MIN_AREA_SQUARE_METRES) components.push(component)
    }
  }
  const fields = createFieldsFromComponents(farm, components, context)
  if (fields.length < count) throw new Error("The farm could not be divided into the requested number of valid fields.")
  return {
    fields,
    requestedCount: count,
    actualCount: fields.length,
    method: "equal-area-strips",
    orientation: context.orientation,
    gridLayout: null,
    hasExtraParts: fields.length > count,
  }
}

interface GridCandidate {
  rows: number
  columns: number
  components: LocalPolygon[]
  actualCount: number
}

function gridComponents(context: AlignedFarm, rows: number, columns: number) {
  const { aligned, minX, maxX, minY, maxY } = context
  const width = (maxX - minX) / columns
  const height = (maxY - minY) / rows
  const components: LocalPolygon[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const clipped = polygonClipping.intersection(aligned, rectangle(
        minX + column * width,
        minY + row * height,
        minX + (column + 1) * width,
        minY + (row + 1) * height,
      ))
      for (const component of clipped) {
        if (polygonArea(component) > MIN_AREA_SQUARE_METRES) components.push(component)
      }
    }
  }
  return components
}

function partitionIntoGrid(farm: FarmFeature, count: number, context: AlignedFarm): PartitionResult {
  const candidates: GridCandidate[] = []
  const minimumDimension = count < 4 ? 1 : 2
  for (let rows = minimumDimension; rows <= 12; rows += 1) {
    for (let columns = minimumDimension; columns <= 12; columns += 1) {
      const cellCount = rows * columns
      if (cellCount < 2 || cellCount > 24) continue
      const components = gridComponents(context, rows, columns)
      candidates.push({ rows, columns, components, actualCount: components.length })
    }
  }
  const farmRatio = (context.maxX - context.minX) / Math.max(context.maxY - context.minY, 1)
  candidates.sort((left, right) => {
    const actualDifference = Math.abs(left.actualCount - count) - Math.abs(right.actualCount - count)
    if (actualDifference) return actualDifference
    const cellDifference = Math.abs(left.rows * left.columns - count) - Math.abs(right.rows * right.columns - count)
    if (cellDifference) return cellDifference
    const leftRatioDifference = Math.abs(Math.log((left.columns / left.rows) / farmRatio))
    const rightRatioDifference = Math.abs(Math.log((right.columns / right.rows) / farmRatio))
    return leftRatioDifference - rightRatioDifference
  })
  const selected = candidates[0]
  if (!selected?.components.length) throw new Error("The farm could not be divided into a valid regular grid.")
  const fields = createFieldsFromComponents(farm, selected.components, context)
  return {
    fields,
    requestedCount: count,
    actualCount: fields.length,
    method: "regular-grid",
    orientation: context.orientation,
    gridLayout: { rows: selected.rows, columns: selected.columns },
    hasExtraParts: fields.length > selected.rows * selected.columns,
  }
}

export function partitionFarm(
  farm: FarmFeature,
  requestedCount: number,
  method: PartitionMethod = farm.properties.partitionMethod ?? "equal-area-strips",
  orientation: PartitionOrientation = farm.properties.partitionOrientation ?? "farm-axis",
): PartitionResult {
  const count = Math.max(2, Math.min(12, Math.round(requestedCount)))
  const context = alignFarm(farm, method, orientation)
  if (context.totalArea <= MIN_AREA_SQUARE_METRES * count) {
    throw new Error("The farm is too small for the requested number of fields.")
  }
  return method === "regular-grid"
    ? partitionIntoGrid(farm, count, context)
    : partitionIntoStrips(farm, count, context)
}

function asLocalMultiPolygon(features: Array<Feature<Polygon>>, projection: Projection): LocalMultiPolygon {
  return features.map((feature) => mapPolygon(feature.geometry, projection.forward))
}

export function validateCandidatePartition(farm: FarmFeature, fields: FieldFeature[]): PartitionValidation {
  const errors: string[] = []
  if (!fields.length) return { valid: false, errors: ["No candidate fields were generated."], coverageRatio: 0 }
  const projection = createProjection(farm)
  const localFarm = mapPolygon(farm.geometry, projection.forward)
  const localFields = asLocalMultiPolygon(fields, projection)
  const farmArea = multiPolygonArea([localFarm])
  const fieldArea = localFields.reduce((sum, polygon) => sum + polygonArea(polygon), 0)
  const [firstField, ...remainingFields] = localFields
  const unionGeometry = polygonClipping.union(firstField, ...remainingFields)
  const unionArea = multiPolygonArea(unionGeometry)
  const outsideArea = multiPolygonArea(polygonClipping.difference(unionGeometry, localFarm))
  const uncoveredArea = multiPolygonArea(polygonClipping.difference(localFarm, unionGeometry))
  const overlapArea = Math.max(0, fieldArea - unionArea)
  const tolerance = Math.max(farmArea * 0.001, 0.5)

  for (const field of fields) {
    const validation = validatePolygon(field)
    if (!validation.valid) errors.push(`${field.properties.name}: ${validation.errors[0]}`)
    if (multiPolygonArea([mapPolygon(field.geometry, projection.forward)]) <= MIN_AREA_SQUARE_METRES) {
      errors.push(`${field.properties.name} is smaller than one square metre.`)
    }
  }
  if (outsideArea > tolerance) errors.push("Candidate fields extend outside the farm boundary.")
  if (uncoveredArea > tolerance) errors.push("Candidate fields do not fully cover the farm.")
  if (overlapArea > tolerance) errors.push("Candidate fields overlap each other.")
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    coverageRatio: farmArea ? Math.min(1, unionArea / farmArea) : 0,
  }
}

function samePoint(a: Position, b: Position, tolerance = 1e-7) {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance
}

export function synchronizeSharedVertices(previous: FieldFeature[], next: FieldFeature[], changedId: string): FieldFeature[] {
  const before = previous.find((field) => field.properties.id === changedId)
  const after = next.find((field) => field.properties.id === changedId)
  if (!before || !after) return next
  const moves: Array<{ from: Position; to: Position }> = []
  before.geometry.coordinates.forEach((ring, ringIndex) => {
    ring.forEach((point, pointIndex) => {
      const replacement = after.geometry.coordinates[ringIndex]?.[pointIndex]
      if (replacement && !samePoint(point, replacement)) moves.push({ from: point, to: replacement })
    })
  })
  if (!moves.length) return next
  return next.map((field) => {
    if (field.properties.id === changedId) return field
    let edited = false
    const coordinates = field.geometry.coordinates.map((ring) => ring.map((point) => {
      const move = moves.find((candidate) => samePoint(point, candidate.from))
      if (!move) return point
      edited = true
      return [...move.to]
    }))
    return edited ? {
      ...field,
      geometry: { ...field.geometry, coordinates },
      properties: { ...field.properties, boundarySource: "edited" as const, updatedAt: new Date().toISOString() },
    } : field
  })
}
