import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GanttChart, getGanttTaskColor, getGanttTaskVisualRole, isGanttParentTask, type GanttSnapshot } from ".";

const nextSnapshot: GanttSnapshot = {
  taskData: [{ id: "next", name: "已更新任务", type: "task", start: "2026-10-04", end: "2026-10-05" }],
  edgeData: [],
};

vi.mock("kanx-gantt", () => ({
  SvarGantt: (props: { taskData: { id: string | number; type?: string }[]; edgeData?: unknown[]; selectedYear?: number; nativeProps?: { readonly?: boolean }; taskRenderers?: Record<string, unknown>; showDependencyArrows?: boolean; onChange?: (snapshot: GanttSnapshot) => void; onYearChange?: (year: number) => void }) => <div className="kanx-gantt" data-testid="svar-gantt">
    <output data-testid="task-count">{props.taskData.length}</output>
    <output data-testid="edge-count">{props.edgeData?.length ?? 0}</output>
    <output data-testid="selected-year">{props.selectedYear}</output>
    <output data-testid="readonly">{String(props.nativeProps?.readonly)}</output>
    <output data-testid="dependency-arrows">{String(props.showDependencyArrows)}</output>
    <output data-testid="task-renderers">{String(Boolean(props.taskRenderers?.task))}</output>
    <div className="kanx-sidebar" data-testid="sidebar" />
    <div className="kanx-chart"><div className="wx-chart" data-testid="timeline">{props.taskData.map((task) => <div key={task.id} className={`wx-bar${task.type === "milestone" ? " wx-milestone" : ""}`} data-id={`:${task.id}`} />)}</div></div>
    <button type="button" onClick={() => props.onChange?.(nextSnapshot)}>更新快照</button>
    <button type="button" onClick={() => props.onYearChange?.(2027)}>更新年份</button>
  </div>,
}));

afterEach(cleanup);

describe("GanttChart", () => {
  const snapshot: GanttSnapshot = {
    taskData: [{ id: "plan", name: "项目规划", type: "task", start: "2026-10-01", end: "2026-10-03", progress: 50 }],
    edgeData: [{ id: "edge", type: "FS", source_id: "plan", target_id: "review" }],
  };

  it("passes controlled data, options, and dimensions to the gantt implementation", () => {
    render(<GanttChart
      snapshot={snapshot}
      onChange={vi.fn()}
      selectedYear={2026}
      nativeProps={{ readonly: true, gridWidth: 420 }}
      showDependencyArrows
      height="42rem"
      className="project-gantt"
    />);

    expect(screen.getByTestId("task-count").textContent).toBe("1");
    expect(screen.getByTestId("edge-count").textContent).toBe("1");
    expect(screen.getByTestId("selected-year").textContent).toBe("2026");
    expect(screen.getByTestId("readonly").textContent).toBe("true");
    expect(screen.getByTestId("dependency-arrows").textContent).toBe("true");
    expect(screen.getByTestId("task-renderers").textContent).toBe("false");
    expect(screen.getByTestId("svar-gantt").parentElement?.parentElement?.className).toContain("project-gantt");
    expect(screen.getByTestId("svar-gantt").className).toContain("kanx-gantt");
    expect(screen.getByTestId("svar-gantt").parentElement?.parentElement?.getAttribute("style")).toContain("height: 42rem");
  });

  it("uses a light local color scheme and keeps dependency arrows disabled by default", () => {
    render(<GanttChart snapshot={snapshot} onChange={vi.fn()} />);

    expect(screen.getByTestId("svar-gantt").parentElement?.parentElement?.getAttribute("data-color-scheme")).toBe("light");
    expect(screen.getByTestId("dependency-arrows").textContent).toBe("false");
  });

  it("resolves parent and child roles for periods and milestones", () => {
    const tasks = [
      { id: "solo", name: "独立时段", type: "task", start: "2026-01-01", end: "2026-01-02" },
      { id: "summary", name: "父时段", type: "summary", start: "2026-01-03", end: "2026-01-04" },
      { id: "child", name: "子时段", type: "task", start: "2026-01-03", end: "2026-01-04", parent_id: "summary" },
      { id: "node", name: "父节点", type: "milestone", start: "2026-01-05", end: "2026-01-05" },
      { id: "node-child", name: "子节点", type: "milestone", start: "2026-01-06", end: "2026-01-06", parent_id: "node" },
    ];
    expect(isGanttParentTask(tasks[0], tasks)).toBe(true);
    expect(getGanttTaskVisualRole(tasks[0], tasks)).toBe("period-parent");
    expect(getGanttTaskVisualRole(tasks[1], tasks)).toBe("period-parent");
    expect(getGanttTaskVisualRole(tasks[2], tasks)).toBe("period-child");
    expect(getGanttTaskVisualRole(tasks[3], tasks)).toBe("milestone-parent");
    expect(getGanttTaskVisualRole(tasks[4], tasks)).toBe("milestone-child");
    expect(tasks.map((task, index) => getGanttTaskColor(task, tasks, index).barColor))
      .toEqual(["#9870D4", "#E565A0", "#718CDD", "#C56BCB", "#DF817E"]);
    expect(getGanttTaskColor(tasks[0], tasks, 5).barColor).toBe("#9870D4");
    expect(tasks.map((task, index) => getGanttTaskColor(task, tasks, index).fontColor))
      .toEqual(Array(5).fill("#000000"));
  });

  it("applies milestone colors and parent outlines from the resolved roles", () => {
    const tasks: GanttSnapshot["taskData"] = [
      { id: "parent-node", name: "父节点", type: "milestone", start: "2026-01-01", end: "2026-01-01" },
      { id: "child-node", name: "子节点", type: "milestone", start: "2026-01-02", end: "2026-01-02", parent_id: "parent-node" },
    ];
    render(<GanttChart snapshot={{ taskData: tasks, edgeData: [] }} onChange={vi.fn()} />);
    const bars = screen.getByTestId("timeline").querySelectorAll<HTMLElement>(".wx-bar");

    expect(bars[0].style.getPropertyValue("--wx-gantt-milestone-color")).toBe("#9870D4");
    expect(bars[0].style.getPropertyValue("--kanx-parent-outline")).toBe("#9870D4");
    expect(bars[1].style.getPropertyValue("--wx-gantt-milestone-color")).toBe("#E565A0");
    expect(bars[1].style.getPropertyValue("--kanx-parent-outline")).toBe("");
  });

  it("cycles palette styles by stable task order and lets explicit renderers take precedence", () => {
    const palette = [
      { barColor: "#FF0076", progressColor: "#c9005e" },
      { barColor: "#590FB7", progressColor: "#40098a" },
    ];
    const paletteSnapshot: GanttSnapshot = {
      taskData: [
        { id: "first", name: "第一项", type: "task", start: "2026-10-01", end: "2026-10-02" },
        { id: "second", name: "第二项", type: "task", start: "2026-10-03", end: "2026-10-04" },
      ],
      edgeData: [],
    };
    render(<GanttChart snapshot={paletteSnapshot} onChange={vi.fn()} taskColorPalette={palette} />);
    const [first, second] = screen.getAllByTestId("timeline")[0].querySelectorAll<HTMLElement>(".wx-bar");

    expect(first.style.getPropertyValue("--wx-gantt-task-color")).toBe("#FF0076");
    expect(second.style.getPropertyValue("--wx-gantt-task-color")).toBe("#590FB7");

    cleanup();
    render(<GanttChart snapshot={paletteSnapshot} onChange={vi.fn()} taskColorPalette={palette} taskRenderers={{ task: { barColor: "#111111" } }} />);
    expect(screen.getByTestId("timeline").querySelector<HTMLElement>(".wx-bar")?.style.getPropertyValue("--wx-gantt-task-color")).toBe("");
    expect(screen.getByTestId("task-renderers").textContent).toBe("true");
  });

  it("maps wheel input from the visualization to its horizontal timeline only", () => {
    render(<GanttChart snapshot={snapshot} onChange={vi.fn()} />);
    const timeline = screen.getByTestId("timeline");
    const sidebar = screen.getByTestId("sidebar");
    timeline.scrollLeft = 20;

    expect(fireEvent.wheel(timeline, { deltaY: 48 })).toBe(false);
    expect(timeline.scrollLeft).toBe(68);
    expect(fireEvent.wheel(sidebar, { deltaY: 48 })).toBe(true);
    expect(timeline.scrollLeft).toBe(68);
  });

  it("returns all gantt changes to the controlled caller", () => {
    const onChange = vi.fn();
    const onYearChange = vi.fn();
    render(<GanttChart snapshot={snapshot} onChange={onChange} onYearChange={onYearChange} />);

    fireEvent.click(screen.getByRole("button", { name: "更新快照" }));
    fireEvent.click(screen.getByRole("button", { name: "更新年份" }));

    expect(onChange).toHaveBeenCalledWith(nextSnapshot);
    expect(onYearChange).toHaveBeenCalledWith(2027);
  });
});
