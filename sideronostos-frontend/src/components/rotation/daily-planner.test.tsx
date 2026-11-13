import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type { DailyProfile } from "@/lib/api/daily-types";
import * as api from "@/lib/api/daily";
import { DailyPlannerForm } from "./daily-planner";
vi.mock("@/lib/api/daily", () => ({
  checkDailyReadiness: vi.fn(),
  createDailyRun: vi.fn(),
}));
const profile = JSON.parse(
  readFileSync(
    "../sideronostos-backend/src/sideronostos_backend/modules/rotation_optimizer/v3/data/profiles/iowa-engineering-v3-20261114.json",
    "utf8",
  ),
) as DailyProfile;
profile.sha256 = "hash";
const field = {
  id: "field-a",
  version: 1,
  farm_id: "farm-a",
  partition_revision: "part-a",
  name: "North",
  area_ha: 2,
  soil_texture: "loam",
  irrigation_available: true,
  history: [],
  history_events: [],
} as unknown as Field;
const farm = {
  id: "farm-a",
  name: "Farm",
  partition_revision: "part-a",
} as ServerFarmHeader;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("requires explicit engineering setup and fresh readiness before creating a run", () => {
  render(
    <DailyPlannerForm
      owner="alice"
      profile={profile}
      fields={[field]}
      farms={[farm]}
      selectedFieldId={field.id}
      onRun={() => {}}
      onDraft={() => {}}
      onFieldSaved={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "生成轮作方案" })).toBeDisabled();
  expect(screen.getByLabelText("田间持水量 FC · m3/m3")).toHaveValue(null);
  fireEvent.click(
    screen.getByRole("button", { name: "仅为演示：填入缺少的工程假设" }),
  );
  expect(screen.getByLabelText("田间持水量 FC · m3/m3")).toHaveValue(0.3);
  expect(
    screen.getByRole("checkbox", { name: /理解并接受当前工程/ }),
  ).not.toBeChecked();
  expect(api.createDailyRun).not.toHaveBeenCalled();
  expect(api.checkDailyReadiness).not.toHaveBeenCalled();
});
