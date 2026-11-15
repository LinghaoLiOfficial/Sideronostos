import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalKnowledgeCatalogue, LocalKnowledgeProfile } from "@/lib/api/rotation-types";
import { LocalKnowledgeWorkspace } from "@/features/rotation/local-knowledge-workspace";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/api/rotation", () => ({
  getLocalKnowledge: mocks.get,
  saveLocalKnowledgeDraft: mocks.save,
  publishLocalKnowledge: mocks.publish,
}));

const profile = {
  id: "iowa-benchmark-20261114-v2", name: "Iowa benchmark", region: "Iowa",
  scope: "benchmark_not_locally_calibrated", weather_release_id: "weather",
  weather_center: [-93.5, 42], weather_radius_km: 25, limitations: ["Benchmark only"],
  crops: [{ id: "maize", name: "玉米", family: "Poaceae", base_c: 10, upper_c: 30,
    gdd_required: 1400, gdd_recipe: "draft_one_sided_v1", max_growing_days: 200,
    turnaround_days: 14, sow_start_mmdd: "04-20", sow_end_mmdd: "05-18",
    kc: [.3, 1.2, .6], stage_fractions: [.2, .3, .3, .2], cost_usd_ha: 900,
    labor_days_ha: 4, parameter_origins: { family: "SOURCE" } }],
  history_catalogue: { maize: "Poaceae" }, history_turnaround_days: 14,
  family_gaps: { Poaceae: 365 }, sowing_step_days: 7, effective_rain_fraction: .8,
  default_weights: { cover: 2, diversity: 1, water: 1, cost: .5 },
  references: { cover: 1000, diversity: 10, water: 10000, cost: 10000 },
  parameter_origins: { family_gaps: "SOURCE" },
  sources: { SOURCE: { kind: "reference", title: "Local extension", url: "https://example.test",
    applicability: "Iowa", limitations: ["Confirm locally"] } },
} as unknown as LocalKnowledgeProfile;

const catalogue = {
  active: { id: "active", revision: 1, status: "published", is_active: true, sha256: "a".repeat(64), profile, created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z", published_at: "2026-11-15T00:00:00Z" },
  draft: { id: "draft", revision: null, status: "draft", is_active: false, sha256: "a".repeat(64), profile, created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z", published_at: null },
  versions: [],
} as LocalKnowledgeCatalogue;

beforeEach(() => {
  mocks.get.mockResolvedValue(catalogue);
  mocks.save.mockImplementation(async (value: LocalKnowledgeProfile) => ({ ...catalogue.draft, profile: value, updated_at: "2026-11-15T01:00:00Z" }));
  mocks.publish.mockResolvedValue({ ...catalogue, active: { ...catalogue.active, revision: 2 }, draft: { ...catalogue.draft, updated_at: "2026-11-15T02:00:00Z" } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("edits and saves a personal agronomy draft", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LocalKnowledgeWorkspace /></QueryClientProvider>);
  const name = await screen.findByDisplayValue("Iowa benchmark");
  await userEvent.clear(name); await userEvent.type(name, "My farm knowledge");
  await userEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "My farm knowledge" }), catalogue.draft.updated_at));
  expect(await screen.findByText("草稿已保存")).toBeVisible();
});

it("exposes crop, rule, source and immutable version views", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LocalKnowledgeWorkspace /></QueryClientProvider>);
  await screen.findByText("本地农业知识库");
  await userEvent.click(screen.getByRole("button", { name: /作物参数/ }));
  expect(screen.getByDisplayValue("玉米")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /来源与局限/ }));
  expect(screen.getByDisplayValue("Local extension")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /版本记录/ }));
  expect(screen.getByRole("heading", { name: "版本记录" })).toBeVisible();
});
