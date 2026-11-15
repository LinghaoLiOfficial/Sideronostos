import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type { DailyProfile } from "@/lib/api/daily-types";
import {
  activePlanningFields,
  emptyDailyDraft,
  selectDailyFields,
  numberRecord,
  applyEngineeringFixture,
  prepareDailyRequest,
  dailyChanges,
  dailyDraftSchema,
  annualPeriods,
  saveDailyDraft,
  readDailyDraft,
  savePendingDaily,
  readPendingDaily,
} from "./daily-model";

const profile = JSON.parse(
  readFileSync(
    "../sideronostos-backend/src/sideronostos_backend/modules/rotation_optimizer/v3/data/profiles/iowa-engineering-v3-20261114.json",
    "utf8",
  ),
) as DailyProfile;
profile.sha256 = "release-sha";
const field = {
  id: "field-a",
  version: 2,
  farm_id: "farm-a",
  partition_revision: "partition-a",
  name: "North",
  irrigation_available: true,
  history: [],
  history_events: [],
} as unknown as Field;
const farm = {
  id: "farm-a",
  partition_revision: "partition-a",
} as ServerFarmHeader;
const setup = () =>
  selectDailyFields(emptyDailyDraft(profile, 2027), [field], profile);
beforeEach(() => localStorage.clear());

describe("daily farmer draft boundaries", () => {
  it("shows only owned current-partition fields and never truncates a chosen set", () => {
    const archived = { ...field, id: "old", partition_revision: "old" };
    expect(
      activePlanningFields(
        [field, archived, { ...field, id: "legacy", farm_id: null }],
        [farm],
      ).map((f) => f.id),
    ).toEqual([field.id]);
    expect(() =>
      selectDailyFields(
        emptyDailyDraft(profile),
        Array.from({ length: 11 }, (_, i) => ({ ...field, id: String(i) })),
        profile,
      ),
    ).toThrow(/10/);
  });
  it("keeps blank operating numbers unknown, distinguishing an explicitly typed zero", () => {
    expect(numberRecord("", "m3/day", [])).toMatchObject({
      value: null,
      missing_reason: expect.any(String),
    });
    expect(numberRecord("0", "m3/day", ["ledger"])).toEqual({
      value: 0,
      unit: "m3/day",
      source_ids: ["ledger"],
    });
    expect(numberRecord("not-a-number", "m3/day", [])).toMatchObject({
      value: null,
    });
    const d = setup();
    expect(d.accept_engineering_assumptions).toBe(false);
    expect(d.sources).toEqual({});
    expect(
      Object.values(d.farm_resources["farm-a"].daily).every(
        (r) => r.default.amount.value === null,
      ),
    ).toBe(true);
    expect(d.baseline).toEqual([]);
  });
  it("adds explicit engineering evidence only on request and never relabels measured values", () => {
    const d = setup();
    d.field_conditions[field.id].values.field_capacity = {
      value: 0.31,
      unit: "m3/m3",
      source_ids: ["lab"],
    };
    const filled = applyEngineeringFixture(d, [field], profile);
    expect(
      filled.field_conditions[field.id].values.field_capacity?.source_ids,
    ).toEqual(["lab"]);
    expect(
      filled.field_conditions[field.id].values.wilting_point?.source_ids,
    ).toEqual(["engineering-fixture"]);
    expect(filled.sources["engineering-fixture"].kind).toBe(
      "engineering_assumption",
    );
    expect(filled.accept_engineering_assumptions).toBe(false);
    expect(d.baseline).toEqual([]);
    expect(filled.baseline).toHaveLength(1);
  });
  it("rejects stale versions and archived partitions rather than calculating silently from changed fields", () => {
    const d = setup();
    expect(() =>
      prepareDailyRequest(
        d,
        profile,
        [{ ...field, version: 3 }],
        [farm],
        "new-key-1",
      ),
    ).toThrow(/版本/);
    expect(() =>
      prepareDailyRequest(
        d,
        profile,
        [field],
        [{ ...farm, partition_revision: "new" }],
        "new-key-1",
      ),
    ).toThrow(/分割/);
  });
  it("preserves exact pending requests across a live profile update without crossing accounts", () => {
    const body = prepareDailyRequest(
      setup(),
      profile,
      [field],
      [farm],
      "pending-key-1",
    );
    savePendingDaily("alice", body);
    expect(readPendingDaily("alice")).toEqual(body);
    expect(readPendingDaily("bob")).toBeNull();
    saveDailyDraft("alice", profile, setup());
    expect(
      readDailyDraft("alice", { ...profile, sha256: "changed" }),
    ).toBeNull();
    expect(readPendingDaily("alice")?.idempotency_key).toBe("pending-key-1");
  });
  it("restores only validated nested drafts with the same owner and release", () => {
    const d = setup();
    saveDailyDraft("alice", profile, d);
    expect(readDailyDraft("alice", profile)).toEqual(d);
    expect(readDailyDraft("bob", profile)).toBeNull();
    const storedKey = `rotation-v3-draft:alice:${profile.id}`;
    const stored = JSON.parse(localStorage.getItem(storedKey)!);
    stored.draft.farm_resources["farm-a"].daily = { bad: null };
    localStorage.setItem(storedKey, JSON.stringify(stored));
    expect(readDailyDraft("alice", profile)).toBeNull();
  });
  it("partitions leap and partial years and rejects overlapping or incomplete periods", () => {
    expect(annualPeriods("2027-12-15", "2028-03-01")).toEqual([
      { id: "year-2027", start: "2027-12-15", end: "2027-12-31" },
      { id: "year-2028", start: "2028-01-01", end: "2028-03-01" },
    ]);
    const d = setup();
    d.periods[0].start = "2027-01-02";
    expect(() =>
      prepareDailyRequest(d, profile, [field], [farm], "new-key-1"),
    ).toThrow(/分期/);
  });
  it("tracks sourced operating changes while ignoring submission idempotency", () => {
    const d = setup();
    const next = structuredClone(d);
    next.field_conditions[field.id].values.ph = numberRecord("6.5", "pH", [
      "lab",
    ]);
    expect(dailyChanges(d, next)).toContain("field_limits");
    expect(
      dailyChanges(
        { ...d, idempotency_key: "one" },
        { ...d, idempotency_key: "two" },
      ),
    ).toEqual([]);
  });
});

it("does not clear another tab's newer pending request when an older submission finishes", async () => {
  const { clearPendingDaily } = await import("./daily-model");
  const body = prepareDailyRequest(
    setup(),
    profile,
    [field],
    [farm],
    "newer-key-1",
  );
  savePendingDaily("alice", body);
  clearPendingDaily("alice", "older-key-1");
  expect(readPendingDaily("alice")).toEqual(body);
  clearPendingDaily("alice", body.idempotency_key);
  expect(readPendingDaily("alice")).toBeNull();
});

it("does not report JSON key ordering from a persisted API snapshot as an edit", () => {
  const run = JSON.parse(
    readFileSync(
      "src/components/rotation/__fixtures__/rainfed-failure-ui.json",
      "utf8",
    ),
  );
  const raw = { ...run.request };
  delete raw.idempotency_key;
  const restored = dailyDraftSchema.parse(raw);
  expect(dailyChanges(run.request, restored)).toEqual([]);
  restored.scenario.rainfall_change_pct = 10;
  expect(dailyChanges(run.request, restored)).toEqual(["scenario"]);
});

it("treats omitted optional API null defaults as unchanged without erasing unknown numeric values", () => {
  const run = JSON.parse(
    readFileSync(
      "src/components/rotation/__fixtures__/rainfed-failure-ui.json",
      "utf8",
    ),
  );
  const raw = { ...run.request };
  delete raw.idempotency_key;
  const draft = dailyDraftSchema.parse(raw);
  Object.values(draft.field_conditions).forEach((c) =>
    Object.values(c.values).forEach((v) => {
      if (v) delete v.missing_reason;
    }),
  );
  Object.values(draft.sources).forEach((s) => {
    delete s.observed_start;
    delete s.observed_end;
  });
  Object.values(draft.farm_resources).forEach((f) =>
    Object.values(f.daily).forEach((r) => {
      if (r.kind === "machine") {
        delete r.water_basis;
        delete r.irrigation_efficiency;
      }
    }),
  );
  expect(dailyChanges(run.request, draft)).toEqual([]);
  const condition = Object.values(draft.field_conditions)[0];
  condition.values.slope_deg!.value = null;
  condition.values.slope_deg!.missing_reason = "Unknown";
  expect(dailyChanges(run.request, draft)).toEqual(["field_limits"]);
});
