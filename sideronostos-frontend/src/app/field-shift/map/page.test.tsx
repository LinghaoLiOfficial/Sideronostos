import { expect, it, vi } from "vitest";
import MapPage from "./page";
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));
it("redirects old map links to the unified map while preserving owned context and dates", async () => {
  const params = {
    field: "field-a",
    run: "run-a",
    option: "option-2",
    plan: "saved-a",
    selection: "aoi-a",
    layer: "release:am",
    compare: "run-b",
    compareOption: "option-1",
    obsStart: "2026-11-07",
    obsEnd: "2026-11-07",
    from: ["规划", "saved"],
  };
  await MapPage({ searchParams: Promise.resolve(params) });
  expect(navigation.redirect).toHaveBeenCalledOnce();
  const url = new URL(
    navigation.redirect.mock.calls[0][0],
    "https://local.example",
  );
  expect(url.pathname).toBe("/fields");
  for (const [key, value] of Object.entries(params))
    expect(url.searchParams.getAll(key)).toEqual(
      Array.isArray(value) ? value : [value],
    );
});
