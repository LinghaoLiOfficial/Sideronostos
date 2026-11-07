import type { GanttTaskData, GanttTaskRenderStyle } from "kanx-gantt";

export type GanttTaskVisualRole = "period-parent" | "period-child" | "milestone-parent" | "milestone-child";

export type GanttRoleColorSet = GanttTaskRenderStyle & {
  fontColor: string;
  parentOutlineColor?: string;
};

export type GanttColorScheme = Record<GanttTaskVisualRole, readonly GanttRoleColorSet[]>;

export type GanttColorSchemeInput = Partial<GanttColorScheme>;

const brandColors: readonly GanttRoleColorSet[] = [
  // Alternate warm and cool hues at a similar brightness to distinguish rows.
  { barColor: "#9870D4", progressColor: "#8058BC", fontColor: "#000000", borderColor: "#9870D4" },
  { barColor: "#E565A0", progressColor: "#CD4D88", fontColor: "#000000", borderColor: "#E565A0" },
  { barColor: "#718CDD", progressColor: "#5974C5", fontColor: "#000000", borderColor: "#718CDD" },
  { barColor: "#C56BCB", progressColor: "#AD53B3", fontColor: "#000000", borderColor: "#C56BCB" },
  { barColor: "#DF817E", progressColor: "#C76966", fontColor: "#000000", borderColor: "#DF817E" },
];

export const defaultGanttColorScheme: GanttColorScheme = {
  "period-parent": brandColors,
  "period-child": brandColors,
  "milestone-parent": brandColors,
  "milestone-child": brandColors,
};

export function isGanttParentTask(task: GanttTaskData, tasks: readonly GanttTaskData[]) {
  return task.parent_id === undefined || task.type === "summary" || tasks.some((candidate) => candidate.parent_id === task.id);
}

export function getGanttTaskVisualRole(task: GanttTaskData, tasks: readonly GanttTaskData[]): GanttTaskVisualRole {
  const shape = task.type === "milestone" ? "milestone" : "period";
  return `${shape}-${isGanttParentTask(task, tasks) ? "parent" : "child"}`;
}

export function getGanttTaskColor(task: GanttTaskData, tasks: readonly GanttTaskData[], index: number, colorScheme?: GanttColorSchemeInput, legacyPalette?: readonly GanttTaskRenderStyle[]) {
  const role = getGanttTaskVisualRole(task, tasks);
  const configured = colorScheme?.[role];
  const colors = configured?.length
    ? configured
    : legacyPalette?.length && role.startsWith("period")
      ? legacyPalette
      : defaultGanttColorScheme[role];
  const color = colors[index % colors.length];
  return { ...color, fontColor: color.fontColor ?? "#000000" };
}
