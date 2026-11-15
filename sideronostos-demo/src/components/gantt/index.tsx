"use client";

import { useEffect, useRef } from "react";
import {
  SvarGantt,
  type GanttEdgeRenderStyle,
  type GanttNativeProps,
  type GanttSnapshot,
  type GanttTaskRenderStyle,
} from "kanx-gantt";
import "kanx-gantt/style.css";
import { cn } from "@/lib/utils";
import { useSurfaceAppearance } from "@/components/ui/surface";
import { getGanttTaskColor, isGanttParentTask, type GanttRoleColorSet } from "./color-scheme";
import styles from "./gantt.module.css";

// kanx-gantt mounts truncated-name tooltips directly in document.body.
let tooltipOwner: HTMLElement | null = null;

export {
  defaultGanttColorScheme,
  getGanttTaskColor,
  getGanttTaskVisualRole,
  isGanttParentTask,
  type GanttColorScheme,
  type GanttColorSchemeInput,
  type GanttRoleColorSet,
  type GanttTaskVisualRole,
} from "./color-scheme";

export type {
  GanttEdgeData,
  GanttEdgeRenderStyle,
  GanttFieldValue,
  GanttFields,
  GanttId,
  GanttNativeProps,
  GanttSnapshot,
  GanttTaskData,
  GanttTaskRenderStyle,
} from "kanx-gantt";

export type GanttChartProps = {
  snapshot: GanttSnapshot;
  onChange: (snapshot: GanttSnapshot) => void;
  selectedYear?: number;
  onYearChange?: (year: number) => void;
  nativeProps?: GanttNativeProps;
  taskRenderers?: Record<string, GanttTaskRenderStyle>;
  colorScheme?: import("./color-scheme").GanttColorSchemeInput;
  taskColorPalette?: readonly GanttTaskRenderStyle[];
  edgeRenderers?: Record<string, GanttEdgeRenderStyle>;
  showDependencyArrows?: boolean;
  height?: number | string;
  className?: string;
};

export function GanttChart({
  snapshot,
  onChange,
  selectedYear,
  onYearChange,
  nativeProps,
  taskRenderers,
  colorScheme,
  taskColorPalette,
  edgeRenderers,
  showDependencyArrows = false,
  height = 560,
  className,
}: GanttChartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { tone: surface, material } = useSurfaceAppearance();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Native dialogs live inside the wide timeline. Anchor them to its visible
    // viewport, including after the user scrolls horizontally, without moving DOM.
    const measure = () => {
      if (root.clientWidth) root.style.setProperty("--gantt-viewport-width", `${root.clientWidth}px`);
      root.style.setProperty("--gantt-viewport-offset", `${root.scrollLeft}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); root.removeEventListener("scroll", measure); };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const claimTooltip = () => { tooltipOwner = root; };
    root.addEventListener("pointerover", claimTooltip);
    root.addEventListener("focusin", claimTooltip);
    const observer = new MutationObserver((records) => {
      if (tooltipOwner !== root) return;
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains("kanx-tooltip")) {
          node.dataset.surface = surface;
          node.dataset.material = material;
          node.dataset.surfaceOverlay = "";
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("pointerover", claimTooltip);
      root.removeEventListener("focusin", claimTooltip);
      if (tooltipOwner === root) tooltipOwner = null;
    };
  }, [surface, material]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const chart = target.closest(".kanx-chart");
      if (!chart || !root.contains(chart) || event.deltaY === 0) return;
      const viewport = chart.querySelector<HTMLElement>(".wx-chart");
      if (!viewport) return;
      viewport.scrollLeft += event.deltaY;
      event.preventDefault();
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const chart = root.querySelector(".kanx-chart");
    if (!chart) return;

    const colorsById = new Map<string, { color: GanttRoleColorSet; parent: boolean }>();
    snapshot.taskData.forEach((task, index) => {
      if (taskRenderers?.[task.type]) return;
      const color = getGanttTaskColor(task, snapshot.taskData, index, colorScheme, taskColorPalette);
      const id = String(task.id);
      const value = { color, parent: isGanttParentTask(task, snapshot.taskData) };
      colorsById.set(id, value);
      if (typeof task.id === "string") colorsById.set(`:${id}`, value);
    });

    const clearPaletteStyle = (bar: HTMLElement) => {
      if (bar.dataset.ganttPalette !== "true") return;
      ["color", "fill-color", "font-color", "border-color"].forEach((key) => {
        bar.style.removeProperty(`--wx-gantt-task-${key}`);
        bar.style.removeProperty(`--wx-gantt-summary-${key}`);
      });
      bar.style.removeProperty("--wx-gantt-milestone-color");
      bar.style.removeProperty("--kanx-parent-outline");
      delete bar.dataset.ganttPalette;
    };
    const applyPalette = () => {
      chart.querySelectorAll<HTMLElement>(".wx-bar[data-id]").forEach((bar) => {
        const taskId = bar.dataset.id ?? "";
        const task = snapshot.taskData.find((item) => String(item.id) === taskId || `:${String(item.id)}` === taskId);
        if (task && taskRenderers?.[task.type]) {
          delete bar.dataset.ganttPalette;
          return;
        }
        const resolved = colorsById.get(taskId);
        if (!resolved) {
          clearPaletteStyle(bar);
          return;
        }
        const prefix = bar.classList.contains("wx-summary") ? "summary" : "task";
        const colors = { color: resolved.color.barColor, "fill-color": resolved.color.progressColor, "font-color": resolved.color.fontColor, "border-color": resolved.color.borderColor };
        Object.entries(colors).forEach(([key, value]) => {
          if (value) bar.style.setProperty(`--wx-gantt-${prefix}-${key}`, value);
          else bar.style.removeProperty(`--wx-gantt-${prefix}-${key}`);
        });
        if (bar.classList.contains("wx-milestone") && resolved.color.barColor) bar.style.setProperty("--wx-gantt-milestone-color", resolved.color.barColor);
        if (resolved.parent) bar.style.setProperty("--kanx-parent-outline", resolved.color.parentOutlineColor ?? resolved.color.borderColor ?? resolved.color.barColor ?? "currentColor");
        else bar.style.removeProperty("--kanx-parent-outline");
        bar.dataset.ganttPalette = "true";
      });
    };

    applyPalette();
    const observer = new MutationObserver(applyPalette);
    observer.observe(chart, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [snapshot.taskData, colorScheme, taskColorPalette, taskRenderers]);

  return <div ref={rootRef} data-surface={surface} data-gantt-material={material} data-color-scheme={surface} className={cn(styles.root, "min-w-0 overflow-x-auto", className)} style={{ height }}>
    <div className="h-full min-w-[960px]">
      <SvarGantt
        className="h-full"
        taskData={snapshot.taskData}
        edgeData={snapshot.edgeData}
        onChange={onChange}
        selectedYear={selectedYear}
        onYearChange={onYearChange}
        nativeProps={nativeProps}
        taskRenderers={taskRenderers}
        edgeRenderers={edgeRenderers}
        showDependencyArrows={showDependencyArrows}
      />
    </div>
  </div>;
}

export default GanttChart;
