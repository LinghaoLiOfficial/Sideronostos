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
  { barColor: "#BDDF8A", progressColor: "#96BA61", fontColor: "#000000", borderColor: "#BDDF8A" },
  { barColor: "#78C9C1", progressColor: "#54AAA2", fontColor: "#000000", borderColor: "#78C9C1" },
  { barColor: "#92B9E6", progressColor: "#709AC9", fontColor: "#000000", borderColor: "#92B9E6" },
  { barColor: "#E7C77B", progressColor: "#C7A655", fontColor: "#000000", borderColor: "#E7C77B" },
  { barColor: "#D8A386", progressColor: "#BC8465", fontColor: "#000000", borderColor: "#D8A386" },
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
