import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import AccountPage from "./page";
import { WorkspaceShell } from "@/components/workspace/shell";
import PersonalPage from "../page";
import LegacyNotificationsPage from "@/app/workspace/notifications/page";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), listNotifications: vi.fn(), changePassword: vi.fn(),
  signOut: vi.fn(), setAccessToken: vi.fn(), replace: vi.fn(), redirect: vi.fn(),
  success: vi.fn(), pathname: "/personal/account",
}));
vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return {
    usePathname: () => mocks.pathname,
    useRouter: () => router,
    redirect: mocks.redirect,
  };
});
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/client")>(),
  getCurrentUser: mocks.getCurrentUser, listNotifications: mocks.listNotifications,
  changePassword: mocks.changePassword, signOut: mocks.signOut, setAccessToken: mocks.setAccessToken,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/personal/account";
  mocks.getCurrentUser.mockResolvedValue({ id: "user-123", display_name: "测试用户", email: "test@example.com", email_verified: true });
  mocks.listNotifications.mockResolvedValue({ items: [], unread_count: 3 });
  mocks.changePassword.mockResolvedValue({ message: "Password changed" });
  mocks.signOut.mockResolvedValue(null);
});
afterEach(cleanup);

async function setupPassword(next = "new-password", confirm = next) {
  render(<AccountPage />);
  await screen.findByText("test@example.com");
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: confirm } });
}

describe("personal center", () => {
  it("shows account information and personal navigation with a workspace return link", async () => {
    render(<AccountPage />);
    await screen.findByText("test@example.com");
    expect(screen.queryByText("user-123")).toBeNull();
    expect(screen.queryByText("用户 ID")).toBeNull();
    expect(screen.getByText("已验证").getAttribute("data-slot")).toBe("badge");
    expect(screen.queryByText("8–256 个字符")).toBeNull();
    expect(screen.getByRole("link", { name: "个人中心：测试用户" }).getAttribute("href")).toBe("/personal/notifications");
    expect(screen.getByRole("link", { name: /ATLAS/ }).getAttribute("href")).toBe("/workspace/files");
    const nav = screen.getByRole("navigation", { name: "个人中心导航" });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(within(nav).getByRole("link", { name: "账号管理" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /消息列表/ }).textContent).toContain("3");
    // The only logout control belongs to account content, never the header.
    expect(screen.getAllByRole("button", { name: "退出登录" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "退出登录" }).closest("header")).toBeNull();
  });

  it("removes notifications from workspace navigation and the logout button from its header", async () => {
    mocks.pathname = "/workspace/files";
    render(<WorkspaceShell><p>Files</p></WorkspaceShell>);
    const personalLink = await screen.findByRole("link", { name: "个人中心：测试用户" });
    expect(personalLink.getAttribute("href")).toBe("/personal/notifications");
    const nav = screen.getByRole("navigation", { name: "工作区导航" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /消息列表/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  });

  it("redirects both the personal root and legacy notifications route to the new message list", () => {
    PersonalPage();
    LegacyNotificationsPage();
    expect(mocks.redirect.mock.calls).toEqual([["/personal/notifications"], ["/personal/notifications"]]);
  });

  it("requires authentication and preserves the personal destination", async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new ApiError(401, {
      code: "http_401", message: "Unauthorized", request_id: "test", details: null,
    }));
    render(<AccountPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Fpersonal%2Faccount&authRequired=1"));
    expect(screen.queryByLabelText("当前密码")).toBeNull();
  });

  it("does not treat a temporary profile request failure as a logged-out session", async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<WorkspaceShell><p>Files</p></WorkspaceShell>);
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled());
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Files")).toBeTruthy();
  });

  it.each(["short", "x".repeat(257)])("rejects invalid password length", async (password) => {
    await setupPassword(password);
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(screen.getByRole("alert").textContent).toContain("8–256");
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    await setupPassword("new-password", "different");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(screen.getByRole("alert").textContent).toContain("两次输入的新密码不一致");
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("shows wrong current password in Chinese and allows retry", async () => {
    mocks.changePassword.mockRejectedValueOnce(new ApiError(400, { code: "http_400", message: "Current password is invalid", request_id: "test", details: null }));
    await setupPassword();
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(screen.getByRole("alert").textContent).toContain("当前密码不正确");
    expect(mocks.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Fpersonal%2Faccount");
  });

  it("keeps the page usable after a network failure", async () => {
    mocks.changePassword.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await setupPassword();
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(screen.getByRole("alert").textContent).toContain("密码修改失败，请稍后重试");
    expect((screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.setAccessToken).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions and clears authentication after changing password", async () => {
    let finish!: (value: { message: string }) => void;
    mocks.changePassword.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await setupPassword();
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect((screen.getByRole("button", { name: "正在修改" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "退出登录" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("当前密码").closest("form")!);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith("old-password", "new-password");
    finish({ message: "Password changed" });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Fpersonal%2Faccount"));
    expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
    expect(mocks.success).toHaveBeenCalledWith("密码已修改，请重新登录");
  });

  it("retries failed logout and redirects only after success", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("Network error"));
    render(<AccountPage />);
    await screen.findByText("test@example.com");
    await userEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(screen.getByRole("alert").textContent).toContain("退出登录失败，请重试");
    expect(mocks.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("cancels logout without ending the session", async () => {
    render(<AccountPage />);
    await screen.findByText("test@example.com");
    await userEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.getByText("退出后，当前设备需要重新登录才能继续使用。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
