import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import type { Feature, FeatureCollection, Polygon } from "geojson"

export const dynamic = "force-dynamic"

type Summary = {
  schema: string
  period: { start: string; end: string }
  coverage: Record<string, number>
  annual: Array<Record<string, number | boolean>>
  monthly: Array<Record<string, number | string | boolean>>
  grace: {
    coordinates: Record<string, number>
    rows: Array<{ date: string; lwe_cm: number | null; uncertainty_cm: number | null }>
  }
  terrain: {
    min_elevation_m: number
    max_elevation_m: number
    mean_elevation_m: number
    bounds: [number, number, number, number]
  }
  interpretation_limits: string[]
}

function getAnalysisDir() {
  return path.resolve(process.env.NASA_ANALYSIS_DIR ?? path.resolve(process.cwd(), "../data/nasa/iowa-2022-2024/analysis/non-appeears"))
}

function gpmGrid(csv: string): FeatureCollection<Polygon, { mean_annual_rain_mm: number }> {
  const [header, ...lines] = csv.trim().split(/\r?\n/)
  const columns = header.split(",")
  const indexes = ["date", "longitude", "latitude", "rain_mm"].map((name) => columns.indexOf(name))
  if (indexes.some((index) => index < 0)) throw new Error("GPM CSV is missing required columns")
  const [dateIndex, longitudeIndex, latitudeIndex, rainIndex] = indexes
  const values = new Map<string, { longitude: number; latitude: number; years: Map<string, number> }>()
  for (const line of lines) {
    const fields = line.split(",")
    if (fields.length !== columns.length) continue
    const date = fields[dateIndex]
    const longitude = Number(fields[longitudeIndex])
    const latitude = Number(fields[latitudeIndex])
    const rain = Number(fields[rainIndex])
    if (!date || !Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(rain)) continue
    const key = longitude.toFixed(4) + "," + latitude.toFixed(4)
    const cell = values.get(key) ?? { longitude, latitude, years: new Map<string, number>() }
    cell.years.set(date.slice(0, 4), (cell.years.get(date.slice(0, 4)) ?? 0) + rain)
    values.set(key, cell)
  }
  const features: Array<Feature<Polygon, { mean_annual_rain_mm: number }>> = []
  for (const cell of values.values()) {
    const annualTotals = [...cell.years.values()]
    if (!annualTotals.length) continue
    const meanAnnualRain = annualTotals.reduce((sum, value) => sum + value, 0) / annualTotals.length
    const halfCell = 0.05
    features.push({
      type: "Feature",
      properties: { mean_annual_rain_mm: Number(meanAnnualRain.toFixed(1)) },
      geometry: { type: "Polygon", coordinates: [[
        [cell.longitude - halfCell, cell.latitude - halfCell],
        [cell.longitude + halfCell, cell.latitude - halfCell],
        [cell.longitude + halfCell, cell.latitude + halfCell],
        [cell.longitude - halfCell, cell.latitude + halfCell],
        [cell.longitude - halfCell, cell.latitude - halfCell],
      ]] },
    })
  }
  return { type: "FeatureCollection", features }
}

function fieldCollection(input: FeatureCollection): FeatureCollection<Polygon, { field_id: string; area_ha: number }> {
  return {
    type: "FeatureCollection",
    features: input.features.flatMap((feature) => {
      if (feature.geometry.type !== "Polygon") return []
      const properties = feature.properties as Record<string, unknown> | null
      return [{
        type: "Feature" as const,
        geometry: feature.geometry as Polygon,
        properties: { field_id: String(properties?.field_id ?? feature.id ?? "field"), area_ha: Number(properties?.area_ha ?? 0) },
      }]
    }),
  }
}

export async function GET() {
  const analysisDir = getAnalysisDir()
  try {
    const [summaryText, gpmCsv, fieldsText] = await Promise.all([
      readFile(path.join(analysisDir, "summary.json"), "utf8"),
      readFile(path.resolve(analysisDir, "../../processed/gpm-daily-aoi.csv"), "utf8"),
      readFile(path.resolve(analysisDir, "../../aoi/fields.geojson"), "utf8"),
    ])
    const source = JSON.parse(summaryText) as Summary
    if (source.schema !== "sideronostos-non-appeears-analysis-v1") {
      return NextResponse.json({ error: "Unsupported NASA analysis data version." }, { status: 422 })
    }
    const sourceFields = JSON.parse(fieldsText) as FeatureCollection
    return NextResponse.json({
      period: source.period,
      coverage: source.coverage,
      annual: source.annual,
      monthly: source.monthly,
      grace: source.grace,
      terrain: source.terrain,
      interpretation_limits: source.interpretation_limits,
      gpm_grid: gpmGrid(gpmCsv),
      fields: fieldCollection(sourceFields),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT"
    return NextResponse.json(
      { error: missing ? "NASA 分析数据尚未生成或所需输入文件缺失。" : "NASA 分析数据无法读取，请检查文件格式。" },
      { status: missing ? 404 : 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
