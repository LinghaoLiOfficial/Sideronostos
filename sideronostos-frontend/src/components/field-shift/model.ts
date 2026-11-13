import { ApiError } from "@/lib/api/client";
import type { Field, FieldInput, PlanningInputs } from "@/lib/api/field-shift-types";

export type FieldDraft = Omit<FieldInput, "area_ha" | "latitude" | "longitude" | "history"> & { area_ha: string; latitude: string; longitude: string; history: { year: string; crop_id: string }[]; expected_version?: number };
export type PlanningDraft = Omit<PlanningInputs, "start_year" | "max_irrigation_mm" | "max_cost_usd_ha" | "max_labor_days_ha"> & { start_year: string; max_irrigation_mm: string; max_cost_usd_ha: string; max_labor_days_ha: string };
type Validation<T> = { value?: T; error?: string };
const finite = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));

export function initialFieldDraft(profileId: string, field?: Field): FieldDraft {
  return field ? { expected_version: field.version, name: field.name, area_ha: String(field.area_ha), latitude: String(field.latitude), longitude: String(field.longitude), soil_texture: field.soil_texture, irrigation_available: field.irrigation_available, profile_id: field.profile_id, history: field.history.map((h) => ({ ...h, year: String(h.year) })) } : { name: "", area_ha: "", latitude: "", longitude: "", soil_texture: "unknown", irrigation_available: false, profile_id: profileId, history: [] };
}

export function parseFieldDraft(draft: FieldDraft, cropIds: string[]): Validation<FieldInput> {
  if (!draft.name.trim() || draft.name.trim().length > 120) return { error: "请填写 1–120 字的地块名称。" };
  if (!finite(draft.area_ha) || Number(draft.area_ha) <= 0 || Number(draft.area_ha) > 100000) return { error: "面积需大于 0，且不超过 100,000 公顷。" };
  if (!finite(draft.latitude) || Math.abs(Number(draft.latitude)) > 90) return { error: "请填写有效纬度（−90 至 90）；未知时请先确认位置。" };
  if (!finite(draft.longitude) || Math.abs(Number(draft.longitude)) > 180) return { error: "请填写有效经度（−180 至 180）。" };
  if (draft.history.some((h) => !finite(h.year) || !Number.isInteger(Number(h.year)) || Number(h.year) < 1900 || Number(h.year) > 2200 || !cropIds.includes(h.crop_id))) return { error: "请为每条种植历史填写有效年份和作物。" };
  const years = draft.history.map((h) => Number(h.year));
  if (new Set(years).size !== years.length) return { error: "种植历史年份不能重复；当前示范配置每年种一季主作物。" };
  return { value: { name: draft.name.trim(), soil_texture: draft.soil_texture, irrigation_available: draft.irrigation_available, profile_id: draft.profile_id, area_ha: Number(draft.area_ha), latitude: Number(draft.latitude), longitude: Number(draft.longitude), history: draft.history.map((h) => ({ year: Number(h.year), crop_id: h.crop_id })) } };
}

export function initialPlanningDraft(cropIds: string[], prior?: PlanningInputs): PlanningDraft {
  const input: PlanningInputs = prior ?? { start_year: new Date().getUTCFullYear() + 1, baseline_crop_ids: [cropIds[0] ?? "", cropIds[0] ?? "", cropIds[0] ?? ""], allowed_crop_ids: cropIds, max_irrigation_mm: 300, max_cost_usd_ha: 1500, max_labor_days_ha: 30, weights: { water: 4, cover: 3, diversity: 3, cost: 2 }, scenario: { rainfall_change_pct: 0, temperature_change_c: 0 }, accept_demo_assumptions: false };
  return { ...input, start_year: String(input.start_year), max_irrigation_mm: String(input.max_irrigation_mm), max_cost_usd_ha: String(input.max_cost_usd_ha), max_labor_days_ha: String(input.max_labor_days_ha) };
}

export function parsePlanningDraft(draft: PlanningDraft, cropIds: string[], history: FieldInput["history"], isDemo: boolean): Validation<PlanningInputs> {
  const year = Number(draft.start_year);
  if (!finite(draft.start_year) || !Number.isInteger(year) || year < 2000 || year > 2100) return { error: "规划起始年需为 2000–2100 之间的年份。" };
  if (history.some((h) => h.year >= year)) return { error: "规划起始年必须晚于所有种植历史年份。" };
  if (draft.baseline_crop_ids.length !== 3 || draft.baseline_crop_ids.some((id) => !cropIds.includes(id))) return { error: "请为基准安排的三年分别选择作物。" };
  if (!draft.allowed_crop_ids.length || draft.allowed_crop_ids.some((id) => !cropIds.includes(id))) return { error: "请至少选择一种愿意种植的作物。" };
  for (const [key, label] of [["max_irrigation_mm", "补灌上限"], ["max_cost_usd_ha", "投入预算"], ["max_labor_days_ha", "劳动上限"]] as const) {
    if (!finite(draft[key]) || Number(draft[key]) < 0) return { error: `${label}需填写大于或等于 0 的数字。` };
  }
  if (Object.values(draft.weights).some((n) => !Number.isFinite(n) || n < 0 || n > 5) || !Object.values(draft.weights).some((n) => n > 0)) return { error: "请至少设置一项大于 0 的优先程度（范围 0–5）。" };
  if (isDemo && !draft.accept_demo_assumptions) return { error: "请先阅读并确认示范假设。" };
  if (!Number.isFinite(draft.scenario.rainfall_change_pct) || draft.scenario.rainfall_change_pct < -50 || draft.scenario.rainfall_change_pct > 50 || !Number.isFinite(draft.scenario.temperature_change_c) || draft.scenario.temperature_change_c < -3 || draft.scenario.temperature_change_c > 5) return { error: "降雨情景需在 −50% 至 +50%，温度情景需在 −3 至 +5°C。" };
  return { value: { ...draft, start_year: year, max_irrigation_mm: Number(draft.max_irrigation_mm), max_cost_usd_ha: Number(draft.max_cost_usd_ha), max_labor_days_ha: Number(draft.max_labor_days_ha) } };
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "这块地已在其他页面更新。你的输入仍保留，请载入最新地块后核对并重试。";
    if (error.status === 401) return "登录已失效。请重新登录；本页草稿会保留。";
    if (error.status === 403) return "当前账户没有访问这份资料的权限。";
    if (error.status === 422) return `请检查输入：${error.message}`;
    return `暂时无法完成，请重试。${error.message}（参考编号 ${error.error.request_id}）`;
  }
  return "网络暂时不可用。输入已保留，请检查连接后重试。";
}
export const formatNumber = (n: number | null, decimals = 0) => n === null ? "暂无数据" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: decimals }).format(n);
export const formatDate = (date: string | null) => date ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(date)) : "未提供";
