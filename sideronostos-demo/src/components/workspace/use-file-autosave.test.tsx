import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileAutosave } from "./use-file-autosave";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ saveWorkspaceFileContent: save }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { vi.useFakeTimers(); save.mockReset(); save.mockResolvedValue({}); });

describe("file autosave", () => {
  it("debounces edits and persists only the latest snapshot", async () => {
    const { result } = renderHook(() => useFileAutosave("personal", "file", {}));
    act(() => { result.current.change({ entries: [1] }); result.current.change({ entries: [2] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("personal", "file", { entries: [2] });
    expect(result.current.status).toBe("saved");
  });

  it("serializes overlapping edits and waits for all latest changes on flush", async () => {
    let resolveFirst!: (value: object) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useFileAutosave("group", "file", {}));
    act(() => result.current.change({ entries: [1] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => result.current.change({ entries: [2] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save).toHaveBeenCalledTimes(1);
    let flushed!: Promise<boolean>;
    act(() => { flushed = result.current.flush(); });
    await act(async () => { resolveFirst({}); expect(await flushed).toBe(true); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("group", "file", { entries: [2] });
    expect(result.current.status).toBe("saved");
  });

  it("retains failed edits for retry and flushes before the debounce expires", async () => {
    save.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useFileAutosave("group", "file", {}));
    act(() => result.current.change({ entries: [1] }));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(result.current.status).toBe("error");
    await act(async () => { expect(await result.current.flush()).toBe(true); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
