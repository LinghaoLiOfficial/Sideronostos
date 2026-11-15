import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "./client";
import { createAnalysis, updateField, getEnvironment, listPlans, savePlan } from "./field-shift";

afterEach(() => { setAccessToken(null); vi.unstubAllGlobals(); });

describe("Field Shift API boundary", () => {
  it("preserves zero irrigation and sends the authoritative field version", async () => {
    let received: RequestInit | undefined;
    let requestPath = "";
    vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
      received = options; requestPath = url.pathname;
      return new Response(JSON.stringify({ id: "analysis-1" }), { status: 201 });
    });
    setAccessToken("session-token");
    await createAnalysis("field/1", { start_year: 2027, baseline_crop_ids: ["wheat", "wheat", "wheat"], allowed_crop_ids: ["wheat", "pea"], max_irrigation_mm: 0, max_cost_usd_ha: 800, max_labor_days_ha: 12, weights: { water: 5, cover: 2, diversity: 3, cost: 1 }, scenario: { rainfall_change_pct: -20, temperature_change_c: 1 }, accept_demo_assumptions: true }, 4);
    expect(requestPath).toBe("/field-shift/fields/field%2F1/analyses");
    expect(JSON.parse(String(received?.body))).toMatchObject({ max_irrigation_mm: 0, expected_field_version: 4, scenario: { rainfall_change_pct: -20, temperature_change_c: 1 } });
    expect(new Headers(received?.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("uses explicit refresh, scoped plan lookup and immutable analysis identifiers", async () => {
    const requests: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
      requests.push({ path: `${url.pathname}${url.search}`, body: options.body ? JSON.parse(String(options.body)) : null });
      return new Response(JSON.stringify({ items: [] }));
    });
    await getEnvironment("field-1", true);
    await listPlans("field/1");
    await savePlan({ analysis_id: "analysis-1", option_id: "option-2", title: "我的计划", notes: "保留资料" });
    expect(requests).toEqual([
      { path: "/field-shift/fields/field-1/environment?refresh=true", body: null },
      { path: "/field-shift/plans?field_id=field%2F1", body: null },
      { path: "/field-shift/plans", body: { analysis_id: "analysis-1", option_id: "option-2", title: "我的计划", notes: "保留资料" } },
    ]);
  });

  it("keeps conflict errors recoverable when editing a stale field", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "version_conflict", message: "Field changed", request_id: "request-8" } }), { status: 409 }));
    await expect(updateField("field-1", { name: "西田", area_ha: 2, latitude: 31, longitude: 120, soil_texture: "unknown", irrigation_available: false, profile_id: "demo", history: [] }, 2)).rejects.toMatchObject({ status: 409, error: { request_id: "request-8" } });
  });
});
