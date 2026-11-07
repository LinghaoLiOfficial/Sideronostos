import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroupDetailPage from "./page";

Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });

const api = vi.hoisted(() => ({
  getGroup: vi.fn(),
  listGroupMembers: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  createWorkspaceFile: vi.fn(),
  renameWorkspaceFile: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  ensureGroupTaskPlanning: vi.fn(),
  getCurrentUser: vi.fn(),
  getGroupMemberSchedule: vi.fn(),
  listNotifications: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupId: "group-1" }),
  usePathname: () => "/workspace/groups/group-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: api.push, replace: vi.fn() }),
}));

vi.mock("@/lib/api/client", () => ({
  ...api,
  changeGroupRole: vi.fn(),
  createGroupInviteLink: vi.fn(),
  createWorkspaceFile: api.createWorkspaceFile,
  renameWorkspaceFile: api.renameWorkspaceFile,
  deleteWorkspaceFile: api.deleteWorkspaceFile,
  ensureGroupTaskPlanning: api.ensureGroupTaskPlanning,
  disbandGroup: vi.fn(),
  inviteGroupUser: vi.fn(),
  leaveGroup: vi.fn(),
  removeGroupMember: vi.fn(),
  renameGroup: vi.fn(),
  saveGroupPersonalScheduleDay: vi.fn(),
  searchUsers: vi.fn(),
  signOut: vi.fn(),
}));

afterEach(cleanup);

describe("GroupDetailPage member schedules", () => {
  beforeEach(() => {
    api.getGroup.mockResolvedValue({ id: "group-1", name: "研究小组", role: "owner", member_count: 2 });
    api.listGroupMembers.mockResolvedValue({ items: [
      { id: "member-1", display_name: "Ada", email: "ada@example.com", role: "owner" },
      { id: "member-2", display_name: "Lin", email: "lin@example.com", role: "member" },
    ] });
    api.listWorkspaceFiles.mockResolvedValue({ items: [] });
    api.getCurrentUser.mockResolvedValue({ id: "member-1", display_name: "Ada", email: "ada@example.com", email_verified: true });
    api.getGroupMemberSchedule.mockResolvedValue({ year: new Date().getFullYear(), days: {} });
    api.listNotifications.mockResolvedValue({ unread_count: 0 });
  });

  it("switches between the own and other-member schedule cards", async () => {
    const user = userEvent.setup();
    const year = new Date().getFullYear();
    render(<GroupDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "成员日程" }));
    await screen.findByRole("tab", { name: "我" });
    await waitFor(() => expect(api.getGroupMemberSchedule).toHaveBeenCalledWith("group-1", "member-1", year));
    expect(screen.getByLabelText("Ada的个人日程表")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "其他成员" }));
    expect(screen.getByLabelText("搜索其他成员")).toBeTruthy();
    expect(screen.queryByLabelText("Ada的个人日程表")).toBeNull();

    await user.type(screen.getByLabelText("搜索其他成员"), "Lin");
    await user.click(screen.getByRole("option", { name: /Lin/ }));
    await waitFor(() => expect(api.getGroupMemberSchedule).toHaveBeenCalledWith("group-1", "member-2", year));
    expect(screen.getByLabelText("Lin的个人日程表")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "我" }));
    await waitFor(() => expect(screen.getByLabelText("Ada的个人日程表")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: `${year}-01-01：0 个事项` }));
    expect(screen.getByRole("button", { name: "编辑日期事项" })).toBeTruthy();
  });

  it("puts the current user first, then sorts members by role and display name", async () => {
    api.listGroupMembers.mockResolvedValue({ items: [
      { id: "member-z", display_name: "周普通", email: "zhou-member@example.com", role: "member" },
      { id: "owner-z", display_name: "周所有者", email: "zhou-owner@example.com", role: "owner" },
      { id: "admin-z", display_name: "周管理员", email: "zhou-admin@example.com", role: "admin" },
      { id: "member-a", display_name: "安普通", email: "an-member@example.com", role: "member" },
      { id: "admin-a", display_name: "安管理员", email: "an-admin@example.com", role: "admin" },
      { id: "member-me", display_name: "我自己", email: "me@example.com", role: "member" },
    ] });
    api.getCurrentUser.mockResolvedValue({ id: "member-me", display_name: "我自己", email: "me@example.com", email_verified: true });

    render(<GroupDetailPage />);

    await screen.findByText("me@example.com");
    const orderedEmails = [
      "me@example.com",
      "zhou-owner@example.com",
      "an-admin@example.com",
      "zhou-admin@example.com",
      "an-member@example.com",
      "zhou-member@example.com",
    ];
    const positions = orderedEmails.map((email) => screen.getByText(email));
    positions.slice(1).forEach((element, index) => {
      expect(positions[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    const currentUserMarkers = screen.getAllByText("（我）");
    expect(currentUserMarkers).toHaveLength(1);
    expect(currentUserMarkers[0].parentElement?.textContent).toBe("我自己（我）");
  });

  it("opens one group task-planning gantt instance", async () => {
    const user = userEvent.setup();
    api.ensureGroupTaskPlanning.mockResolvedValue({ id: "project-1", name: "任务规划", type: "gantt" });
    render(<GroupDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "任务规划" }));
    await user.click(screen.getByRole("button", { name: "进入任务规划" }));
    await waitFor(() => expect(api.ensureGroupTaskPlanning).toHaveBeenCalledWith("group-1"));
    expect(api.push).toHaveBeenCalledWith("/workspace/groups/group-1/projects/project-1");
    expect(screen.queryByText("项目管理")).toBeNull();
  });

  it("uses the shared file manager for group files and keeps projects out of the file list", async () => {
    const user = userEvent.setup();
    api.listWorkspaceFiles.mockResolvedValue({ items: [
      { id: "project-1", name: "项目记录", type: "gantt", updated_at: "2026-10-01T00:00:00Z" },
      { id: "file-1", name: "研究笔记", type: "mindmap", creator_display_name: "Ada", updated_at: "2026-10-01T00:00:00Z" },
    ], total_pages: 1 });
    api.createWorkspaceFile.mockResolvedValue({ id: "file-2" });
    api.deleteWorkspaceFile.mockResolvedValue(null);
    render(<GroupDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "群组文件" }));
    expect(await screen.findByText("研究笔记")).toBeTruthy();
    expect(screen.getByText("创建者：Ada").className).toContain("text-[#C4A1FF]");
    expect(screen.getByText("创建者：Ada").className).toContain("mt-4");
    expect(screen.getByText(/更新于/).className).toContain("mt-1");
    expect(screen.queryByText("项目记录")).toBeNull();
    await user.click(screen.getByRole("button", { name: "研究笔记 操作" }));
    await user.click(screen.getByRole("menuitem", { name: /重命名/ }));
    await user.clear(screen.getByRole("dialog").querySelector("input")!);
    await user.type(screen.getByRole("dialog").querySelector("input")!, "更新笔记");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.renameWorkspaceFile).toHaveBeenCalledWith("group-1", "file-1", "更新笔记"));

    await user.click(screen.getAllByRole("button", { name: "新建文件" })[0]);
    await user.type(screen.getByLabelText("文件名称"), "新群组导图");
    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(api.createWorkspaceFile).toHaveBeenCalledWith("group-1", { name: "新群组导图", type: "mindmap" }));

    await user.click(screen.getByRole("button", { name: "研究笔记 操作" }));
    await user.click(screen.getByRole("menuitem", { name: /删除/ }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(api.deleteWorkspaceFile).toHaveBeenCalledWith("group-1", "file-1"));
  });

  it("opens a group mindmap with its organization and a group-files return route", async () => {
    const user = userEvent.setup();
    api.listWorkspaceFiles.mockResolvedValue({ items: [
      { id: "file-1", name: "研究笔记", type: "mindmap", updated_at: "2026-10-01T00:00:00Z" },
    ], total_pages: 1 });
    render(<GroupDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "群组文件" }));
    await user.click(await screen.findByRole("button", { name: "打开 研究笔记" }));

    expect(api.push).toHaveBeenCalledWith("/workspace/files/file-1?organization=group-1&returnTo=%2Fworkspace%2Fgroups%2Fgroup-1%3Ftab%3Dfiles");
  });
});
