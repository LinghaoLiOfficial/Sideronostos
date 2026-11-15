import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { OptionDetail } from "./results";
import type { OptionV2 } from "@/lib/api/rotation-types";
import type { Field } from "@/lib/api/field-shift-types";
afterEach(cleanup);
it("does not present incomplete baseline weather as zero resources or whole-period fallow", () => {
  const option = {
    id: "baseline",
    label: "Baseline",
    complete: false,
    feasible: false,
    seasons: [],
    verification: {
      totals: {
        water_m3: 0,
        cost_usd: 0,
        labor_days: 0,
        cover_ha_days: 0,
        diversity_ha_families: 0,
      },
      farm_years: {},
      violations: [],
    },
    input_errors: [{ field_id: "a", reason: "weather_missing" }],
  } as unknown as OptionV2;
  render(
    <OptionDetail
      option={option}
      fields={[{ id: "a", name: "North", area_ha: 8 } as Field]}
      start="2027-01-01"
      end="2028-12-31"
    />,
  );
  expect(
    screen.queryByText("此地块在整个规划期休耕。"),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/基准资料未完整计算/)).toBeInTheDocument();
  expect(screen.queryByText("用水估计 · m³")).not.toBeInTheDocument();
});
it("describes a baseline's farm budget violation in farmer language", () => {
  const option = {
    id: "baseline",
    complete: true,
    feasible: false,
    seasons: [],
    verification: {
      totals: {
        water_m3: 0,
        cost_usd: 7150,
        labor_days: 0,
        cover_ha_days: 0,
        diversity_ha_families: 0,
      },
      farm_years: {},
      violations: ["farm_resource:2027:cost_usd"],
    },
  } as unknown as OptionV2;
  render(
    <OptionDetail
      option={option}
      fields={[]}
      start="2027-01-01"
      end="2028-12-31"
    />,
  );
  expect(screen.getByText("2027 年的农场投入超过年度上限。")).toBeVisible();
  expect(
    screen.queryByText("farm_resource:2027:cost_usd"),
  ).not.toBeInTheDocument();
});
it("states comparison selection order and shows both values without implying chronology", async () => {
  const { ComparisonSummary } = await import("./results");
  const metrics = {
    water_m3: 100,
    cost_usd: 200,
    labor_days: 3,
    cover_ha_days: 20,
    diversity_ha_families: 1,
  };
  const other = { ...metrics, water_m3: 150 };
  const comparison = {
    first_run_id: "newer",
    second_run_id: "older",
    first_option_id: "option-1",
    second_option_id: "option-1",
    interpretation: "second minus first",
    delta: {
      water_m3: 50,
      cost_usd: 0,
      labor_days: 0,
      cover_ha_days: 0,
      diversity_ha_families: 0,
    },
    input_changes: { farm_limits: { before: {}, after: {} } },
    score_comparable: true,
  } as import("@/lib/api/rotation-types").ComparisonV2;
  render(
    <ComparisonSummary
      comparison={comparison}
      current={metrics}
      other={other}
    />,
  );
  expect(screen.getByText(/对照结果减当前结果/)).toBeVisible();
  expect(screen.getByText(/农场年度资源/)).toBeVisible();
  expect(screen.getByText("当前 100 → 对照 150")).toBeVisible();
  expect(screen.queryByText(/后一次/)).not.toBeInTheDocument();
});

it.each([false, true])("prints annual evidence and restores disclosure state (open=%s)", (initiallyOpen) => {
  const option = {
    id: "option-1", feasible: true, seasons: [], solver: null,
    verification: {
      valid: true, violations: [], farm_years: {},
      totals: { water_m3: 0, cost_usd: 0, labor_days: 0, cover_ha_days: 0, diversity_ha_families: 0 },
    },
  } as unknown as OptionV2;
  render(<OptionDetail option={option} fields={[]} start="2027-01-01" end="2027-12-31" />);
  const details = screen.getByText("各年度资源与计算依据").closest("details")!;
  details.open = initiallyOpen;
  window.dispatchEvent(new Event("beforeprint"));
  expect(details.open).toBe(true);
  expect(screen.getByRole("table")).toBeVisible();
  window.dispatchEvent(new Event("afterprint"));
  expect(details.open).toBe(initiallyOpen);
});
