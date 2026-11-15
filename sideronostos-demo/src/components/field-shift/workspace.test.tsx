import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldShiftWorkspace } from "./workspace";
import { setAccessToken } from "@/lib/api/client";
import { alternative, analysis, environment, field, profile } from "./fixtures.test-helper";

const navigation = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
const scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.query), useRouter: () => ({ replace: navigation.replace }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setAccessToken(null); navigation.query = ""; navigation.replace.mockClear(); scrollIntoView.mockClear(); sessionStorage.clear(); });
describe("field workspace authentication", () => {
  it.each(["Escape", "saved route"])("keeps keyboard focus in the save dialog and restores the appropriate target after %s", async (completion) => {
    navigation.query = "field=field-1&step=comparison&analysis=analysis-1";
    const saved = { id: "keyboard-plan", title: "键盘计划", notes: "", created_at: "2026-11-01T00:00:00Z", field_id: field.id, field_name: field.name, option: alternative, analysis, field_snapshot: field };
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field] }));
      if (url.pathname.includes("/analyses/")) return new Response(JSON.stringify(analysis));
      if (url.pathname.endsWith("/plans")) return new Response(JSON.stringify(saved), { status: 201 });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    const keyboard = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "保存轮作选择 1" });
    trigger.focus();
    await keyboard.keyboard("{Enter}");
    expect(screen.getByLabelText("计划名称")).toHaveFocus();
    await keyboard.tab({ shift: true });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await keyboard.tab();
    expect(screen.getByLabelText("计划名称")).toHaveFocus();
    if (completion === "Escape") {
      await keyboard.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
    } else {
      await keyboard.click(screen.getByRole("button", { name: "确认保存计划" }));
      await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
      navigation.query = new URL(navigation.replace.mock.calls[0][0], "http://test").searchParams.toString();
      view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
      await screen.findByRole("heading", { name: "键盘计划" });
      await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
      expect(trigger).not.toBeInTheDocument();
    }
    client.clear();
  });
  it.each([["field", "success"], ["field", "failure"], ["account", "success"], ["account", "failure"]])("isolates an environment refresh across a %s change when the old request ends in %s", async (change, outcome) => {
    navigation.query = "field=field-1&step=environment";
    let currentUser = "u1";
    let finish: (response: Response) => void = () => {};
    const secondField = { ...field, id: "field-2", name: "东田" };
    const secondEnvironment = { ...environment, source_name: "东田独立气象资料", fingerprint: "field-2-data" };
    const identity = (id: string) => ({ id, display_name: `Farmer ${id}`, email: `${id}@example.test`, email_verified: true });
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify(identity(currentUser)));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: currentUser === "u1" ? [field, secondField] : [secondField] }));
      if (url.pathname.includes("/field-1/environment") && url.searchParams.get("refresh") === "true") return new Promise<Response>((resolve) => { finish = resolve; });
      if (url.pathname.includes("/field-1/environment")) return new Response(JSON.stringify(environment));
      if (url.pathname.includes("/field-2/environment")) return new Response(JSON.stringify(secondEnvironment));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "重新获取" }));
    await screen.findByRole("button", { name: "正在更新…" });
    navigation.query = "field=field-2&step=environment";
    if (change === "account") { currentUser = "u2"; await act(async () => { client.setQueryData(["field-shift", "session"], identity(currentUser)); }); }
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    await screen.findByRole("heading", { name: "2025 年 · 东田独立气象资料" });
    expect(screen.getByRole("button", { name: "重新获取" })).toBeEnabled();
    const refreshed = { ...environment, source_name: "西田稍晚返回的资料", fingerprint: "field-1-new" };
    await act(async () => finish(outcome === "success" ? new Response(JSON.stringify(refreshed)) : new Response(JSON.stringify({ error: { code: "unavailable", message: "旧地块刷新失败", request_id: "old" } }), { status: 503 })));
    await waitFor(() => expect(client.getMutationCache().getAll().every((item) => item.state.status !== "pending")).toBe(true));
    expect(client.getQueryData(["field-shift", "u1", "environment", "field-1", 1])).toEqual(outcome === "success" ? refreshed : environment);
    expect(client.getQueryData(["field-shift", currentUser, "environment", "field-2", 1])).toEqual(secondEnvironment);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2025 年 · 东田独立气象资料" })).toBeInTheDocument();
    client.clear();
  });
  it("does not carry a previous field's generation busy or failure state into a new field", async () => {
    navigation.query = "field=field-1&step=planning";
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field, { ...field, id: "field-2", name: "东田" }] }));
      if (url.pathname.endsWith("/analyses")) return new Promise<Response>((resolve) => { finish = resolve; });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByLabelText(/我理解这些是示范假设/));
    fireEvent.click(screen.getByRole("button", { name: "生成可行轮作" }));
    await screen.findByRole("button", { name: "正在比较作物安排…" });
    navigation.query = "field=field-2&step=planning";
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "生成可行轮作" })).toBeEnabled();
    await act(async () => finish(new Response(JSON.stringify({ error: { code: "unavailable", message: "旧地块计算失败", request_id: "old" } }), { status: 503 })));
    await waitFor(() => expect(client.getMutationCache().getAll().every((item) => item.state.status !== "pending")).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    client.clear();
  });
  it("does not reset another field's environment refresh when an earlier field save completes", async () => {
    navigation.query = "field=field-1&step=field";
    let finishSave: (response: Response) => void = () => {};
    let finishRefresh: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", async (url: URL, init?: RequestInit) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field, { ...field, id: "field-2", name: "东田" }] }));
      if (init?.method === "PATCH") return new Promise<Response>((resolve) => { finishSave = resolve; });
      if (url.pathname.includes("/environment") && url.searchParams.get("refresh") === "true") return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      if (url.pathname.includes("/environment")) return new Response(JSON.stringify(environment));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "保存地块并继续" }));
    await screen.findByRole("button", { name: "正在保存…" });
    navigation.query = "field=field-2&step=environment";
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "重新获取" }));
    await screen.findByRole("button", { name: "正在更新…" });
    await act(async () => finishSave(new Response(JSON.stringify({ ...field, version: 2 }))));
    expect(screen.getByRole("button", { name: "正在更新…" })).toBeDisabled();
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => finishRefresh(new Response(JSON.stringify(environment))));
    await screen.findByRole("button", { name: "重新获取" });
    expect(client.getQueryData<{ items: typeof field[] }>(["field-shift", "u1", "fields"])?.items.find((item) => item.id === field.id)?.version).toBe(2);
    client.clear();
  });
  it("does not replace a newer field version with an older conflict reload response", async () => {
    navigation.query = "field=field-1&step=field";
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", async (url: URL, init?: RequestInit) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field] }));
      if (init?.method === "PATCH") return new Response(JSON.stringify({ error: { code: "conflict", message: "Changed elsewhere", request_id: "conflict" } }), { status: 409 });
      if (url.pathname.endsWith("/fields/field-1")) return new Promise<Response>((resolve) => { finish = resolve; });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "保存地块并继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看服务器上的最新资料" }));
    await screen.findByRole("button", { name: "正在获取最新资料…" });
    await act(async () => { client.setQueryData(["field-shift", "u1", "fields"], { items: [{ ...field, version: 3, name: "最新第三版" }] }); });
    await act(async () => finish(new Response(JSON.stringify({ ...field, version: 2, name: "较旧第二版" }))));
    await screen.findByText(/最新记录：最新第三版/);
    expect(client.getQueryData<{ items: typeof field[] }>(["field-shift", "u1", "fields"])?.items[0].version).toBe(3);
    expect(screen.queryByText(/最新记录：较旧第二版/)).not.toBeInTheDocument();
    client.clear();
  });
  it("does not request private fields before authentication succeeds", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => { paths.push(url.pathname); return new Response(JSON.stringify({ error: { code: "authentication_required", message: "Sign in", request_id: "r1" } }), { status: 401 }); });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "登录并开始" })).toHaveAttribute("href", expect.stringContaining("/login?next="));
    await waitFor(() => expect(paths).toEqual(["/users/me"]));
    expect(screen.queryByLabelText("地块名称")).not.toBeInTheDocument();
    client.clear();
  });
  it("does not reuse a cached previous account while resolving the current identity", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => { paths.push(url.pathname); return new Response(JSON.stringify({ error: { code: "authentication_required", message: "Sign in", request_id: "r2" } }), { status: 401 }); });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    client.setQueryData(["field-shift", "session"], { id: "previous-user", display_name: "Previous user", email: "previous@example.test", email_verified: true });
    render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "登录并开始" })).toBeInTheDocument();
    expect(paths).toEqual(["/users/me"]);
    expect(screen.queryByText("Previous user")).not.toBeInTheDocument();
    client.clear();
  });
  it.each(["field switch", "page unmount"])("keeps a completed analysis without navigating back after a %s", async (change) => {
    navigation.query = "field=field-1&step=planning";
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field, { ...field, id: "field-2", name: "东田" }] }));
      if (url.pathname.endsWith("/analyses")) return new Promise<Response>((resolve) => { finish = resolve; });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByLabelText(/我理解这些是示范假设/));
    fireEvent.click(screen.getByRole("button", { name: "生成可行轮作" }));
    await screen.findByRole("button", { name: "正在比较作物安排…" });
    if (change === "page unmount") view.unmount();
    else fireEvent.change(screen.getByLabelText("选择地块"), { target: { value: "field-2" } });
    await act(async () => finish(new Response(JSON.stringify(analysis), { status: 201 })));
    await waitFor(() => expect(client.getQueryData(["field-shift", "u1", "analysis", "analysis-1"])).toBeTruthy());
    expect(navigation.replace.mock.calls.map(([url]) => String(url))).toEqual(change === "page unmount" ? [] : ["/field-shift?field=field-2&step=field"]);
    client.clear();
  });
  it("moves focus and scroll to the new step, while same-step scenario results keep the reading position", async () => {
    navigation.query = "field=field-1&step=environment";
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify({ id: "u1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: [field] }));
      if (url.pathname.endsWith("/environment")) return new Response(JSON.stringify(environment));
      if (url.pathname.includes("/analyses/")) return new Response(JSON.stringify(analysis));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    await screen.findByRole("button", { name: "设置我的目标" });
    fireEvent.click(screen.getByRole("button", { name: "设置我的目标" }));
    navigation.query = "field=field-1&step=planning";
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    await screen.findByRole("button", { name: "生成可行轮作" });
    expect(screen.getByRole("main")).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    navigation.query = "field=field-1&step=comparison&analysis=analysis-1";
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    const slider = await screen.findByRole("slider", { name: "降雨变化" });
    slider.focus(); scrollIntoView.mockClear();
    navigation.query = "field=field-1&step=comparison&analysis=analysis-2";
    view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    await screen.findByText("看清取舍，再选择");
    expect(scrollIntoView).not.toHaveBeenCalled();
    client.clear();
  });
  it.each(["route", "account"])("keeps a late saved plan with its original owner after a %s change without reopening private content", async (change) => {
    navigation.query = "field=field-1&step=comparison&analysis=analysis-1";
    let currentUser = "u1";
    let finish: (response: Response) => void = () => {};
    const identity = (id: string) => ({ id, display_name: `Farmer ${id}`, email: `${id}@example.test`, email_verified: true });
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/users/me") return new Response(JSON.stringify(identity(currentUser)));
      if (url.pathname.endsWith("/profiles")) return new Response(JSON.stringify({ items: [profile] }));
      if (url.pathname.endsWith("/fields")) return new Response(JSON.stringify({ items: currentUser === "u1" ? [field, { ...field, id: "field-2", name: "东田" }] : [{ ...field, id: "field-2", name: "新账户的地块" }] }));
      if (url.pathname.includes("/analyses/")) return new Response(JSON.stringify(analysis));
      if (url.pathname.endsWith("/plans")) return new Promise<Response>((resolve) => { finish = resolve; });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "保存轮作选择 1" }));
    fireEvent.change(screen.getByLabelText("计划名称"), { target: { value: "旧账户私人计划" } });
    fireEvent.click(screen.getByRole("button", { name: "确认保存计划" }));
    await screen.findByRole("button", { name: "正在保存…" });
    if (change === "account") {
      currentUser = "u2";
      await act(async () => { client.setQueryData(["field-shift", "session"], identity(currentUser)); });
      await screen.findByText("找不到这块地");
    } else {
      navigation.query = "field=field-2&step=field";
      view.rerender(<QueryClientProvider client={client}><FieldShiftWorkspace /></QueryClientProvider>);
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const saved = { id: "saved-late", title: "旧账户私人计划", notes: "", created_at: "2026-11-01T00:00:00Z", field_id: field.id, field_name: field.name, option: alternative, analysis, field_snapshot: field };
    await act(async () => finish(new Response(JSON.stringify(saved), { status: 201 })));
    await waitFor(() => expect(client.getQueryData(["field-shift", "u1", "plan", "saved-late"])).toEqual(saved));
    expect(client.getQueryData(["field-shift", "u2", "plan", "saved-late"])).toBeUndefined();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("旧账户私人计划")).not.toBeInTheDocument();
    client.clear();
  });
});
