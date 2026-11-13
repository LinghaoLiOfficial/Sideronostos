import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceFilesManager } from "./files-manager";

// Radix Select uses browser pointer and scrolling APIs absent in jsdom.
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: () => {} });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });

const api = vi.hoisted(() => ({ listWorkspaceFiles: vi.fn(), createWorkspaceFile: vi.fn(), renameWorkspaceFile: vi.fn(), deleteWorkspaceFile: vi.fn() }));
vi.mock("@/lib/api/client", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
afterEach(cleanup);

const vocabulary = { id: "v1", name: "词汇本", type: "vocabulary", updated_at: "2026-10-12T01:00:00Z", creator_display_name: "Ada" };
beforeEach(() => {
  vi.clearAllMocks();
  api.listWorkspaceFiles.mockImplementation(async (_organization, params) => ({ items: params.type === "vocabulary" ? [vocabulary] : [], total: params.type === "vocabulary" ? 1 : 0, total_pages: 1 }));
  api.createWorkspaceFile.mockResolvedValue(vocabulary);
  api.renameWorkspaceFile.mockResolvedValue(vocabulary);
  api.deleteWorkspaceFile.mockResolvedValue(null);
});

describe("vocabulary file management", () => {
  it.each(["personal-1", "group-1"])("creates, opens, renames and deletes vocabulary files in %s", async (organizationId) => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<WorkspaceFilesManager organizationId={organizationId} title="文件" description="" showHeader={false} showCreator={organizationId === "group-1"} onOpenFile={open} />);
    await user.click(await screen.findByRole("button", { name: "打开 词汇本" }));
    expect(open).toHaveBeenCalledWith(vocabulary);
    if (organizationId === "group-1") expect(screen.getByText("创建者：Ada")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建文件" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("文件名称"), "英语词汇");
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "词汇库" }));
    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(api.createWorkspaceFile).toHaveBeenCalledWith(organizationId, { name: "英语词汇", type: "vocabulary" }));
    await user.click(screen.getByRole("button", { name: "词汇本 操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    await user.clear(within(screen.getByRole("dialog")).getByRole("textbox"));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "新词汇本");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.renameWorkspaceFile).toHaveBeenCalledWith(organizationId, "v1", "新词汇本"));
    await user.click(screen.getByRole("button", { name: "词汇本 操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(api.deleteWorkspaceFile).toHaveBeenCalledWith(organizationId, "v1"));
  });

  it("filters and paginates vocabulary files and includes them in the combined list", async () => {
    const user = userEvent.setup();
    api.listWorkspaceFiles.mockImplementation(async (_organization, params) => ({ items: params.type === "vocabulary" ? [vocabulary] : [], total: params.type === "vocabulary" ? 13 : 0, total_pages: params.type === "vocabulary" ? 2 : 1 }));
    render(<WorkspaceFilesManager organizationId="group-1" title="文件" description="" showHeader={false} onOpenFile={vi.fn()} />);
    await screen.findByRole("button", { name: "打开 词汇本" });
    expect(api.listWorkspaceFiles).toHaveBeenCalledWith("group-1", expect.objectContaining({ type: "vocabulary", page_size: 100 }));
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "词汇库" }));
    await waitFor(() => expect(api.listWorkspaceFiles).toHaveBeenCalledWith("group-1", expect.objectContaining({ type: "vocabulary", page: 1, page_size: 12 })));
    await user.click(await screen.findByRole("link", { name: "Go to next page" }));
    await waitFor(() => expect(api.listWorkspaceFiles).toHaveBeenCalledWith("group-1", expect.objectContaining({ type: "vocabulary", page: 2, page_size: 12 })));
  });
});
