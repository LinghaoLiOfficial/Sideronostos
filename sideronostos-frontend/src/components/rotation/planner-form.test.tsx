import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { render } from "@/test/render-zh";
import userEvent from "@testing-library/user-event";
import { PlannerForm } from "./planner-form";
import { emptyDraft, saveDraft } from "./planning-model";
import type { ProfileV2, RunV2 } from "@/lib/api/rotation-types";
import type { Field } from "@/lib/api/field-shift-types";
const profile = {
  id: "p",
  sha256: "sha",
  crops: [
    { id: "pea", name: "豌豆", sow_start_mmdd: "04-01", sow_end_mmdd: "05-31" },
  ],
  history_catalogue: { pea: "Fabaceae" },
  default_weights: { water: 1, cost: 1, cover: 1, diversity: 1 },
  limitations: [],
  sources: {},
} as unknown as ProfileV2;
const field = {
  id: "f",
  name: "北田",
  version: 1,
  history: [],
  history_events: [],
  area_ha: 8,
  irrigation_available: true,
} as unknown as Field;
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function setup(run?: RunV2) {
  const draft = emptyDraft(profile);
  draft.fields = [
    {
      id: field.id,
      expected_version: 1,
      require_crop: true,
      history_reviewed: true,
    },
  ];
  saveDraft("owner", profile, draft);
  return render(
    <PlannerForm
      owner="owner"
      profile={profile}
      fields={[field]}
      run={run}
      onRun={vi.fn()}
      onDraft={vi.fn()}
      onFieldSaved={vi.fn()}
    />,
  );
}
it("blocks calculation while a selected field's history edits are unsaved and allows discarding them", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByText("查看 / 补充前茬记录"));
  await user.click(screen.getByRole("button", { name: "新增前茬" }));
  expect(screen.getByRole("button", { name: "生成轮作方案" })).toBeDisabled();
  expect(screen.getByText(/前茬记录尚未保存/)).toBeVisible();
  fireEvent.submit(
    screen.getByRole("button", { name: "生成轮作方案" }).closest("form")!,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/先保存或放弃/);
  await user.click(screen.getByRole("button", { name: "放弃前茬修改" }));
  expect(screen.getByRole("button", { name: "生成轮作方案" })).toBeEnabled();
});
it("does not offer a duplicate new calculation while the current run is still running", () => {
  const draft = emptyDraft(profile);
  setup({
    id: "r",
    status: "running",
    request: { ...draft, idempotency_key: "r" },
  } as unknown as RunV2);
  expect(screen.getByRole("button", { name: "计算进行中" })).toBeDisabled();
});
