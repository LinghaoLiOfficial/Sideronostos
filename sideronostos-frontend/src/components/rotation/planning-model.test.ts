import { describe, expect, it } from "vitest";
import {
  buildRequest,
  changedConditions,
  draftFromRun,
  emptyDraft,
  planningYears,
} from "./planning-model";
import type { Field } from "@/lib/api/field-shift-types";
import type { ProfileV2, RotationInput } from "@/lib/api/rotation-types";
const profile = {
  id: "benchmark",
  crops: [{ id: "pea" }],
  default_weights: { cover: 1, diversity: 1, water: 1, cost: 1 },
} as ProfileV2;
const field = { id: "a", version: 3, name: "North" } as Field;
const input: RotationInput = {
  idempotency_key: "old-key-1",
  profile_id: "benchmark",
  fields: [
    {
      id: "a",
      expected_version: 3,
      require_crop: true,
      history_reviewed: true,
    },
  ],
  start: "2027-12-01",
  end: "2028-08-31",
  allowed_crop_ids: ["pea"],
  sow_windows: {},
  farm_limits: {
    2027: { water_m3: 1250, cost_usd: 3800, labor_days: 12 },
    2028: { water_m3: 2000, cost_usd: 5400, labor_days: 16 },
  },
  field_limits: {
    a: { 2028: { water_m3: 1500, cost_usd: 5000, labor_days: 15 } },
  },
  weights: { cover: 1, diversity: 1, water: 1, cost: 1 },
  scenario: { temperature_change_c: 0, rainfall_change_pct: 0 },
  baseline: [{ field_id: "a", crop_id: "pea", sow_date: "2028-04-15" }],
  accept_benchmark_assumptions: true,
};
describe("farmer planning inputs", () => {
  it("preserves whole-farm units and cross-year limits through saved draft roundtrip", () => {
    expect(
      buildRequest(draftFromRun(input), profile, [field], "new-key-1"),
    ).toEqual({ ...input, idempotency_key: "new-key-1" });
  });
  it("requires explicit capacities and renewed review after a field edit", () => {
    const draft = emptyDraft(profile);
    draft.fields = input.fields;
    draft.accept_benchmark_assumptions = true;
    expect(() => buildRequest(draft, profile, [field], "new-key-1")).toThrow(
      /资源/,
    );
    expect(() =>
      buildRequest(
        draftFromRun(input),
        profile,
        [{ ...field, version: 4 }],
        "new-key-1",
      ),
    ).toThrow(/重新核对/);
  });
  it("does not reinterpret dates as fixed three annual slots or silently retain out-of-horizon baseline", () => {
    expect(planningYears(input.start, input.end)).toEqual(["2027", "2028"]);
    const draft = draftFromRun(input);
    draft.start = "2028-06-01";
    expect(() => buildRequest(draft, profile, [field], "new-key-1")).toThrow(
      /基准/,
    );
  });
  it("tracks changed choices without treating a new idempotency key as changed scientific conditions", () => {
    expect(
      changedConditions(input, { ...input, idempotency_key: "new-key-1" }),
    ).toEqual([]);
    expect(
      changedConditions(input, {
        ...input,
        scenario: { temperature_change_c: 0, rainfall_change_pct: -20 },
      }),
    ).toEqual(["scenario"]);
  });
});

it("rejects corrupt nested draft data rather than crashing when the form opens", async () => {
  const { readDraft, saveDraft } = await import("./planning-model");
  const bad = { ...draftFromRun(input), field_limits: { a: { 2028: null } } };
  localStorage.setItem(
    `rotation-draft:qa:${profile.id}`,
    JSON.stringify({ schema: 1, profile_sha256: profile.sha256, draft: bad }),
  );
  expect(readDraft("qa", profile)).toBeNull();
  saveDraft("qa", profile, draftFromRun(input));
  expect(readDraft("qa", profile)).toEqual(draftFromRun(input));
  localStorage.clear();
});
