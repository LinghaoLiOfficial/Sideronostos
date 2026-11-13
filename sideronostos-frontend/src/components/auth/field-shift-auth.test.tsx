import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import VerifyEmailPage from "@/app/verify-email/page";
import { safeNextPath, registrationNextPath } from "./utils";

const mocks = vi.hoisted(() => ({ query: "", getCurrentUser: vi.fn(), signUp: vi.fn(), verifyEmail: vi.fn(), resendVerification: vi.fn(), signIn: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/lib/api/client", () => ({ ApiError: class extends Error {}, getCurrentUser: mocks.getCurrentUser, signUp: mocks.signUp, verifyEmail: mocks.verifyEmail, resendVerification: mocks.resendVerification, signIn: mocks.signIn }));
beforeEach(() => { mocks.getCurrentUser.mockRejectedValue(new Error("not signed in")); mocks.signUp.mockResolvedValue({ message: "sent" }); mocks.verifyEmail.mockResolvedValue({ message: "verified" }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.query = ""; });
describe("Field Shift account entry", () => {
  it("keeps the farming destination and context on the registration link", () => {
    mocks.query = new URLSearchParams({ next: "/field-shift?field=field-1&step=planning" }).toString();
    render(<LoginPage />);
    const href = screen.getByRole("link", { name: "立即注册" }).getAttribute("href")!;
    expect(new URL(href, "http://test").searchParams.get("next")).toBe("/field-shift?field=field-1&step=planning");
    expect(screen.getByRole("heading", { name: /为下一轮种植/ })).toBeInTheDocument();
  });
  it("passes a safe return destination to verification email creation and the waiting page", async () => {
    mocks.query = "next=%2Ffield-shift";
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "种植者" } });
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "farmer@example.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith("farmer@example.test", "password123", "种植者", "/field-shift"));
    expect(new URL(mocks.push.mock.calls[0][0], "http://test").searchParams.get("next")).toBe("/field-shift");
  });
  it("returns to Field Shift after email verification instead of losing the destination", async () => {
    mocks.query = "token=valid&next=%2Ffield-shift";
    render(<VerifyEmailPage />);
    const href = (await screen.findByRole("link", { name: "前往登录" })).getAttribute("href")!;
    expect(new URL(href, "http://test").searchParams.get("next")).toBe("/field-shift");
  });
  it("rejects external, protocol-relative, encoded and backslash redirects", () => {
    for (const next of ["https://evil.test", "//evil.test", "/\\evil.test", "/%5Cevil.test", "/%2Fevil.test", "/field-shift\n"]) expect(safeNextPath(next)).toBe("/workspace/files");
    expect(registrationNextPath("/personal/account")).toBe("/personal/account");
    expect(registrationNextPath("/unrelated-route")).toBe("/workspace/files");
  });
  it("matches the verification backend's return-path rules without removing safe query and hash values", () => {
    for (const next of ["/workspace/../field-shift", "/field-shift/./plan", "/field-shift/%70lan", "/field-shift/%2e%2e/personal", `/field-shift?x=${"a".repeat(2048)}`]) expect(registrationNextPath(next)).toBe("/workspace/files");
    expect(registrationNextPath("/field-shift?field=abc&name=%E8%A5%BF%E7%94%B0#plan")).toBe("/field-shift?field=abc&name=%E8%A5%BF%E7%94%B0#plan");
    expect(registrationNextPath("/personal/account#security")).toBe("/personal/account#security");
  });
});
