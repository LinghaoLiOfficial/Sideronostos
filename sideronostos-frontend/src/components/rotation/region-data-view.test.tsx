import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  RegionSelection,
  RegionFacts,
  ScienceFact,
} from "@/lib/api/rotation-types";
import { RegionDataView } from "./region-data-view";
afterEach(cleanup);
const selection: RegionSelection = {
  id: "a",
  revision: 1,
  kind: "point",
  geometry: { type: "Point", coordinates: [-97, 43] },
  center: [-97, 43],
  area_ha: null,
  created_at: "2026-11-13",
};
const fact: ScienceFact = {
  id: "water",
  metric: "rainfall_total",
  value: 0,
  unit: "mm",
  status: "available",
  data_kind: "observation",
  source: { product: "NASA POWER" },
  period: { start: "2025-01-01", end: "2025-01-01" },
  limitations: [],
};
const data: RegionFacts = {
  selection,
  facts: [fact],
  unavailable: [],
  online_fetch_performed: false,
};
it("shows zero as a reading, missing as missing, with observation dates and source", () => {
  render(
    <RegionDataView
      selection={selection}
      data={{
        ...data,
        facts: [
          fact,
          {
            ...fact,
            id: "missing",
            metric: "soil_moisture",
            value: null,
            status: "no_recommended_retrieval",
          },
        ],
      }}
      loading={false}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText("0 mm")).toBeVisible();
  expect(screen.getByText("暂无有效值")).toBeVisible();
  expect(screen.getAllByText(/2025-01-01/).length).toBeGreaterThan(0);
  expect(screen.getAllByText("NASA POWER")).toHaveLength(2);
});
it("does not show facts for a previous selection or revision", () => {
  const view = render(
    <RegionDataView
      selection={{ ...selection, id: "b" }}
      data={data}
      loading={true}
      onRetry={() => {}}
    />,
  );
  expect(screen.queryByText("0 mm")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("正在读取");
  view.rerender(
    <RegionDataView
      selection={{ ...selection, revision: 2 }}
      data={data}
      loading={false}
      onRetry={() => {}}
    />,
  );
  expect(screen.queryByText("0 mm")).not.toBeInTheDocument();
  expect(screen.getByText(/这片选区的资料暂不可用/)).toBeVisible();
});
it("never substitutes point values for an unprepared polygon aggregate", () => {
  const area: RegionSelection = {
    ...selection,
    kind: "polygon",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-97, 43],
          [-96, 43],
          [-96, 44],
          [-97, 43],
        ],
      ],
    },
    area_ha: 12.3,
  };
  render(
    <RegionDataView
      selection={area}
      data={{
        ...data,
        selection: area,
        unavailable: [{ reason: "no_prepared_area_statistics" }],
      }}
      loading={false}
      onRetry={() => {}}
    />,
  );
  expect(screen.queryByText("0 mm")).not.toBeInTheDocument();
  expect(screen.getByText(/不能用中心点代替/)).toBeVisible();
  expect(screen.getByText("12.3 ha")).toBeVisible();
});
it("offers a retry on a failed request without presenting stale readings", async () => {
  const retry = vi.fn();
  render(
    <RegionDataView
      selection={selection}
      data={data}
      loading={false}
      error={new Error("offline")}
      onRetry={retry}
    />,
  );
  expect(screen.queryByText("0 mm")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "重新读取" }));
  expect(retry).toHaveBeenCalledOnce();
});
