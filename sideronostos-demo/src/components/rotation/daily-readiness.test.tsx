import { render } from "@/test/render-zh";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DailyReadiness, ReadinessItem } from "@/lib/api/daily-types";
import { DailyReadinessPanel } from "./daily-readiness";
afterEach(cleanup);
it("groups repeated parameter checks into actionable sections while retaining every audit row", () => {
  const item = {
    status: "blocked",
    value: null,
    unit: "1",
    expected_unit: "1",
    sources: [],
    issues: ["engineering_assumption_unaccepted"],
    blocked_features: ["optimization"],
    engineering_assumption: true,
  } as unknown as ReadinessItem;
  const report = {
    ready: false,
    weather: { warnings: [] },
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
