import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "./page";

const api = vi.hoisted(() => ({
  deleteNotifications: vi.fn(),
  getCurrentUser: vi.fn(),
  getDirectInvitation: vi.fn(),
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  respondDirectInvitation: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/personal/notifications",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api/client", () => api);

const notifications = [
  {
    id: "notification-1",
    type: "group_role_changed",
    title: "权限变更",
    body: "群主已将你的权限修改为管理员。",
    payload: {},
    created_at: "2026-10-11T03:00:00Z",
    read_at: null,
    invitation_id: null,
    group_id: "group-1",
  },
  {
    id: "notification-2",
    type: "general",
    title: "系统消息",
    body: "这是一条已读消息。",
    payload: {},
    created_at: "2026-10-10T03:00:00Z",
    read_at: "2026-10-10T04:00:00Z",
    invitation_id: null,
    group_id: null,
  },
];

let unreadCount = 1;

beforeEach(() => {
  unreadCount = 1;
  api.getCurrentUser.mockResolvedValue({ id: "user-1", display_name: "测试用户" });
  api.listNotifications.mockImplementation(() => Promise.resolve({
    items: notifications.map((item) => item.id === "notification-1" && unreadCount === 0
      ? { ...item, read_at: "2026-10-11T04:00:00Z" }
      : item),
    unread_count: unreadCount,
  }));
  api.markNotificationRead.mockImplementation(() => {
    unreadCount = 0;
    return Promise.resolve(null);
  });
  api.markAllNotificationsRead.mockResolvedValue(null);
  api.deleteNotifications.mockResolvedValue(null);
  api.signOut.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationsPage", () => {
  it("highlights unread rows and opens notification details from the row", async () => {
    const user = userEvent.setup();
    render(<NotificationsPage />);

    const unreadRowButton = await screen.findByRole("button", { name: "查看消息：权限变更" });
    expect(unreadRowButton.parentElement?.className).toContain("notification-row");
    expect(unreadRowButton.parentElement?.getAttribute("data-unread")).toBe("true");
    expect(screen.getByRole("button", { name: "查看消息：系统消息" }).parentElement?.getAttribute("data-unread")).toBe("false");
    expect(unreadRowButton.parentElement?.getAttribute("style")).toContain("background-color: rgb(64, 35, 90)");
    const notificationNavLink = screen.getByRole("link", { name: /消息列表/ });
    expect(within(notificationNavLink).getByText("1")).toBeTruthy();

    await user.hover(unreadRowButton);
    expect(unreadRowButton.parentElement?.getAttribute("style")).toContain("background-color: rgb(81, 39, 70)");
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();

    await user.click(unreadRowButton);

    const dialog = screen.getByRole("dialog", { name: "通知详情" });
    expect(within(dialog).getByText("群主已将你的权限修改为管理员")).toBeTruthy();
    expect(api.markNotificationRead).toHaveBeenCalledWith("notification-1");
    await waitFor(() => expect(within(notificationNavLink).queryByText("1")).toBeNull());
  });

  it("selects multiple messages and deletes them after confirmation", async () => {
    const user = userEvent.setup();
    render(<NotificationsPage />);

    await user.click(await screen.findByRole("button", { name: "选择消息" }));
    await user.click(screen.getByRole("checkbox", { name: "选择消息：权限变更" }));
    await user.click(screen.getByRole("checkbox", { name: "选择消息：系统消息" }));
    await user.click(screen.getByRole("button", { name: "删除所选 (2)" }));

    const dialog = screen.getByRole("dialog", { name: "删除所选消息？" });
    expect(within(dialog).getByText(/删除 2 条记录/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(api.deleteNotifications).toHaveBeenCalledWith([
      "notification-1",
      "notification-2",
    ]));
  });
});
