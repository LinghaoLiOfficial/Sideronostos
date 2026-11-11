import { describe, expect, it } from "vitest";
import { parseFieldDraft, parsePlanningDraft, initialPlanningDraft, initialFieldDraft } from "./model";

describe("farmer input validation", () => {
  it("never turns an unknown coordinate into a zero coordinate", () => {
    const draft = { ...initialFieldDraft("demo"), name: "西田", area_ha: "2", latitude: "", longitude: "0" };
    expect(parseFieldDraft(draft, ["wheat"]).error).toMatch(/纬度/);
    expect(parseFieldDraft({ ...draft, latitude: "0" }, ["wheat"]).value).toMatchObject({ latitude: 0, longitude: 0 });
  });
  it("rejects duplicate history years and non-finite areas", () => {
    const draft = { ...initialFieldDraft("demo"), name: "西田", area_ha: "2", latitude: "31", longitude: "120", history: [{ year: "2025", crop_id: "wheat" }, { year: "2025", crop_id: "wheat" }] };
    expect(parseFieldDraft(draft, ["wheat"]).error).toMatch(/重复/);
    expect(parseFieldDraft({ ...draft, area_ha: "Infinity", history: [] }, ["wheat"]).error).toMatch(/面积/);
  });
  it("accepts a zero water budget but requires explicit demonstration acknowledgement", () => {
    const draft = { ...initialPlanningDraft(["wheat", "pea"]), max_irrigation_mm: "0" };
    expect(parsePlanningDraft(draft, ["wheat", "pea"], [], true).error).toMatch(/示范/);
    expect(parsePlanningDraft({ ...draft, accept_demo_assumptions: true }, ["wheat", "pea"], [], true).value?.max_irrigation_mm).toBe(0);
  });
  it("rejects a start year overlapping history and all-zero preferences", () => {
    const draft = { ...initialPlanningDraft(["wheat", "pea"]), start_year: "2025", accept_demo_assumptions: true };
    expect(parsePlanningDraft(draft, ["wheat", "pea"], [{ year: 2025, crop_id: "wheat" }], true).error).toMatch(/历史/);
    expect(parsePlanningDraft({ ...draft, start_year: "2027", weights: { water: 0, cover: 0, diversity: 0, cost: 0 } }, ["wheat", "pea"], [], true).error).toMatch(/优先/);
  });
});
