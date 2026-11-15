import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { GET } from "./route"

const originalAnalysisDir = process.env.NASA_ANALYSIS_DIR
let temporaryRoot: string | undefined

afterEach(async () => {
  if (originalAnalysisDir === undefined) delete process.env.NASA_ANALYSIS_DIR
  else process.env.NASA_ANALYSIS_DIR = originalAnalysisDir
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

async function createFixture() {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nasa-analysis-test-"))
  const analysisDir = path.join(temporaryRoot, "analysis", "non-appeears")
  await mkdir(analysisDir, { recursive: true })
  process.env.NASA_ANALYSIS_DIR = analysisDir
  return { analysisDir, productRoot: path.resolve(analysisDir, "../..") }
}

describe("GET /api/nasa-analysis", () => {
  it("returns an actionable not-found response if inputs are unavailable", async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nasa-analysis-empty-"))
    process.env.NASA_ANALYSIS_DIR = path.join(temporaryRoot, "missing")
    const response = await GET()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
  })

  it("filters provenance paths and builds GPM cells with field geometry", async () => {
    const { analysisDir, productRoot } = await createFixture()
    await mkdir(path.join(productRoot, "processed"), { recursive: true })
    await mkdir(path.join(productRoot, "aoi"), { recursive: true })
    await writeFile(path.join(analysisDir, "summary.json"), JSON.stringify({
      schema: "sideronostos-non-appeears-analysis-v1",
      period: { start: "2022-01-01", end: "2024-12-31" },
      coverage: { expected_days: 2, power_days: 2, gpm_days_with_full_grid: 2, gpm_unique_cells: 1 },
      annual: [{ year: 2022, rain_mm: 10, et0_mm: 20, tmean_c: 4, rain_minus_et0_mm: -10, power_complete: true, gpm_complete: true }],
      monthly: [{ month: "2022-01", rain_mm: 10, et0_mm: 20, tmean_c: 4, rain_minus_et0_mm: -10 }],
      grace: { coordinates: { nearest_grid_latitude: 42, nearest_grid_longitude: 266, effective_mascon_resolution_degrees: 3 }, rows: [] },
      terrain: { min_elevation_m: 10, max_elevation_m: 20, mean_elevation_m: 15, bounds: [-94, 41, -93, 42] },
      interpretation_limits: [],
      source_files: { power_daily_csv: { path: "/private/file.csv", sha256: "secret" } },
    }))
    await writeFile(path.join(productRoot, "processed", "gpm-daily-aoi.csv"), "date,longitude,latitude,rain_mm\n2022-01-01,-93.5,42,1\n2022-01-02,-93.5,42,3\n")
    await writeFile(path.join(productRoot, "aoi", "fields.geojson"), JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "one", properties: { field_id: "field-1", area_ha: 32 }, geometry: { type: "Polygon", coordinates: [[[-93.51, 41.99], [-93.5, 41.99], [-93.5, 42], [-93.51, 41.99]]] } }],
    }))

    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.gpm_grid.features).toHaveLength(1)
    expect(body.gpm_grid.features[0].properties.mean_annual_rain_mm).toBe(4)
    expect(body.fields.features[0].properties).toEqual({ field_id: "field-1", area_ha: 32 })
    expect(JSON.stringify(body)).not.toContain("/private/file.csv")
    expect(JSON.stringify(body)).not.toContain("secret")
  })
})
