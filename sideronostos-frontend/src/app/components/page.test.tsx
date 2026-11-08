import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ComponentsPage from "./page";
import { TooltipProvider } from "@/components/ui/tooltip";

// The real calendar and Gantt have dedicated controlled-update suites. Keep this
// gallery integration test focused on sample isolation and actual portal behavior.
vi.mock("@/components/gantt", () => ({ GanttChart: () => <div>项目计划</div>, defaultGanttColorScheme: {} }));
vi.mock("@/components/contribution-calendar", () => ({ ContributionCalendar: () => <div>年度日历</div> }));
afterEach(cleanup);

function renderGallery() {
  return render(<TooltipProvider><ComponentsPage /></TooltipProvider>);
}

describe("single-theme component gallery", () => {
  it("compares three local surfaces in every category on one dark canvas", () => {
    const { container } = renderGallery();
    expect(container.querySelectorAll(".ds-preview")).toHaveLength(21);
    expect(container.querySelectorAll('.ds-preview[data-material="glass"]')).toHaveLength(7);
    expect(container.querySelectorAll('.ds-preview[data-surface="light"]')).toHaveLength(7);
    expect(screen.getByText("单一主题 · 三种组件表面")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /主题/ })).toBeNull();
    expect(screen.getByLabelText("参考页组合模式").querySelector('.metric-panel[data-material="glass"]')).toBeTruthy();
  });

  it("isolates filters and empty-state recovery across all three samples", async () => {
    renderGallery();
    const cream = within(screen.getByLabelText("知识组件 · 米白表面示例"));
    const charcoal = within(screen.getByLabelText("知识组件 · 深灰表面示例"));
    const glass = within(screen.getByLabelText("知识组件 · 烟灰玻璃示例"));
    await userEvent.type(cream.getByRole("textbox", { name: "搜索知识库" }), "no-matching-document");
    expect(cream.getByText("暂无内容")).toBeTruthy();
    expect(charcoal.getAllByRole("button", { name: /语义检索的设计原则/ })).toHaveLength(1);
    expect(glass.getAllByRole("button", { name: /语义检索的设计原则/ })).toHaveLength(1);
    await userEvent.click(cream.getByRole("button", { name: "清除筛选" }));
    expect(cream.queryByText("暂无内容")).toBeNull();
    expect((cream.getByRole("textbox", { name: "搜索知识库" }) as HTMLInputElement).value).toBe("");
  });

  it.each(["米白表面", "烟灰玻璃"])("opens a document from %s and restores focus on Escape", async label => {
    renderGallery();
    const preview = screen.getByLabelText(`知识组件 · ${label}示例`);
    const trigger = within(preview).getByRole("button", { name: /语义检索的设计原则/ });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "语义检索的设计原则" });
    expect(preview.contains(dialog)).toBe(false);
    expect(dialog.getAttribute("data-surface")).toBe(label === "米白表面" ? "light" : "dark");
    expect(dialog.getAttribute("data-material")).toBe(label === "烟灰玻璃" ? "glass" : "solid");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
