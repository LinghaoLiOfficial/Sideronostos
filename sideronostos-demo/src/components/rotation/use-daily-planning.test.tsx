import { cleanup, act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type {
  DailyProfile,
  DailyReadiness,
  DailyRun,
} from "@/lib/api/daily-types";
import * as api from "@/lib/api/daily";
import { useDailyPlanning } from "./use-daily-planning";
import { readPendingDaily } from "./daily-model";
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
  irrigation_available: true,
} as Field;
const farm = { id: "farm-a", partition_revision: "part-a" } as ServerFarmHeader;
const ready = { ready: true, fingerprint: "checked" } as DailyReadiness;
const run = {
  id: "run-a",
  request: { model_version: "rotation-milp-v3.0" },
} as DailyRun;
const options = () => ({
  owner: "alice",
  profile,
  fields: [field],
  farms: [farm],
  selectedFieldId: field.id,
  historyDirty: false,
  onRun: vi.fn(),
  onDraft: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

it("discards a late readiness response after the farmer changes conditions", async () => {
  const response = deferred<DailyReadiness>();
  vi.mocked(api.checkDailyReadiness).mockReturnValue(response.promise);
  const { result } = renderHook(() => useDailyPlanning(options()));
  act(() => {
    void result.current.check();
  });
  act(() =>
    result.current.replaceDraft({
      ...result.current.draft,
      accept_engineering_assumptions: true,
    }),
  );
  await act(async () => response.resolve(ready));
  expect(result.current.readiness).toBeNull();
  await act(async () => result.current.submit());
  expect(api.createDailyRun).not.toHaveBeenCalled();
});
it("retries the exact persisted request after uncertainty, even if the visible draft changes", async () => {
  vi.mocked(api.checkDailyReadiness).mockResolvedValue(ready);
  vi.mocked(api.createDailyRun)
    .mockRejectedValueOnce(new TypeError("Connection closed"))
    .mockResolvedValueOnce(run);
  const props = options();
  const { result } = renderHook(() => useDailyPlanning(props));
  await act(async () => result.current.check());
  await act(async () => result.current.submit());
  const pending = readPendingDaily("alice");
  expect(pending).not.toBeNull();
  act(() =>
    result.current.replaceDraft({
      ...result.current.draft,
      scenario: { rainfall_change_pct: -20, temperature_change_c: 0 },
    }),
  );
  await act(async () => result.current.submit());
  expect(api.createDailyRun).toHaveBeenCalledTimes(1);
  await act(async () => result.current.retryPending());
  expect(vi.mocked(api.createDailyRun).mock.calls[1]).toEqual([
    "alice",
    pending,
  ]);
  expect(readPendingDaily("alice")).toBeNull();
  expect(props.onRun).toHaveBeenCalledWith(run);
});
it("invalidates readiness when a saved field version changes", async () => {
  vi.mocked(api.checkDailyReadiness).mockResolvedValue(ready);
  const props = options();
  const { result, rerender } = renderHook((p) => useDailyPlanning(p), {
    initialProps: props,
  });
  await act(async () => result.current.check());
  expect(result.current.readiness?.ready).toBe(true);
  rerender({ ...props, fields: [{ ...field, version: 2 }] });
  expect(result.current.readiness).toBeNull();
  await act(async () => result.current.check());
  expect(result.current.error).toBe("地块版本已更新，请核对新资料并确认版本。");
  expect(api.checkDailyReadiness).toHaveBeenCalledTimes(1);
  await act(async () => result.current.submit());
  expect(api.createDailyRun).not.toHaveBeenCalled();
});
it("does not navigate an unmounted account after submission completes", async () => {
  vi.mocked(api.checkDailyReadiness).mockResolvedValue(ready);
  const pending = deferred<DailyRun>();
  vi.mocked(api.createDailyRun).mockReturnValue(pending.promise);
  const props = options();
  const { result, unmount } = renderHook(() => useDailyPlanning(props));
  await act(async () => result.current.check());
  act(() => {
    void result.current.submit();
  });
  await waitFor(() => expect(api.createDailyRun).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => pending.resolve(run));
  expect(props.onRun).not.toHaveBeenCalled();
  expect(readPendingDaily("bob")).toBeNull();
});

afterEach(cleanup);
