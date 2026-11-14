import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldForm } from "./field-form";
import { EnvironmentPanel } from "./environment-panel";
import { PlanningForm } from "./planning-form";
import { Comparison } from "./comparison";
import { analysis, environment, field, profile } from "./fixtures.test-helper";

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("farmer journey", () => {
  it("retains edited field and history when server save fails", async () => {
    render(<FieldForm field={field} profiles={[profile]} userId="u1" onSave={async () => { throw new Error("offline"); }} />);
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "西田修订" } });
    fireEvent.click(screen.getByRole("button", { name: "保存地块并继续" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("输入已保留");
    expect(screen.getByLabelText("地块名称")).toHaveValue("西田修订");
    expect(screen.getByLabelText("历史年份 1")).toHaveValue(2025);
  });
  it("restores an unsaved field draft after remount", async () => {
    const props = { field, profiles: [profile], userId: "u1", onSave: vi.fn() };
    const first = render(<FieldForm {...props} />);
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "未保存的名字" } });
    first.unmount();
    render(<FieldForm {...props} />);
    await waitFor(() => expect(screen.getByLabelText("地块名称")).toHaveValue("未保存的名字"));
  });
  it("does not clear a newer field draft when an earlier unmounted save completes", async () => {
    let finish: () => void = () => {};
    const first = render(<FieldForm field={field} profiles={[profile]} userId="u1" onSave={() => new Promise<void>((resolve) => { finish = resolve; })} />);
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "第一次提交" } });
    fireEvent.click(screen.getByRole("button", { name: "保存地块并继续" }));
    expect(screen.getByLabelText("地块名称")).toBeDisabled();
    first.unmount();
    render(<FieldForm field={field} profiles={[profile]} userId="u1" onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "重开后的新草稿" } });
    await act(async () => finish());
    expect(JSON.parse(sessionStorage.getItem("field-shift:u1:field:field-1:v1")!).name).toBe("重开后的新草稿");
    expect(screen.getByLabelText("地块名称")).toHaveValue("重开后的新草稿");
  });
  it("does not clear a newer planning draft when an earlier unmounted calculation completes", async () => {
    let finish: () => void = () => {};
    const first = render(<PlanningForm field={field} profile={profile} userId="u1" onGenerate={() => new Promise<void>((resolve) => { finish = resolve; })} busy={false} error={null} />);
    fireEvent.click(screen.getByLabelText(/我理解这些是示范假设/));
    fireEvent.change(screen.getByLabelText("每季补灌上限（mm）"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "生成可行轮作" }));
    first.unmount();
    render(<PlanningForm field={field} profile={profile} userId="u1" onGenerate={vi.fn()} busy={false} error={null} />);
    fireEvent.change(screen.getByLabelText("每季补灌上限（mm）"), { target: { value: "200" } });
    await act(async () => finish());
    expect(JSON.parse(sessionStorage.getItem("field-shift:u1:planning:field-1:v1")!).max_irrigation_mm).toBe("200");
  });
  it("retains the draft's original version after a server-side edit so stale saves conflict", async () => {
    let submittedVersion: number | undefined;
    const onSave = async (_input: unknown, version?: number) => { submittedVersion = version; };
    const first = render(<FieldForm field={field} profiles={[profile]} userId="u1" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "我的旧草稿" } }); first.unmount();
    render(<FieldForm field={{ ...field, version: 2, name: "另一个页面更新" }} profiles={[profile]} userId="u1" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "保存地块并继续" }));
    await waitFor(() => expect(submittedVersion).toBe(1));
  });
  it("keeps zero rainfall separate from missing observations and labels historical cache", () => {
    render(<EnvironmentPanel environment={environment} loading={false} error={null} onRefresh={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByText("查看逐月数据"));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("0")).toBeInTheDocument();
    expect(within(rows[2]).getAllByText("暂无数据")).toHaveLength(4);
    expect(screen.getByText(/已缓存的历史资料/)).toBeInTheDocument();
    expect(screen.getByText(/不是未来天气预报/)).toBeInTheDocument();
  });
  it("does not generate plans until demonstration assumptions are acknowledged", async () => {
    const submit = vi.fn();
    render(<PlanningForm field={field} profile={profile} userId="u1" onGenerate={submit} busy={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: "生成可行轮作" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("示范");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/我理解这些是示范假设/));
    fireEvent.change(screen.getByLabelText("每季补灌上限（mm）"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "生成可行轮作" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ max_irrigation_mm: 0, accept_demo_assumptions: true })));
  });
  it("keeps the infeasible baseline visible without offering to save it as a recommendation", () => {
    render(<Comparison analysis={analysis} busy={false} error={null} onRecalculate={vi.fn()} onSave={vi.fn()} onEdit={vi.fn()} />);
    const baselineCard = screen.getByRole("article", { name: "现有安排" });
    expect(within(baselineCard).getByText("存在约束冲突")).toBeInTheDocument();
    expect(within(baselineCard).queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存轮作选择 1" })).toBeInTheDocument();
  });
  it("does not describe synthetic climate as historical observations in scenario comparison", () => {
    render(<Comparison analysis={{ ...analysis, environment: { ...environment, status: "demo", source_name: "合成教学气候" } }} busy={false} error={null} onRecalculate={vi.fn()} onSave={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText(/本次使用合成教学气候/)).toBeInTheDocument();
    expect(screen.queryByText(/2025 年历史参考上/)).not.toBeInTheDocument();
  });
  it("summarizes repeated conflicts while retaining every conflict and ranking explanation in expandable details", () => {
    const conflicts = Array.from({ length: 11 }, (_, index) => ({ rule_id: `rule-${index % 3}`, message: `第 ${index + 1} 条约束冲突` }));
    render(<Comparison analysis={{ ...analysis, baseline: { ...analysis.baseline, violations: conflicts, reasons: ["当前安排保留供比较。", "完整指标解释", "完整排序计算依据"] } }} busy={false} error={null} onRecalculate={vi.fn()} onSave={vi.fn()} onEdit={vi.fn()} />);
    const card = within(screen.getByRole("article", { name: "现有安排" }));
    expect(card.getByText("11 项约束冲突，需要先解决")).toBeInTheDocument();
    expect(within(card.getByRole("list", { name: "冲突摘要" })).getAllByRole("listitem")).toHaveLength(2);
    const conflictDetails = card.getByText("查看全部 11 项冲突").closest("details");
    expect(conflictDetails).not.toHaveAttribute("open");
    expect(conflictDetails).toHaveTextContent("第 11 条约束冲突");
    expect(card.getByText("完整排序计算依据").closest("details")).not.toHaveAttribute("open");
  });
  it("keeps each comparison metric term and value in the same valid description-list group", () => {
    render(<Comparison analysis={analysis} busy={false} error={null} onRecalculate={vi.fn()} onSave={vi.fn()} onEdit={vi.fn()} />);
    const card = within(screen.getByRole("article", { name: "现有安排" }));
    for (const term of card.getAllByRole("term")) {
      const group = term.parentElement!;
      expect(group.parentElement?.tagName).toBe("DL");
      expect([...group.children].map((node) => node.tagName)).toEqual(["DT", "DD"]);
      expect(group.querySelector("dd")).not.toHaveTextContent(/^$/);
    }
  });
});

it("keeps a newer managed-field draft across local-to-server identity assignment", async () => {
  const props = { profiles: [profile], userId: "owner", onSave: vi.fn(), draftKey: "managed:stable-local-id", geometryLocked: true };
  const first = render(<FieldForm {...props} field={{ ...field, id: "local:stable-local-id" }} />);
  fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "未提交的更新名称" } });
  first.unmount();
  const dirty = vi.fn();
  render(<FieldForm {...props} field={{ ...field, id: "server-id" }} onDirtyChange={dirty} />);
  expect(screen.getByLabelText("地块名称")).toHaveValue("未提交的更新名称");
  expect(dirty).toHaveBeenCalledWith(true);
  expect(screen.getByLabelText("经度")).toHaveAttribute("readonly");
});
