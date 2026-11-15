import { beforeEach, expect, it } from "vitest";
import { demoApiResponse } from "./api";

beforeEach(() => localStorage.clear());

async function request(path: string, method = "GET", body?: Record<string, unknown>) {
  const response = await demoApiResponse(path, { method, body });
  expect(response.ok).toBe(true);
  return response.json();
}

it("returns Iowa published rain and ET0 through persistent observation actions", async () => {
  const selection = await request("/agri-data/selections", "POST", {
    kind: "point", geometry: { type: "Point", coordinates: [-93.505, 42.0005] }, revision: 1,
  });
  expect(selection.id).toMatch(/^demo-selection-/);
  const path = "/farm-assistant/conversations/chat/actions";
  const rain = await request(path, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "rainfall_total" }, idempotency_key: "rain-1",
  });
  expect(rain.status).toBe("succeeded");
  expect(rain.result).toMatchObject({ metric: "rainfall_total", value: 1049.312467, unit: "mm" });
  expect(await request(`${path}/rain-1`)).toEqual(rain);
  const et0 = await request(path, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "reference_et0_total" }, idempotency_key: "et0-1",
  });
  expect(et0.result).toMatchObject({ metric: "reference_et0_total", value: 1165.753116, unit: "mm" });
});

it("retrieves the saved field's precomputed SMAP observation with its source and date", async () => {
  const selection = await request("/agri-data/selections", "POST", {
    kind: "point", geometry: { type: "Point", coordinates: [-93.505, 42.0005] }, revision: 1,
  });
  const path = "/farm-assistant/conversations/chat/actions";
  const soil = await request(path, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "surface_soil_moisture" }, idempotency_key: "soil-1",
  });
  expect(soil).toMatchObject({
    status: "succeeded",
    result: {
      metric: "surface_soil_moisture", value: 0.25, unit: "m³/m³",
      period: { start: "2024-07-16", end: "2024-07-16" },
      source: { release_id: "iowa-nasa-2022-2024-v1", product: "SMAP SPL4SMGP.008 · Iowa backend release" },
    },
  });
  expect(soil.result.limitations.join(" ")).toMatch(/regional|demo/i);
  expect(await request(`${path}/soil-1`)).toEqual(soil);
});

it("rejects unsupported date slices without inventing readings", async () => {
  const selection = await request("/agri-data/selections", "POST", {
    kind: "point", geometry: { type: "Point", coordinates: [-93.505, 42.0005] }, revision: 1,
  });
  const path = "/farm-assistant/conversations/chat/actions";
  const partial = await request(path, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "rainfall_total", start: "2024-01-02", end: "2024-01-31" }, idempotency_key: "partial-1",
  });
  expect(partial.status).toBe("unavailable");
  expect(partial.text).toMatch(/complete calendar months/i);
  const missingSoil = await request(path, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "surface_soil_moisture", start: "2024-08-01", end: "2024-08-31" }, idempotency_key: "soil-august",
  });
  expect(missingSoil.status).toBe("unavailable");
});

it("opens the published observation layer metadata from the specialist task", async () => {
  const outcome = await request("/farm-assistant/conversations/chat/actions", "POST", {
    action: "remote_sensing.layer", arguments: { layer_id: "iowa-ndvi-hls" }, idempotency_key: "layer-1",
  });
  expect(outcome).toMatchObject({ status: "succeeded", result: { id: "iowa-ndvi-hls" } });
});

it("uses the conversation language for observation results", async () => {
  const conversation = await request("/farm-assistant/conversations", "POST", { language: "zh", bot_id: "remote-water" });
  const selection = await request("/agri-data/selections", "POST", {
    kind: "point", geometry: { type: "Point", coordinates: [-93.505, 42.0005] }, revision: 1,
  });
  const outcome = await request(`/farm-assistant/conversations/${conversation.id}/actions`, "POST", {
    action: "remote_sensing.fact", arguments: { selection_id: selection.id, metric: "rainfall_total" }, idempotency_key: "rain-zh",
  });
  expect(outcome.text).toBe("已找到发布的观测值。");
  expect(outcome.result.limitations[0]).toMatch(/Iowa 区域历史观测/);
});
