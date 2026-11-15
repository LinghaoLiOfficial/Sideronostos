import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@/lib/api/daily";
import type { AnyRotationRun, AnySavedPlan } from "@/lib/api/daily-types";
import { useRotationSnapshots } from "./use-rotation-snapshots";
vi.mock("@/lib/api/daily", () => ({ getAnyPlan: vi.fn(), getAnyRun: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getAnyPlan).mockResolvedValue({
    id: "saved",
    run_id: "frozen-run",
  } as AnySavedPlan);
  vi.mocked(api.getAnyRun).mockImplementation(
    async (_owner, id) => ({ id, status: "optimal" }) as AnyRotationRun,
  );
});
afterEach(cleanup);
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
it.each([null, "different-run"])(
  "restores the saved plan's run when the URL run is %s",
  async (requested) => {
    const { result } = renderHook(
      () => useRotationSnapshots("alice", requested, "saved"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.run.data?.id).toBe("frozen-run"));
    expect(api.getAnyRun).toHaveBeenCalledTimes(1);
    expect(api.getAnyRun).toHaveBeenCalledWith("alice", "frozen-run");
  },
);
it("does not query a URL run while a saved plan is still loading", async () => {
  vi.mocked(api.getAnyPlan).mockImplementation(() => new Promise(() => {}));
  renderHook(() => useRotationSnapshots("alice", "different-run", "saved"), {
    wrapper,
  });
  await waitFor(() => expect(api.getAnyPlan).toHaveBeenCalled());
  expect(api.getAnyRun).not.toHaveBeenCalled();
});
it("does not load owned snapshots without a signed-in owner", () => {
  renderHook(() => useRotationSnapshots(null, "run", "saved"), { wrapper });
  expect(api.getAnyPlan).not.toHaveBeenCalled();
  expect(api.getAnyRun).not.toHaveBeenCalled();
});
