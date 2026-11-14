import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Field } from "@/lib/api/field-shift-types";
import type { NasaDataRelease, ProfileV2, RunV2 } from "@/lib/api/rotation-types";
import { NasaRotationWorkspace } from "./nasa-rotation-workspace";

const mocks = vi.hoisted(() => ({
  createField: vi.fn(), createRun: vi.fn(), listFields: vi.fn(), preflightRotation: vi.fn(),
}));
let fieldStore: Field[] = [];
vi.mock("@/lib/api/client", () => ({ getCurrentUser: vi.fn().mockResolvedValue({ id: "owner-1" }) }));
vi.mock("@/lib/api/field-shift", () => ({
  listFields: mocks.listFields, createField: mocks.createField, listProfiles: vi.fn(),
}));
vi.mock("@/lib/api/rotation", () => ({
  listNasaDataReleases: vi.fn(), listRotationProfiles: vi.fn(), createRun: mocks.createRun,
  preflightRotation: mocks.preflightRotation,
  getRun: vi.fn(), getLayerManifest: vi.fn(),
}));
vi.mock("./nasa-release-map", () => ({ NasaReleaseMap: () => <div data-testid="release-map" /> }));
vi.mock("./results", () => ({ allOptions: () => [], RunResults: () => <div data-testid="run-results" /> }));

const release = {
  id: "iowa-nasa-2022-2024-v1", manifest_sha256: "a".repeat(64), status: "published",
  start: "2022-01-01", end: "2024-12-31", bounds: [-93.56, 41.97, -93.44, 42.05],
  crs: "EPSG:4326", center: [-93.5, 42], applicability: "iowa_engineering_benchmark_only",
  model_usable: true, complete_days: 1096, expected_days: 1096,
  products: { power: { model_usable: true }, gpm: { model_usable: true }, smap: { model_usable: false, evidence_only: true } },
  layers: [], evidence_only: ["smap"], limitations: ["Historical benchmark only."], published_at: "2026-11-14T00:00:00Z",
} as NasaDataRelease;
const profile = {
  id: "iowa-profile", name: "Iowa", sha256: "b".repeat(64), scope: "benchmark",
  crops: [{ id: "maize", name: "玉米", family: "Poaceae", sow_start_mmdd: "04-15", sow_end_mmdd: "05-15", gdd_required: 1200, turnaround_days: 7, base_c: 10, upper_c: 30, max_growing_days: 180, kc: [.3, 1.2, .6], stage_fractions: [.2, .3, .3, .2], cost_usd_ha: 900, labor_days_ha: 4, parameter_origins: {} }],
  limitations: [], weather_release_id: "weather", weather_center: [-93.5, 42], weather_radius_km: 5,
  history_catalogue: {}, default_weights: { cover: 2, diversity: 1, water: 1, cost: .5 }, sources: {}, parameter_origins: {}, sowing_step_days: 7,
} as ProfileV2;
const field = {
  id: "field-1", version: 1, name: "North field", area_ha: 32, latitude: 42, longitude: -93.5,
  soil_texture: "loam", irrigation_available: true, profile_id: profile.id, history: [], history_events: [],
  geometry: { type: "Polygon", coordinates: [[[-93.51, 41.99], [-93.49, 41.99], [-93.49, 42.01], [-93.51, 41.99]]] },
  created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z",
} as Field;

async function setup(items: Field[] = [field]) {
  const api = await import("@/lib/api/rotation");
  const fieldApi = await import("@/lib/api/field-shift");
  vi.mocked(api.listNasaDataReleases).mockResolvedValue({ items: [release] });
  vi.mocked(api.listRotationProfiles).mockResolvedValue({ items: [profile], default_profile_id: profile.id });
  vi.mocked(fieldApi.listProfiles).mockResolvedValue({ items: [{ id: "temperate-demo" }] as never });
  fieldStore = [...items];
  mocks.listFields.mockImplementation(async () => ({ items: [...fieldStore] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><NasaRotationWorkspace /></QueryClientProvider>);
  await screen.findByText("NASA 历史轮作回测");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createRun.mockResolvedValue({ id: "run-1", status: "pending" } as RunV2);
  mocks.preflightRotation.mockResolvedValue({
    recipe: "rotation-capacity-preflight-v1", profile_id: profile.id,
    profile_sha256: profile.sha256, sampling_step_days: 7,
    candidate_count: 180, candidate_count_truncated: false,
    rejected_candidate_count: 0, transition_edge_count: 1800,
    transition_edge_count_truncated: false,
    limits: { max_candidates: 2000, max_transition_edges: 50000 },
    within_capacity: true, violations: [],
  });
  mocks.createField.mockImplementation(async (body: Field) => {
    const index = Number(body.name.split(" ").at(-1));
    const created = { ...body, id: `synthetic-${index}`, version: 1, created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" } as Field;
    fieldStore.push(created);
    return created;
  });
});
afterEach(cleanup);

it("preselects benchmark fields and submits a frozen NASA release without warnings", async () => {
  await setup(); const user = userEvent.setup();
  await waitFor(() => expect(mocks.createField).toHaveBeenCalledTimes(4));
  const runButton = await screen.findByRole("button", { name: "运行 Gurobi 回测" });
  await waitFor(() => expect(runButton).toBeEnabled());
  expect(screen.getByText("容量状态：可运行")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /我理解这是使用历史 NASA 数据/ })).toBeChecked();
  await user.click(runButton);
  await waitFor(() => expect(mocks.createRun).toHaveBeenCalledOnce());
  expect(mocks.createRun.mock.calls[0][0]).toMatchObject({
    data_release_id: release.id, horizon_mode: "3y", max_options: 3,
    start: "2022-01-01", end: "2024-12-31",
    field_limits: { "synthetic-1": { "2022": { water_m3: 96000, cost_usd: 38400, labor_days: 256 } } },
  });
  expect(screen.queryByText(/请至少选择一个/)).not.toBeInTheDocument();
});

it("creates the four fixed engineering benchmark fields without presenting them as cadastral data", async () => {
  await setup([]);
  expect(screen.getByText(/不是真实地籍/)).toBeVisible();
  await waitFor(() => expect(mocks.createField).toHaveBeenCalledTimes(4));
  expect(mocks.createField.mock.calls.map(([body]) => body)).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Iowa synthetic benchmark 1", area_ha: 32, soil_texture: "loam", profile_id: "temperate-demo" }),
    expect.objectContaining({ name: "Iowa synthetic benchmark 4", area_ha: 32, soil_texture: "loam" }),
  ]));
});

it("blocks submission and identifies transition-edge capacity growth", async () => {
  mocks.preflightRotation.mockResolvedValueOnce({
    recipe: "rotation-capacity-preflight-v1", profile_id: profile.id,
    profile_sha256: profile.sha256, sampling_step_days: 7,
    candidate_count: 180, candidate_count_truncated: false,
    rejected_candidate_count: 0, transition_edge_count: 50001,
    transition_edge_count_truncated: true,
    limits: { max_candidates: 2000, max_transition_edges: 50000 },
    within_capacity: false,
    violations: [{
      dimension: "transition_edges", count: 50001, limit: 50000, truncated: true,
      factors: { field_count: 4, crop_count: 3, year_count: 3, sampling_step_days: 7 },
      message: "too many transitions", suggestion: "narrow windows",
    }],
  });
  await setup();
  await screen.findByText("容量状态：超出限制");
  expect(screen.getByText(/连接边维度膨胀/)).toBeVisible();
  expect(screen.getByRole("button", { name: "运行 Gurobi 回测" })).toBeDisabled();
  expect(mocks.createRun).not.toHaveBeenCalled();
});
