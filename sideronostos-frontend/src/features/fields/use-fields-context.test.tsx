import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "@/components/rotation/__fixtures__/daily-execution-ui.json";
import type { FieldFeature } from "@/types/workspace";
import { useFieldsContext } from "./use-fields-context";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
}));
const input = fixture.input_snapshot;
const frozen = { ...input.fields[0], id: "field-a", version: 1, name: "Frozen field" };
const run = {
  id: "run-a", job_id: "job-a", status: "optimal", generation: 1,
  created_at: "2026-11-14T01:00:00Z", updated_at: "2026-11-14T01:00:01Z",
  request: input.request, field_snapshots: [frozen], provenance: input.provenance,
  result: fixture.result,
};
const saved = {
  id: "plan-a", run_id: "run-a", option_id: "option-1", title: "Saved field plan",
  schema: "rotation-saved-v3.0", created_at: "2026-11-14T01:01:00Z",
  input_snapshot: { ...input, fields: [frozen] }, option: fixture.result.options[0],
  notes: "Engineering scenario", run_created_at: run.created_at,
};
const field: FieldFeature = {
  type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
  properties: {
    id: "local-a", farmId: "farm-a", name: "Edited field", status: "confirmed",
    partitionIndex: 0, backendFieldId: "field-a", backendVersion: 2, syncStatus: "synced",
  },
} as FieldFeature;
let requests: string[];
let missingPlan: boolean;
beforeEach(() => {
  requests = []; missingPlan = false; nav.search = ""; vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    requests.push(path);
    if (path === "/agri-data/layers") return Response.json({ items: [] });
    if (path === "/rotation-optimizer/plans/plan-a" && !missingPlan) return Response.json(saved);
    if (path === "/rotation-optimizer/runs/run-a") return Response.json(run);
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(owner: string | null = "alice") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(({ currentOwner }) => useFieldsContext(currentOwner, field, false), {
    initialProps: { currentOwner: owner }, wrapper,
  });
}

it.each(["plan=plan-a", "plan=plan-a&run=unrelated-run&option=unrelated-option"])(
  "binds %s to its saved run and option, retaining the frozen field version",
  async (search) => {
    nav.search = search;
    const { result } = setup();
    await waitFor(() => expect(result.current.contextPending).toBe(false));
    expect(result.current.context).toMatchObject({
      run_id: "run-a", option_id: "option-1", plan_id: "plan-a", fields: [],
      draft: { dirty: false },
    });
    expect(result.current.run.data?.field_snapshots).toEqual([frozen]);
    expect(result.current.contextLabel).toContain("Frozen field");
    expect(requests).not.toContain("/rotation-optimizer/runs/unrelated-run");
  },
);
it("blocks a missing saved plan instead of falling back to the URL run or current field", async () => {
  nav.search = "plan=plan-a&run=run-a"; missingPlan = true;
  const { result } = setup();
  await waitFor(() => expect(result.current.saved.isError).toBe(true));
  expect(result.current.contextPending).toBe(true);
  expect(result.current.context.run_id).toBeNull();
  expect(requests).not.toContain("/rotation-optimizer/runs/run-a");
});
it("blocks an option that is absent from the bound run", async () => {
  nav.search = "run=run-a&option=missing-option";
  const { result } = setup();
  await waitFor(() => expect(result.current.run.isSuccess).toBe(true));
  expect(result.current.contextPending).toBe(true);
  expect(result.current.contextError).toBeTruthy();
});
it("keeps run-only evidence frozen and marks today's field version as changed", async () => {
  nav.search = "run=run-a&option=option-1&compare=run-b&compareOption=option-2";
  const { result } = setup();
  await waitFor(() => expect(result.current.contextPending).toBe(false));
  expect(result.current.context).toMatchObject({
    run_id: "run-a", option_id: "option-1", fields: [],
    compare_run_id: "run-b", compare_option_id: "option-2",
    draft: { dirty: true, changed_fields: ["fields"] },
  });
});
it("does not reuse owned saved evidence after logout", async () => {
  nav.search = "plan=plan-a";
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.contextPending).toBe(false));
  rerender({ currentOwner: null });
  expect(result.current.context.run_id).toBeNull();
  expect(result.current.run.data).toBeUndefined();
  expect(result.current.saved.data).toBeUndefined();
});
