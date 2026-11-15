import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RemoteSensingWorkspace } from "./nasa-analysis"
import { createDemoFarm } from "./demo-data"
import type { FieldFeature } from "@/types/workspace"

const workspace = vi.hoisted(() => ({ farms: [] as ReturnType<typeof createDemoFarm>["farm"][], fields: [] as FieldFeature[] }))
vi.mock("@/components/rotation/use-workspace-session", () => ({
  useWorkspaceSession: () => ({ ready: true, session: { data: { id: "owner-1", email_verified: true } } }),
}))
vi.mock("./use-owned-workspace", () => ({
  useOwnedWorkspace: () => ({ workspace: { farms: workspace.farms, fields: workspace.fields } }),
}))
const analysis = {
  period: { start: "2022-01-01", end: "2024-12-31" },
  coverage: { expected_days: 1, power_days: 1, gpm_days_with_full_grid: 1, gpm_unique_cells: 1 },
  annual: [{ year: 2024, tmean_c: 12, et0_mm: 100, rain_mm: 120, rain_minus_et0_mm: 20, power_complete: true, gpm_complete: true }],
  monthly: [{ month: "2024-01", tmean_c: 12, et0_mm: 10, rain_mm: 12, rain_minus_et0_mm: 2 }],
  grace: { coordinates: { nearest_grid_latitude: 42, nearest_grid_longitude: 267, effective_mascon_resolution_degrees: 3 }, rows: [{ date: "2024-01-01", lwe_cm: 1, uncertainty_cm: 0.2 }] },
  terrain: { min_elevation_m: 200, max_elevation_m: 300, mean_elevation_m: 250, bounds: [-94, 41, -93, 42] },
  interpretation_limits: ["Benchmark only"],
  gpm_grid: { type: "FeatureCollection", features: [] },
  fields: { type: "FeatureCollection", features: [] },
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(analysis), { status: 200 })))
})

describe("remote sensing farm selector", () => {
  it("updates the report context when a farm is selected", async () => {
    const first = createDemoFarm(1)
    first.farm.properties.name = "North farm"
    const second = createDemoFarm(2)
    second.farm.properties.name = "South farm"
    workspace.farms = [first.farm, second.farm]
    workspace.fields = [...first.fields, ...second.fields]

    render(<RemoteSensingWorkspace />)
    expect(await screen.findByRole("heading", { name: "North farm remote sensing report" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /South farm/ }))
    expect(await screen.findByRole("heading", { name: "South farm remote sensing report" })).toBeVisible()
  })
})
