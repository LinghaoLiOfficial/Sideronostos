import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroupProjectPage from "./page";

const api = vi.hoisted(() => ({ getGroup: vi.fn(), getWorkspaceFile: vi.fn(), saveWorkspaceFileContent: vi.fn() }));
const gantt = vi.hoisted(() => ({ onChange: null as null | ((snapshot: { taskData: unknown[]; edgeData: unknown[] }) => void) }));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupId: "group-1", projectId: "project-1" }),
  useRouter: () => navigation,
}));
vi.mock("@/lib/api/client", () => api);
vi.mock("@/components/gantt", () => ({
  GanttChart: (props: { onChange: (snapshot: { taskData: unknown[]; edgeData: unknown[] }) => void }) => {
    gantt.onChange = props.onChange;
    return <button type="button" onClick={() => props.onChange({ taskData: [{ id: "task-1" }], edgeData: [] })}>编辑甘特图</button>;
  },
}));

beforeEach(() => { api.getGroup.mockResolvedValue({ id: "group-1", name: "科研协作组" }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("GroupProjectPage", () => {
  it("loads a project snapshot and autosaves gantt changes", async () => {
    api.getWorkspaceFile.mockResolvedValue({ id: "project-1", name: "研究计划", type: "gantt", content: { taskData: [], edgeData: [] } });
    api.saveWorkspaceFileContent.mockResolvedValue({});
    render(<GroupProjectPage />);

    expect(await screen.findByRole("heading", { name: "科研协作组" })).toBeTruthy();
    expect(api.getGroup).toHaveBeenCalledWith("group-1");
    expect(screen.queryByRole("heading", { name: "研究计划" })).toBeNull();
    const ganttWrapper = screen.getByRole("button", { name: "编辑甘特图" }).parentElement;
    expect(ganttWrapper?.className).toContain("overflow-hidden");
    expect(ganttWrapper?.className).not.toMatch(/rounded|border|bg-|p-3|p-5/);
    fireEvent.click(screen.getByRole("button", { name: "编辑甘特图" }));
    await waitFor(() => expect(api.saveWorkspaceFileContent).toHaveBeenCalledWith("group-1", "project-1", { taskData: [{ id: "task-1" }], edgeData: [] }), { timeout: 2500 });
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("shows a failure and retries the latest snapshot", async () => {
    const user = userEvent.setup();
    api.getWorkspaceFile.mockResolvedValue({ id: "project-1", name: "研究计划", type: "gantt", content: { taskData: [], edgeData: [] } });
    api.saveWorkspaceFileContent.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    render(<GroupProjectPage />);

    await screen.findByRole("heading", { name: "科研协作组" });
    fireEvent.click(screen.getByRole("button", { name: "编辑甘特图" }));
    const retry = await screen.findByRole("button", { name: "重试" }, { timeout: 2500 });
    await user.click(retry);
    await waitFor(() => expect(api.saveWorkspaceFileContent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });
});
