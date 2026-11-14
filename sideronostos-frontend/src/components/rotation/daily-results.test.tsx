import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { cleanup, screen, within } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { afterEach, expect, it } from "vitest";
import type {
  DailyComparison,
  DailyRun,
  DailyInput,
  DailyOption,
  DailySaved,
} from "@/lib/api/daily-types";
import type { Field } from "@/lib/api/field-shift-types";
import {
  DailyOptionDetail,
  DailyOptionsComparison,
  DailyRunResults,
  DailyComparisonSummary,
  DailySavedPlan,
} from "./daily-results";
const evidence = JSON.parse(
  readFileSync(
    "../output/evidence/fields-bot-v3/v3-real-weather-execution.json",
    "utf8",
  ),
);
// The offline execution sample predates API normalization; the API freezes these
// documented RunRequest defaults before exposing the snapshot to the frontend.
evidence.input_snapshot.request.scenario ??= {
  temperature_change_c: 0,
  rainfall_change_pct: 0,
};
evidence.input_snapshot.provenance = {
  ...evidence.input_snapshot.provenance,
  weather_release_id: evidence.input_snapshot.profile.weather_release_id,
  benchmark_scope: evidence.input_snapshot.profile.scope,
  limitations: evidence.input_snapshot.profile.limitations,
  sources: evidence.input_snapshot.profile.sources,
  parameter_origins: evidence.input_snapshot.profile.parameter_origins,
};
afterEach(cleanup);
const fields = evidence.input_snapshot.fields as Field[];
const request = evidence.input_snapshot.request as DailyInput;
const option = evidence.result.options[0] as DailyOption;
it("renders uncomputed optional metrics as unavailable, preserving actual zero metrics", () => {
  const unavailable = structuredClone(option);
  unavailable.verification.metrics.profit = null;
  unavailable.objective_definition.disabled_metrics.profit = "No local prices";
  render(
    <DailyOptionDetail
      option={unavailable}
      fields={fields}
      request={request}
    />,
  );
  expect(screen.getByLabelText("收益估计 · USD")).toHaveTextContent("未计算");
  expect(screen.getByLabelText("轮作衔接 · 分")).toHaveTextContent("0");
  expect(screen.getByText("No local prices")).toBeInTheDocument();
});
it("labels positive resource gaps as diagnostics and shows their remedy and source", () => {
  const diagnostic = structuredClone(option);
  diagnostic.execution_label = "diagnostic_requires_remedies";
  diagnostic.verification.diagnostic = true;
  diagnostic.verification.resource_feasible = false;
  diagnostic.verification.gap_cost = 60;
  diagnostic.verification.resources = [
    {
      id: "machine:tractor-1:2027-04-20",
      kind: "machine",
      used: 2,
      capacity: 0,
      gap: 2,
      unit: "hours",
      remediable: true,
      gap_unit_cost: 30,
      gap_cost: 60,
      remedy: "Confirm contractor booking",
      evidence_ids: ["input:engineering"],
    },
  ];
  render(
    <DailyOptionDetail option={diagnostic} fields={fields} request={request} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("需补救的诊断方案");
  expect(screen.getByText("Confirm contractor booking")).toBeInTheDocument();
  expect(screen.getByLabelText("经营资源缺口")).toHaveTextContent("2027-04-20");
  expect(screen.getByText(/已具备实施条件/)).toHaveTextContent(
    "不表示已具备实施条件",
  );
});
it("displays comparison direction and null deltas without inventing missing values", () => {
  const comparison: DailyComparison = {
    first_run_id: "one",
    second_run_id: "two",
    first_option_id: "option-1",
    second_option_id: "option-1",
    model_version: "rotation-milp-v3.0",
    interpretation: "second minus first",
    delta: {
      profit: null,
      water: 10,
      rotation: 0,
      soil: 0.2,
      risk: 0,
      bare: -10,
    },
    unavailable_metrics: ["profit"],
    score_comparable: false,
    input_changes: { scenario: { before: {}, after: {} } },
  };
  render(
    <DailyComparisonSummary
      comparison={comparison}
      current={{ ...option.verification.metrics, profit: null }}
      other={{
        ...option.verification.metrics,
        profit: null,
        water: option.verification.metrics.water! + 10,
      }}
    />,
  );
  expect(screen.getByText(/对照结果减当前结果/)).toBeInTheDocument();
  expect(screen.getByLabelText("收益估计差值")).toHaveTextContent("无法比较");
  expect(screen.getByText(/综合分数不能直接比较/)).toBeInTheDocument();
});
it("reopens the frozen field and evidence from the saved plan without live-field replacement", () => {
  const saved = {
    schema: "rotation-saved-v3.0",
    id: "saved-a",
    run_id: "run-a",
    option_id: option.id,
    title: "Frozen plan",
    notes: "Saved note",
    created_at: "2026-11-14T00:00:00Z",
    run_created_at: "2026-11-14T00:00:00Z",
    option,
    input_snapshot: structuredClone(evidence.input_snapshot),
  } as DailySaved;
  saved.input_snapshot.fields[0].name = "Original North field";
  render(<DailySavedPlan plan={saved} />);
  expect(
    screen.getByRole("heading", { name: /Original North field/ }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByLabelText("保存时的资料依据")).getByText(/2025/),
  ).toBeInTheDocument();
});

it("shows structured preparation failures from a real queued rainfed scenario without crashing", () => {
  const failed = JSON.parse(
    readFileSync(
      "../output/evidence/fields-bot-v3/browser-rainfed-blocked-run.json",
      "utf8",
    ),
  ) as DailyRun;
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DailyRunResults
        selectedOptionId={null}
        compareRunId={null}
        compareOptionId={null}
        owner="test-owner"
        run={failed}
        changes={[]}
        onSelect={() => {}}
        onExplain={() => {}}
        onUpdate={() => {}}
        onSaved={() => {}}
        onCompare={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/原定种法没有通过候选检查/)).toHaveTextContent(
    "2027-04-20",
  );
  expect(screen.getByText(/地块没有符合硬约束的候选/)).toHaveTextContent(
    "Iowa benchmark field 1",
  );
  expect(screen.getByText(/缺少所需灌溉设施/)).toHaveTextContent("9");
  expect(
    screen.queryByRole("button", { name: /^保存/ }),
  ).not.toBeInTheDocument();
});

it("compares raw alternatives while hiding unverified or unavailable metrics", () => {
  const unavailable = structuredClone(option);
  unavailable.id = "second";
  unavailable.verification.metrics.profit = null;
  const unchecked = structuredClone(option);
  unchecked.id = "third";
  unchecked.scientific_verification.valid = false;
  render(<DailyOptionsComparison options={[option, unavailable, unchecked]} />);
  const profitRow = screen.getByRole("row", { name: /收益估计/ });
  expect(within(profitRow).getByText("未计算")).toBeInTheDocument();
  expect(within(profitRow).getByText("未通过校验")).toBeInTheDocument();
  expect(screen.getByText(/综合分数不用于跨偏好排名/)).toBeInTheDocument();
});
