import { apiRequest } from "./client";
import type { PlanSummaryV2 } from "./rotation-types";
import {
  isDailyRun,
  isDailySaved,
  type AnyRotationRun,
  type AnySavedPlan,
  type DailyComparison,
  type DailyDraft,
  type DailyInput,
  type DailyProfile,
  type DailyReadiness,
  type DailyRun,
  type DailySaved,
} from "./daily-types";
const root = "/rotation-optimizer",
  id = encodeURIComponent;
const headers = (owner: string) => ({ "X-Workspace-Owner": owner });
export const listDailyProfiles = (owner: string, signal?: AbortSignal) =>
  apiRequest<{ items: DailyProfile[] }>(`${root}/v3/profiles`, {
    headers: headers(owner),
    signal,
  });
export const checkDailyReadiness = (
  owner: string,
  body: DailyDraft,
  signal?: AbortSignal,
) =>
  apiRequest<DailyReadiness>(`${root}/v3/readiness`, {
    method: "POST",
    body,
    headers: headers(owner),
    signal,
  });
export const createDailyRun = (owner: string, body: DailyInput) =>
  apiRequest<DailyRun>(`${root}/v3/runs`, {
    method: "POST",
    body,
    headers: headers(owner),
  });
export const listAllRuns = (owner: string) =>
  apiRequest<{ items: AnyRotationRun[] }>(`${root}/runs`, {
    headers: headers(owner),
  });
export const getAnyRun = (owner: string, value: string) =>
  apiRequest<AnyRotationRun>(`${root}/runs/${id(value)}`, {
    headers: headers(owner),
  });
export async function updateDailyRun(
  owner: string,
  value: string,
  action: "cancel" | "retry",
): Promise<DailyRun> {
  const result = await apiRequest<AnyRotationRun>(
    `${root}/runs/${id(value)}/${action}`,
    { method: "POST", headers: headers(owner) },
  );
  if (!isDailyRun(result)) throw new Error("计算版本不匹配，请重新打开结果。");
  return result;
}
export const exportAnyRun = (owner: string, value: string) =>
  apiRequest<AnyRotationRun & { input_snapshot: unknown }>(
    `${root}/runs/${id(value)}/export`,
    { headers: headers(owner) },
  );
export const listAllPlans = (owner: string) =>
  apiRequest<{ items: PlanSummaryV2[] }>(`${root}/plans`, {
    headers: headers(owner),
  });
export const getAnyPlan = (owner: string, value: string) =>
  apiRequest<AnySavedPlan>(`${root}/plans/${id(value)}`, {
    headers: headers(owner),
  });
export async function saveDailyPlan(
  owner: string,
  body: { run_id: string; option_id: string; title: string; notes: string },
): Promise<DailySaved> {
  const result = await apiRequest<AnySavedPlan>(`${root}/plans`, {
    method: "POST",
    body,
    headers: headers(owner),
  });
  if (!isDailySaved(result))
    throw new Error("保存结果版本不匹配，请刷新计划列表。");
  return result;
}
export const compareDailyRuns = (
  owner: string,
  body: {
    first_run_id: string;
    second_run_id: string;
    first_option_id: string;
    second_option_id: string;
  },
) =>
  apiRequest<DailyComparison>(`${root}/compare`, {
    method: "POST",
    body,
    headers: headers(owner),
  });
