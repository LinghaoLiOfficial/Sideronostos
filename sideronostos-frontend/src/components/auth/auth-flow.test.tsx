import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RegisterPage from "@/app/register/page";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {},
  getCurrentUser: mocks.getCurrentUser,
  signUp: mocks.signUp,
}));

beforeEach(() => {
  mocks.getCurrentUser.mockRejectedValue(new Error("not authenticated"));
  mocks.signUp.mockResolvedValue({ message: "accepted" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("registration flow", () => {
  it("rejects passwords shorter than the backend minimum", async () => {
    render(<RegisterPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "测试用户");
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "1234567");
    await user.type(screen.getByLabelText("确认密码"), "1234567");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    expect(await screen.findByText("密码至少需要 8 位")).toBeTruthy();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("accepts a password at the eight-character minimum", async () => {
    render(<RegisterPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "测试用户");
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "12345678");
    await user.type(screen.getByLabelText("确认密码"), "12345678");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    expect(mocks.signUp).toHaveBeenCalledWith("user@example.com", "12345678", "测试用户");
  });

  it("submits a valid registration and opens the verification page", async () => {
    render(<RegisterPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "测试用户");
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.type(screen.getByLabelText("确认密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    expect(mocks.signUp).toHaveBeenCalledWith(
      "user@example.com",
      "a-secure-password",
      "测试用户",
    );
    expect(mocks.push).toHaveBeenCalledWith("/verify-email?email=user%40example.com");
  });
});
