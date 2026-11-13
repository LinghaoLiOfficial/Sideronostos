import { z } from "zod";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  ChangedCondition,
  ProfileV2,
  ResourceLimit,
  RotationInput,
} from "@/lib/api/rotation-types";
export type TextLimit = Record<keyof ResourceLimit, string>;
export type PlannerDraft = Omit<
  RotationInput,
  "farm_limits" | "field_limits" | "idempotency_key"
> & {
  farm_limits: Record<string, TextLimit>;
  field_limits: Record<string, Record<string, TextLimit>>;
};
export const blankLimit = (): TextLimit => ({
  water_m3: "",
  cost_usd: "",
  labor_days: "",
});
export const limitLabels: Record<keyof ResourceLimit, string> = {
  water_m3: "灌溉水量（m³）",
  cost_usd: "投入（USD）",
  labor_days: "劳力（人日）",
};
export const changeLabels: Record<ChangedCondition, string> = {
  dates: "日期",
  crops: "作物",
  sowing_windows: "播种窗口",
  farm_limits: "农场资源",
  field_limits: "地块资源",
  weights: "偏好",
  scenario: "天气情景",
  baseline: "基准种法",
  fields: "地块与历史",
};
export function planningYears(start: string, end: string): string[] {
  const a = new Date(start + "T00:00:00Z"),
    b = new Date(end + "T00:00:00Z");
  if (
    !Number.isFinite(+a) ||
    !Number.isFinite(+b) ||
    +b < +a ||
    (+b - +a) / 86400000 > 1095
  )
    return [];
  return Array.from(
    { length: b.getUTCFullYear() - a.getUTCFullYear() + 1 },
    (_, i) => String(a.getUTCFullYear() + i),
  );
}
export function emptyDraft(profile: ProfileV2): PlannerDraft {
  const year = new Date().getFullYear() + 1;
  return {
    profile_id: profile.id,
    fields: [],
    start: `${year}-01-01`,
    end: `${year + 1}-12-31`,
    allowed_crop_ids: profile.crops.map((c) => c.id),
    sow_windows: {},
    farm_limits: {},
    field_limits: {},
    weights: profile.default_weights,
    scenario: { temperature_change_c: 0, rainfall_change_pct: 0 },
    baseline: [],
    accept_benchmark_assumptions: false,
  };
}
const textLimit = (limit: ResourceLimit): TextLimit => ({
  water_m3: String(limit.water_m3),
  cost_usd: String(limit.cost_usd),
  labor_days: String(limit.labor_days),
});
export function draftFromRun(input: RotationInput): PlannerDraft {
  const copy = structuredClone(input);
  return {
    profile_id: copy.profile_id,
    fields: copy.fields,
    start: copy.start,
    end: copy.end,
    allowed_crop_ids: copy.allowed_crop_ids,
    sow_windows: copy.sow_windows,
    weights: copy.weights,
    scenario: copy.scenario,
    baseline: copy.baseline,
    accept_benchmark_assumptions: copy.accept_benchmark_assumptions,
    farm_limits: Object.fromEntries(
      Object.entries(input.farm_limits).map(([y, l]) => [y, textLimit(l)]),
    ),
    field_limits: Object.fromEntries(
      Object.entries(input.field_limits).map(([id, limits]) => [
        id,
        Object.fromEntries(
          Object.entries(limits).map(([y, l]) => [y, textLimit(l)]),
        ),
      ]),
    ),
  };
}
function numericLimit(limit: TextLimit | undefined): ResourceLimit {
  if (
    !limit ||
    Object.keys(limitLabels).some(
      (k) =>
        !String(limit[k as keyof TextLimit] ?? "").trim() ||
        !Number.isFinite(Number(limit[k as keyof TextLimit])) ||
        Number(limit[k as keyof TextLimit]) < 0,
    )
  )
    throw new Error("请填写每个年度的资源上限，允许填 0，不能留空。");
  return {
    water_m3: Number(limit.water_m3),
    cost_usd: Number(limit.cost_usd),
    labor_days: Number(limit.labor_days),
  };
}
export function buildRequest(
  draft: PlannerDraft,
  profile: ProfileV2,
  fields: Field[],
  key: string,
): RotationInput {
  const years = planningYears(draft.start, draft.end);
  if (!years.length) throw new Error("请检查起止日期，规划跨度不能超过三年。");
  if (!draft.fields.length) throw new Error("请至少选择一个已存地块。");
  for (const choice of draft.fields) {
    const current = fields.find((f) => f.id === choice.id);
    if (
      !current ||
      current.version !== choice.expected_version ||
      !choice.history_reviewed
    )
      throw new Error("地块或历史有变化，请重新核对每个地块。");
  }
  if (!draft.allowed_crop_ids.length)
    throw new Error("请至少选择一种候选作物。");
  if (
    draft.baseline.some(
      (b) =>
        !draft.fields.some((f) => f.id === b.field_id) ||
        !b.crop_id ||
        !b.sow_date ||
        b.sow_date < draft.start ||
        b.sow_date > draft.end,
    )
  )
    throw new Error("请检查基准种法：地块必须已选，播种日期必须在规划期内。");
  const farm_limits = Object.fromEntries(
    years.map((y) => [y, numericLimit(draft.farm_limits[y])]),
  );
  const field_limits = Object.fromEntries(
    Object.entries(draft.field_limits)
      .filter(([id]) => draft.fields.some((f) => f.id === id))
      .map(([id, limits]) => [
        id,
        Object.fromEntries(
          Object.entries(limits)
            .filter(([year]) => years.includes(year))
            .map(([year, l]) => [year, numericLimit(l)]),
        ),
      ]),
  );
  if (!draft.accept_benchmark_assumptions)
    throw new Error("请先阅读并确认研发参数与历史天气的使用范围。");
  if (draft.weights && !Object.values(draft.weights).some((v) => v > 0))
    throw new Error("至少保留一个大于零的偏好权重。");
  return {
    ...structuredClone(draft),
    profile_id: profile.id,
    idempotency_key: key,
    farm_limits,
    field_limits,
  };
}
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export function changedConditions(
  a: RotationInput,
  b: RotationInput,
): ChangedCondition[] {
  const keys: [ChangedCondition, (keyof RotationInput)[]][] = [
    ["dates", ["start", "end"]],
    ["crops", ["allowed_crop_ids"]],
    ["sowing_windows", ["sow_windows"]],
    ["farm_limits", ["farm_limits"]],
    ["field_limits", ["field_limits"]],
    ["weights", ["weights"]],
    ["scenario", ["scenario"]],
    ["baseline", ["baseline"]],
    ["fields", ["fields"]],
  ];
  return keys
    .filter(([, ks]) => ks.some((k) => stable(a[k]) !== stable(b[k])))
    .map(([name]) => name);
}
export function draftChanges(
  input: RotationInput,
  draft: PlannerDraft,
): ChangedCondition[] {
  const old = draftFromRun(input);
  return changedConditions(
    old as unknown as RotationInput,
    draft as unknown as RotationInput,
  );
}
const textLimitSchema = z.object({
  water_m3: z.string(),
  cost_usd: z.string(),
  labor_days: z.string(),
});
const draftSchema = z.object({
  profile_id: z.string(),
  start: z.string(),
  end: z.string(),
  fields: z.array(
    z.object({
      id: z.string(),
      expected_version: z.number().int().positive(),
      require_crop: z.boolean(),
      history_reviewed: z.boolean(),
    }),
  ),
  allowed_crop_ids: z.array(z.string()),
  sow_windows: z.record(z.string(), z.tuple([z.string(), z.string()])),
  farm_limits: z.record(z.string(), textLimitSchema),
  field_limits: z.record(z.string(), z.record(z.string(), textLimitSchema)),
  weights: z
    .object({
      cover: z.number(),
      diversity: z.number(),
      water: z.number(),
      cost: z.number(),
    })
    .nullable(),
  scenario: z.object({
    temperature_change_c: z.number(),
    rainfall_change_pct: z.number(),
  }),
  baseline: z.array(
    z.object({
      field_id: z.string(),
      crop_id: z.string(),
      sow_date: z.string(),
    }),
  ),
  accept_benchmark_assumptions: z.boolean(),
});
export function readDraft(
  owner: string,
  profile: ProfileV2,
): PlannerDraft | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(`rotation-draft:${owner}:${profile.id}`) ?? "null",
    );
    if (
      value?.schema === 1 &&
      value.profile_sha256 === profile.sha256 &&
      value.draft?.profile_id === profile.id
    ) {
      const parsed = draftSchema.safeParse(value.draft);
      return parsed.success ? parsed.data : null;
    }
  } catch {}
  return null;
}
export function saveDraft(
  owner: string,
  profile: ProfileV2,
  draft: PlannerDraft,
) {
  localStorage.setItem(
    `rotation-draft:${owner}:${profile.id}`,
    JSON.stringify({ schema: 1, profile_sha256: profile.sha256, draft }),
  );
}
export function fieldInput(field: Field) {
  return {
    name: field.name,
    area_ha: field.area_ha,
    latitude: field.latitude,
    longitude: field.longitude,
    soil_texture: field.soil_texture,
    irrigation_available: field.irrigation_available,
    profile_id: field.profile_id,
    history: field.history,
    geometry: field.geometry,
    history_events: field.history_events,
  };
}
export const formatValue = (value: number | null | undefined, digits = 1) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(
        value,
      );
export const runStatus: Record<string, string> = {
  pending: "排队中",
  running: "正在计算",
  optimal: "已找到模型最优解",
  feasible: "已有可行解",
  feasible_not_proven: "已有可行解，尚未证明最优",
  timeout_feasible: "限时内找到可行解",
  timeout_no_solution: "限时内未找到可行解",
  infeasible: "当前限制下无可行方案",
  failed: "计算失败",
  cancelled: "已取消",
};
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
