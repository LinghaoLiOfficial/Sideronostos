import { cleanup, screen, within } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { afterEach, expect, it } from "vitest";
import type { DailyReadiness, ReadinessItem } from "@/lib/api/daily-types";
import { DailyReadinessPanel } from "./daily-readiness";
afterEach(cleanup);
it("groups repeated parameter checks into actionable sections while retaining every audit row", () => {
  const item = {
    status: "blocked" as const,
    missing_reason: null, warnings: [], blocks: [],
    value: null,
    unit: "1",
    expected_unit: "1",
    sources: [],
    issues: ["engineering_assumption_unaccepted"],
    blocked_features: ["optimization"],
    engineering_assumption: true,
  } as unknown as ReadinessItem;
  const report = {
    schema: "rotation-readiness-v3.0", stage: "data_preflight", blocked_features: [], fingerprint: "readiness-test", farm_versions: [],
    ready: false,
    weather: { ready: false, issues: [], warnings: [] },
    items: [
      ...Array.from({ length: 300 }, (_, index) => ({
        ...item,
        path: `profile.crop.${index}`,
      })),
      { ...item, path: "fields.north.ph", issues: ["value_missing"] },
    ],
  } as unknown as DailyReadiness;
  render(<DailyReadinessPanel report={report} fields={[]} />);
  const actions = screen.getAllByRole("link", { name: "去核对资料" });
  expect(actions).toHaveLength(2);
  expect(actions[0]).toHaveAttribute("href", "#daily-profile");
  expect(actions[1]).toHaveAttribute("href", "#daily-conditions");
  const audits = screen
    .getAllByText(/展开逐项依据/)
    .map((el) => el.closest("details")!);
  expect(audits).toHaveLength(2);
  expect(audits[0]).not.toHaveAttribute("open");
  expect(within(audits[0]).getByText(/profile.crop.299/)).toBeInTheDocument();
});
it("explains catalogue and equipment gaps and links each group to the place that can fix it", () => {
  const base = {
    status: "blocked" as const,
    value: null, missing_reason: null, warnings: [], engineering_assumption: false, blocks: [],
    sources: [],
    unit: "validation",
    expected_unit: "validation",
  };
  const report = {
    schema: "rotation-readiness-v3.0", stage: "data_preflight", blocked_features: [], fingerprint: "readiness-test", farm_versions: [],
    ready: false,
    weather: { ready: false, issues: [], warnings: [] },
    items: [
      {
        ...base,
        path: "fields.east.history",
        issues: ["history_catalogue_incompatible"],
      },
      {
        ...base,
        path: "fields.east.machine.tractor",
        issues: ["machine_membership_missing"],
      },
      {
        ...base,
        path: "fields.east.machine.harvester",
        issues: ["machine_membership_missing"],
      },
    ],
  } as DailyReadiness;
  render(<DailyReadinessPanel report={report} fields={[]} />);
  expect(
    screen.getAllByText(/前茬记录的作物目录与当前参数包不一致/)[0],
  ).toBeVisible();
  expect(screen.getAllByText(/尚未为地块指定必需设备/)[0]).toBeVisible();
  const actions = screen.getAllByRole("link", { name: "去核对资料" });
  expect(actions.map((link) => link.getAttribute("href"))).toEqual([
    "#daily-conditions",
    "#daily-resources",
  ]);
  expect(
    screen.getByRole("heading", { name: "还有 2 组资料需要核对" }),
  ).toBeVisible();
});
