import { expect, it } from "vitest";
import { observationWindow } from "./workspace-state";

it("restores a complete observation window and rejects partial, impossible or excessive dates", () => {
  expect(observationWindow(null, null)).toEqual({});
  expect(observationWindow("2026-11-07", "2026-11-07")).toEqual({
    dates: { start: "2026-11-07", end: "2026-11-07" },
  });
  for (const [start, end] of [
    ["2025-01-01", null],
    ["2025-02-30", "2025-03-02"],
    ["2026-01-02", "2026-01-01"],
    ["2020-01-01", "2025-01-01"],
  ]) {
    expect(observationWindow(start, end).error).toBeTruthy();
  }
});

it("labels missing science by its release instead of the currently selected layer", async () => {
  const { scienceSourceName } = await import("./workspace-state");
  const layers = [{ title: "SMAP 表层土壤水分", source: { release_id: "satellite-v1" } }];
  const profiles = [{ weather_release_id: "archive-v1" }];
  expect(scienceSourceName("archive-v1", layers, profiles)).toBe("历史天气资料");
  expect(scienceSourceName("satellite-v1", layers, profiles)).toBe("SMAP 表层土壤水分");
  expect(scienceSourceName("unlisted-v2", layers, profiles)).toContain("unlisted-v2");
});
