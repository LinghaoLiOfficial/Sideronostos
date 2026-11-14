import { ApiError } from "@/lib/api/client";
import type { Locale } from "@/lib/i18n/locale";

export function authErrorMessage(error: unknown, locale: Locale = "zh-CN") {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      invalid_credentials: "邮箱或密码不正确",
      email_not_verified: "请先完成邮箱验证后再登录",
      email_already_registered: "该邮箱已经注册，请直接登录",
      email_delivery_failed: "验证邮件发送失败，请稍后重试",
      verification_token_expired: "验证链接已过期，请重新发送验证邮件",
      invalid_verification_token: "验证链接无效或已经使用",
      validation_error: "请检查填写的信息",
    };
    const backendMessages: Record<string, string> = {
      "Current password is invalid": "当前密码不正确",
      "Password is too short": "新密码至少需要 8 个字符",
      "Invalid credentials": "邮箱或密码不正确",
      "Email verification is required": "请先完成邮箱验证后再登录",
      "Invalid or expired token": "验证链接无效、已过期或已经使用",
      "Authentication required": "登录状态已失效，请重新登录",
      "Session is no longer valid": "登录状态已失效，请重新登录",
      "Origin is not allowed": "当前页面来源不在后端允许列表中",
      "CSRF validation failed": "安全校验失败，请刷新页面后重试",
    };
    const message = messages[error.error.code] ?? backendMessages[error.error.message] ?? error.error.message;
    if (locale === "en") {
      const english: Record<string, string> = { "邮箱或密码不正确": "Incorrect email or password", "请先完成邮箱验证后再登录": "Please verify your email before signing in", "登录状态已失效，请重新登录": "Your session has expired. Please sign in again", "请求失败，请稍后重试": "Request failed. Please try again later" };
      return english[message] ?? message;
    }
    return message;
  }
  return error instanceof Error ? error.message : locale === "en" ? "Request failed. Please try again later" : "请求失败，请稍后重试";
}

export function safeNextPath(value: string | null) {
  const fallback = "/workspace/files";
  if (!value?.startsWith("/")) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("\\") || [...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return fallback;
    return new URL(value, "https://agrisata.invalid").origin === "https://agrisata.invalid" ? value : fallback;
  } catch { return fallback; }
}

export function registrationNextPath(value: string | null) {
  const next = safeNextPath(value);
  const path = next.split(/[?#]/, 1)[0];
  if (next.length > 2048 || path.includes("%") || path.split("/").some((part) => part === "." || part === "..")) return "/workspace/files";
  return ["/field-shift", "/workspace", "/personal"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? next : "/workspace/files";
}

export function authHref(route: "/login" | "/register" | "/verify-email", next: string | null, values: Record<string, string> = {}) {
  const params = new URLSearchParams(values);
  if (next) params.set("next", route === "/login" ? safeNextPath(next) : registrationNextPath(next));
  return `${route}${params.size ? `?${params}` : ""}`;
}

export function isFieldShiftDestination(next: string | null) {
  return new URL(safeNextPath(next), "https://agrisata.invalid").pathname === "/field-shift";
}
