import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FieldsContext } from "./use-fields-context";
import { FieldsEvidencePanel } from "./fields-evidence-panel";
afterEach(cleanup);
it("lets the user clear an inaccessible AOI without changing the owned field or observation dates", () => {
  const navigate = vi.fn(),
    query = { data: undefined, isError: false, isFetching: false };
  const context = {
    navigation: {
      search: new URLSearchParams(
        "field=owned&selection=foreign&obsStart=2026-11-07&obsEnd=2026-11-07",
      ),
      navigate,
    },
    window: { dates: { start: "2026-11-07", end: "2026-11-07" } },
    selection: {
      ...query,
      isError: true,
      error: new Error("Selection not found"),
      refetch: vi.fn(),
    },
    facts: query,
    layers: query,
    manifest: query,
    run: query,
    saved: query,
  } as unknown as FieldsContext;
  render(
    <FieldsEvidencePanel
      context={context}
      mapRef={{ current: null }}
      ownerId="new-owner"
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Selection not found");
  fireEvent.click(screen.getByRole("button", { name: "清除不可用选区" }));
  expect(navigate).toHaveBeenCalledWith({ selection: null });
});
