import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Field } from "@/lib/api/field-shift-types";
import type { ProfileV2 } from "@/lib/api/rotation-types";
import { HistoryEditor } from "./history-editor";
import { updateField } from "@/lib/api/field-shift";
vi.mock("@/lib/api/field-shift", () => ({ updateField: vi.fn() }));

it("does not apply a late history response after the owner workspace has unmounted", async () => {
  const field = {
    id: "f",
    name: "North",
    version: 1,
    history: [],
    history_events: [],
  } as unknown as Field;
  const profile = {
    id: "p",
    crops: [{ id: "pea", name: "豌豆" }],
    history_catalogue: { pea: "Fabaceae" },
  } as unknown as ProfileV2;
  let finish!: (field: Field) => void;
  vi.mocked(updateField).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onSaved = vi.fn();
  const view = render(
    <HistoryEditor
      field={field}
      profile={profile}
      onSaved={onSaved}
      onDirtyChange={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("查看 / 补充前茬记录"));
  await user.click(screen.getByRole("button", { name: "新增前茬" }));
  await user.click(screen.getByRole("button", { name: "保存前茬记录" }));
  view.unmount();
  await act(async () => {
    finish({ ...field, version: 2 });
  });
  expect(onSaved).not.toHaveBeenCalled();
});
