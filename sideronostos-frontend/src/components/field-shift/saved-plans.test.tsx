import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedPlanDetail, serializePlan } from "./saved-plans";
import { alternative, analysis, field } from "./fixtures.test-helper";
import type { SavedPlan } from "@/lib/api/field-shift-types";

const saved: SavedPlan = { id: "saved-1", title: "三年安排", notes: "请农技员核对", created_at: "2026-11-01T00:00:00Z", field_id: field.id, field_name: field.name, option: alternative, analysis, field_snapshot: field };
afterEach(cleanup);
describe("saved plan evidence", () => {
  it("exports the immutable field, assumptions, environment and scenario together", () => {
    const exported = JSON.parse(serializePlan(saved));
    expect(exported.field_snapshot.history).toEqual([{ year: 2025, crop_id: "wheat" }]);
    expect(exported.analysis.environment.months[1].rainfall_mm).toBeNull();
    expect(exported.analysis.profile_snapshot.assumptions).toEqual(["投入成本为示范估计，需在当地核对。"]);
    expect(exported.analysis.inputs.scenario).toEqual({ rainfall_change_pct: 0, temperature_change_c: 0 });
    expect(exported.option.metrics.irrigation_gap_mm).toBe(180);
  });
  it("shows snapshot facts and offers complete export and print without recalculating", () => {
    render(<SavedPlanDetail plan={saved} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "三年安排" })).toBeInTheDocument();
    expect(screen.getByText(/固定快照/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出完整 JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印计划" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重新计算/ })).not.toBeInTheDocument();
  });
  it("deduplicates the readable limitations without changing the original exported snapshot", () => {
    const repeated = "需在当地核对";
    const snapshot = { ...saved, analysis: { ...analysis, limitations: [repeated], profile_snapshot: { ...analysis.profile_snapshot, assumptions: [repeated] }, environment: { ...analysis.environment, limitations: [repeated] } } };
    render(<SavedPlanDetail plan={snapshot} onBack={vi.fn()} />);
    expect(screen.getAllByText(repeated)).toHaveLength(1);
    const exported = JSON.parse(serializePlan(snapshot));
    expect(exported.analysis.limitations).toEqual([repeated]);
    expect(exported.analysis.profile_snapshot.assumptions).toEqual([repeated]);
    expect(exported.analysis.environment.limitations).toEqual([repeated]);
  });
  it("prints every evidence section and restores the farmer's expanded sections after printing", () => {
    const view = render(<SavedPlanDetail plan={saved} onBack={vi.fn()} />);
    const details = [...view.container.querySelectorAll("details")];
    expect(details.length).toBeGreaterThan(1);
    details[0].open = true;
    window.dispatchEvent(new Event("beforeprint"));
    expect(details.every((item) => item.open)).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    expect(details[0].open).toBe(true);
    expect(details.slice(1).every((item) => !item.open)).toBe(true);
  });
});
