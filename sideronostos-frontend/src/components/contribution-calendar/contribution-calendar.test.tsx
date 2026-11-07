import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContributionCalendar } from ".";

afterEach(cleanup);
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });

describe("ContributionCalendar", () => {
  it("renders a year grid and calculates totals", () => {
    render(<ContributionCalendar year={2024} dayDetails={{ "2024-01-01": { title: "一月", items: ["一", "二"] }, "2024-02-29": { title: "二月", items: ["一", "二", "三", "四"] } }} />);
    expect(screen.getByText("6 个事项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2024-02-29：4 个事项" })).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(360);
  });

  it("can render without its outer card when embedded in another surface", () => {
    render(<ContributionCalendar embedded year={2024} dayDetails={{}} ariaLabel="嵌入日历" />);
    const calendar = screen.getByLabelText("嵌入日历");
    expect(calendar.className).not.toContain("glass-surface");
    expect(calendar.className).not.toContain("rounded-lg");
  });

  it("uses detail item counts and fixed exponential intensity thresholds", async () => {
    render(<ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "事项", items: ["一", "二", "三"] } }}
    />);

    expect(screen.getByText("3 个事项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2024-01-01：3 个事项" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2024-01-05：0 个事项" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：3 个事项" }));
    expect(screen.getByRole("region", { name: "日期详情" }).textContent).toContain("一");
  });

  it("supports year changes and day clicks", async () => {
    const onYearChange = vi.fn();
    const onDayClick = vi.fn();
    render(<ContributionCalendar year={2025} years={[2025, 2024]} dayDetails={{ "2025-03-03": { title: "事项", items: ["一", "二", "三"] } }} onYearChange={onYearChange} onDayClick={onDayClick} />);
    await userEvent.click(screen.getByRole("combobox", { name: "选择年份" }));
    await userEvent.click(await screen.findByRole("option", { name: "2024" }));
    expect(onYearChange).toHaveBeenCalledWith(2024);
    const day = screen.getByRole("button", { name: "2025-03-03：3 个事项" });
    await userEvent.click(day);
    expect(onDayClick).toHaveBeenCalledWith("2025-03-03", 3);
  });

  it("exposes details on focus and handles empty data", async () => {
    render(<ContributionCalendar year={2023} dayDetails={{}} />);
    const day = screen.getByRole("button", { name: "2023-01-01：0 个事项" });
    fireEvent.focus(day);
    expect(day.getAttribute("title")).toBeNull();
    expect(screen.getByRole("tooltip", { name: "2023-01-01：0 个事项" }).getAttribute("data-side")).toBe("top");
  });

  it("updates the tooltip when moving quickly between cells", () => {
    render(<ContributionCalendar year={2024} dayDetails={{ "2024-01-01": { title: "一", items: ["一", "二"] }, "2024-01-02": { title: "二", items: ["一", "二", "三", "四", "五"] } }} />);
    const firstDay = screen.getByRole("button", { name: "2024-01-01：2 个事项" });
    const secondDay = screen.getByRole("button", { name: "2024-01-02：5 个事项" });

    fireEvent.pointerEnter(firstDay);
    fireEvent.pointerEnter(secondDay);

    expect(screen.queryByRole("tooltip", { name: "2024-01-01：2 个事项" })).toBeNull();
    expect(screen.getByRole("tooltip", { name: "2024-01-02：5 个事项" }).className).toContain("pointer-events-none");
  });

  it("keeps a custom detail card visible for a selected day", async () => {
    render(<ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "研究记录更新", items: ["整理检索结果", "补充来源引用"] } }}
    />);

    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：2 个事项" }));

    const detailRegion = screen.getByRole("region", { name: "日期详情" });
    expect(detailRegion).toBeTruthy();
    expect(screen.getByRole("heading", { name: "研究记录更新" })).toBeTruthy();
    expect(detailRegion.querySelectorAll("li")).toHaveLength(2);
    expect(detailRegion.querySelectorAll("li span[aria-hidden='true']")).toHaveLength(2);
    expect(screen.getByText("整理检索结果")).toBeTruthy();
    expect(screen.getByText("补充来源引用")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "关闭日期详情" })).toBeNull();
  });

  it("selects a new day on the first click after another day is selected", async () => {
    render(<ContributionCalendar
      year={2024}
      dayDetails={{
        "2024-01-01": { title: "第一天", items: ["第一条记录"] },
        "2024-01-02": { title: "第二天", items: ["第二条记录"] },
      }}
    />);

    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：1 个事项" }));
    await userEvent.click(screen.getByRole("button", { name: "2024-01-02：1 个事项" }));

    expect(screen.getByRole("heading", { name: "第二天" })).toBeTruthy();
    expect(screen.getByText("第二条记录")).toBeTruthy();
    expect(screen.queryByText("第一条记录")).toBeNull();
    expect(screen.getByRole("button", { name: "2024-01-02：1 个事项" }).className).toContain("ring-1 ring-ring");
    expect(screen.getByRole("button", { name: "2024-01-02：1 个事项" }).className).toContain("border-[0.5px]");
  });

  it("clears the selected day when clicking outside the calendar", async () => {
    render(<div><ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "第一天", items: ["第一条记录"] } }}
    /><button type="button">页面其他位置</button></div>);

    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：1 个事项" }));
    expect(screen.getByRole("heading", { name: "第一天" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "页面其他位置" }));

    expect(screen.getByRole("region", { name: "日期详情" }).textContent).toContain("点击任意单元格查看事项明细");
    expect(screen.getByRole("button", { name: "2024-01-01：1 个事项" }).className).not.toContain("ring-1 ring-ring");
  });

  it("closes selected details when changing years", async () => {
    render(<ContributionCalendar year={2025} years={[2025, 2024]} dayDetails={{ "2025-01-01": { title: "一", items: ["一"] } }} />);
    await userEvent.click(screen.getByRole("button", { name: "2025-01-01：1 个事项" }));
    expect(screen.getByRole("region", { name: "日期详情" })).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "选择年份" }));
    await userEvent.click(await screen.findByRole("option", { name: "2024" }));
    expect(screen.getByRole("region", { name: "日期详情" }).textContent).toContain("点击任意单元格查看事项明细");
  });

  it("shows a default title and contribution bullet when day details are not provided", async () => {
    render(<ContributionCalendar year={2024} dayDetails={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：0 个事项" }));
    expect(screen.getByRole("heading", { name: "2024年1月1日事项" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "日期详情" }).textContent).toContain("暂无事项");
  });

  it("normalizes legacy contribution titles in the detail card", async () => {
    render(<ContributionCalendar year={2024} dayDetails={{ "2024-01-01": { title: "2024年1月1日贡献", items: ["旧记录"] } }} />);
    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：1 个事项" }));
    expect(screen.getByRole("heading", { name: "2024年1月1日事项" })).toBeTruthy();
  });

  it("edits, adds, removes, saves, and cancels detail items", async () => {
    const onDayDetailsChange = vi.fn();
    render(<ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "研究记录", items: ["原事项", "待删除"] } }}
      onDayDetailsChange={onDayDetailsChange}
    />);

    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：2 个事项" }));
    await userEvent.click(screen.getByRole("button", { name: "编辑日期事项" }));
    const inputs = screen.getAllByRole("textbox");
    await userEvent.clear(inputs[0]);
    await userEvent.type(inputs[0], "已更新事项");
    await userEvent.click(screen.getByRole("button", { name: "删除事项 2" }));
    await userEvent.click(screen.getByRole("button", { name: "新增事项" }));
    await userEvent.type(screen.getByRole("textbox", { name: "事项 2" }), "新增事项");
    await userEvent.click(screen.getByRole("button", { name: "保存日期事项" }));

    expect(onDayDetailsChange).toHaveBeenCalledWith("2024-01-01", { title: "研究记录", items: ["已更新事项", "新增事项"] });
    expect(screen.getByText("已更新事项")).toBeTruthy();
    expect(screen.getByText("新增事项")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "编辑日期事项" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "事项 1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "事项 1" }), "未保存修改");
    await userEvent.click(screen.getByRole("button", { name: "取消编辑日期事项" }));
    expect(screen.getByText("已更新事项")).toBeTruthy();
    expect(screen.queryByText("未保存修改")).toBeNull();
  });

  it("shows an empty state after deleting all items", async () => {
    const onDayDetailsChange = vi.fn();
    render(<ContributionCalendar year={2024} dayDetails={{ "2024-01-01": { title: "研究记录", items: ["唯一事项"] } }} onDayDetailsChange={onDayDetailsChange} />);
    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：1 个事项" }));
    await userEvent.click(screen.getByRole("button", { name: "编辑日期事项" }));
    await userEvent.click(screen.getByRole("button", { name: "删除事项 1" }));
    await userEvent.click(screen.getByRole("button", { name: "保存日期事项" }));
    expect(onDayDetailsChange).toHaveBeenCalledWith("2024-01-01", { title: "研究记录", items: [] });
    expect(screen.getByText("暂无事项")).toBeTruthy();
  });

  it("keeps schedule details readable without exposing edit controls in read-only mode", async () => {
    render(<ContributionCalendar year={2024} readOnly dayDetails={{ "2024-01-01": { title: "同伴计划", items: ["阅读文献"] } }} />);
    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：1 个事项" }));
    expect(screen.getByText("阅读文献")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑日期事项" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存日期事项" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新增事项" })).toBeNull();
  });

  it("updates the selected cell intensity after saving edited items", async () => {
    render(<ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "研究记录", items: ["一", "二", "三", "四"] } }}
    />);

    const day = screen.getByRole("button", { name: "2024-01-01：4 个事项" });
    expect(day.className).toContain("bg-(--calendar-3)");

    await userEvent.click(day);
    await userEvent.click(screen.getByRole("button", { name: "编辑日期事项" }));
    await userEvent.click(screen.getByRole("button", { name: "删除事项 4" }));
    await userEvent.click(screen.getByRole("button", { name: "删除事项 3" }));
    await userEvent.click(screen.getByRole("button", { name: "删除事项 2" }));
    await userEvent.click(screen.getByRole("button", { name: "保存日期事项" }));

    const updatedDay = screen.getByRole("button", { name: "2024-01-01：1 个事项" });
    expect(updatedDay.className).toContain("bg-(--calendar-1)");
  });

  it("keeps the detail card at a fixed height and scrolls long item lists", async () => {
    render(<ContributionCalendar
      year={2024}
      dayDetails={{ "2024-01-01": { title: "长列表", items: Array.from({ length: 20 }, (_, index) => `事项 ${index + 1}`) } }}
    />);

    await userEvent.click(screen.getByRole("button", { name: "2024-01-01：20 个事项" }));
    const detailRegion = screen.getByRole("region", { name: "日期详情" });
    expect(detailRegion.className).toContain("h-56");
    const detailsContent = detailRegion.querySelector("div.min-h-0.flex-1.overflow-y-auto");
    expect(detailsContent).toBeTruthy();
    expect(detailsContent?.className).toContain("p-1");
  });
});
