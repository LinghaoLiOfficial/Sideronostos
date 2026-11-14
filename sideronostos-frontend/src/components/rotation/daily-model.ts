import { z } from "zod";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type { ChangedCondition } from "@/lib/api/rotation-types";
import {
  DAILY_MODEL,
  FIELD_PARAMETERS,
  type DailyCapacity,
  type DailyDraft,
  type DailyFieldConditions,
  type DailyInput,
  type DailyPeriod,
  type DailyProfile,
  type FieldParameter,
  type RecordedValue,
} from "@/lib/api/daily-types";

export const metricLabels = {
  profit: "收益估计",
  water: "净灌溉量",
  rotation: "轮作衔接",
  soil: "土壤贡献",
  risk: "气象与灌溉暴露",
  bare: "裸地面积天数",
} as const;
export const metricUnits = {
  profit: "USD",
  water: "m³",
  rotation: "分",
  soil: "分·ha",
  risk: "分·ha",
  bare: "ha·天",
} as const;
export const fieldParameters: Record<
  FieldParameter,
  {
    label: string;
    unit: string;
    kind: "number" | "boolean" | "text";
    options?: [string, string][];
  }
> = {
  field_capacity: { label: "田间持水量 FC", unit: "m3/m3", kind: "number" },
  wilting_point: { label: "永久萎蔫点 WP", unit: "m3/m3", kind: "number" },
  depth_m: { label: "有效土层深度", unit: "m", kind: "number" },
  ph: { label: "土壤 pH", unit: "pH", kind: "number" },
  salinity_ds_m: { label: "土壤盐度", unit: "dS/m", kind: "number" },
  drainage: {
    label: "排水状况",
    unit: "category",
    kind: "text",
    options: [
      ["poor", "较差"],
      ["moderate", "中等"],
      ["well", "良好"],
    ],
  },
  slope_deg: { label: "坡度", unit: "degree", kind: "number" },
  aspect: {
    label: "坡向",
    unit: "category",
    kind: "text",
    options: [
      ["flat", "平地"],
      ["north", "北"],
      ["east", "东"],
      ["south", "南"],
      ["west", "西"],
    ],
  },
  terrain_position: {
    label: "地形位置",
    unit: "category",
    kind: "text",
    options: [
      ["level", "平坦"],
      ["slope", "坡地"],
      ["depression", "洼地"],
    ],
  },
  mechanical_access: { label: "农机可进入地块", unit: "1", kind: "boolean" },
  effective_rain_fraction: {
    label: "有效降雨比例（0–1）",
    unit: "1",
    kind: "number",
  },
  history_reviewed: {
    label: "已核对保存的种植历史",
    unit: "1",
    kind: "boolean",
  },
  history_state: {
    label: "前茬资料状态",
    unit: "category",
    kind: "text",
    options: [
      ["recorded", "已有保存记录"],
      ["no_prior_crop", "确认此前未种植"],
    ],
  },
  history_absence_reason: {
    label: "此前未种植的依据",
    unit: "text",
    kind: "text",
  },
  initial_water_policy: {
    label: "候选开始时的土壤水分假设",
    unit: "category",
    kind: "text",
    options: [
      ["independent_wilting_point_v1", "每个候选从萎蔫点开始（保守假设）"],
    ],
  },
  management_reviewed: {
    label: "已核对经营与禁种条件",
    unit: "1",
    kind: "boolean",
  },
  baseline_confirmed: {
    label: "已核对下方原定种法",
    unit: "1",
    kind: "boolean",
  },
};

const text = z.string().max(2000),
  key = z.string().min(1).max(100);
const recordSchema = z
  .object({
    value: z.union([z.number().finite(), text, z.boolean(), z.null()]),
    unit: z.string().min(1).max(40),
    source_ids: z.array(key).max(20),
    missing_reason: text.nullable().optional(),
  })
  .strict();
const capacitySchema = z
  .object({
    amount: recordSchema,
    remediable: z.boolean().nullable(),
    gap_unit_cost: recordSchema.nullable(),
    remedy: recordSchema.nullable(),
  })
  .strict();
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const resourceSchema = z
  .object({
    kind: z.enum(["water", "machine"]),
    machine_type: key.nullable().optional(),
    field_ids: z.array(key).max(10),
    water_basis: z.enum(["net", "gross"]).nullable().optional(),
    irrigation_efficiency: recordSchema.nullable().optional(),
    default: capacitySchema,
    overrides: z.record(dateText, recordSchema),
  })
  .strict();
const conditionSchema = z
  .object({
    values: z.partialRecord(z.enum(FIELD_PARAMETERS), recordSchema),
    forbidden_crop_ids: z.array(key).max(100),
    water_system_id: key.nullable(),
    bare_limit: capacitySchema.nullable(),
    bare_limit_disabled: text.nullable(),
  })
  .strict();
const weightsSchema = z
  .object({
    profit: z.number().finite(),
    water: z.number().finite(),
    rotation: z.number().finite(),
    soil: z.number().finite(),
    risk: z.number().finite(),
    bare: z.number().finite(),
  })
  .strict();
const sourceSchema = z
  .object({
    id: key,
    kind: z.enum([
      "farmer_record",
      "expert_reference",
      "observation",
      "model_estimate",
      "engineering_assumption",
    ]),
    title: text,
    locator: text,
    region_id: key,
    observed_start: dateText.nullable().optional(),
    observed_end: dateText.nullable().optional(),
    applicable_start: dateText.nullable().optional(),
    applicable_end: dateText.nullable().optional(),
    quality: z.enum(["confirmed", "estimated", "missing", "rejected"]),
    confirmed: z.boolean(),
    limitations: z.array(text).max(30),
  })
  .strict();
// Stored drafts may be incomplete. Runtime checks protect rendering; readiness owns scientific validation.
export const dailyDraftSchema = z
  .object({
    model_version: z.literal(DAILY_MODEL),
    profile_id: key,
    fields: z
      .array(
        z
          .object({ id: key, expected_version: z.number().int().min(1) })
          .strict(),
      )
      .max(10),
    start: z.string().max(10),
    end: z.string().max(10),
    allowed_crop_ids: z.array(key).max(20),
    periods: z
      .array(
        z
          .object({
            id: key,
            start: z.string().max(10),
            end: z.string().max(10),
          })
          .strict(),
      )
      .max(36),
    field_conditions: z.record(key, conditionSchema),
    farm_resources: z.record(
      key,
      z
        .object({
          daily: z.record(key, resourceSchema),
          period_limits: z
            .array(
              z
                .object({
                  kind: z.enum(["seed", "market"]),
                  crop_id: key,
                  period_id: key,
                  limit: capacitySchema,
                })
                .strict(),
            )
            .max(2000),
        })
        .strict(),
    ),
    sources: z.record(key, sourceSchema),
    baseline: z
      .array(
        z
          .object({ field_id: key, crop_id: key, sow_date: z.string().max(10) })
          .strict(),
      )
      .max(60),
    weights: weightsSchema.nullable(),
    disabled_metrics: z.partialRecord(
      z.enum(["profit", "rotation", "soil", "risk"]),
      text,
    ),
    scenario: z
      .object({
        temperature_change_c: z.number().finite(),
        rainfall_change_pct: z.number().finite(),
      })
      .strict(),
    accept_engineering_assumptions: z.boolean(),
  })
  .strict();
const pendingSchema = dailyDraftSchema.extend({
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function unknownRecord(unit: string): RecordedValue {
  return {
    value: null,
    unit,
    source_ids: [],
    missing_reason: "尚未提供 / Not supplied",
  };
}
export function suppliedRecord(
  value: Exclude<RecordedValue["value"], null>,
  unit: string,
  source_ids: string[],
): RecordedValue {
  return { value, unit, source_ids };
}
export function numberRecord(
  value: string,
  unit: string,
  source_ids: string[],
): RecordedValue {
  return value.trim() !== "" && Number.isFinite(Number(value))
    ? suppliedRecord(Number(value), unit, source_ids)
    : { ...unknownRecord(unit), source_ids };
}
export function blankCapacity(unit: string): DailyCapacity {
  return {
    amount: unknownRecord(unit),
    remediable: null,
    gap_unit_cost: null,
    remedy: null,
  };
}
export function blankFieldConditions(): DailyFieldConditions {
  return {
    values: {},
    forbidden_crop_ids: [],
    water_system_id: null,
    bare_limit: null,
    bare_limit_disabled: null,
  };
}
export function activePlanningFields(
  fields: Field[],
  farms: ServerFarmHeader[],
): Field[] {
  const partitions = new Map(farms.map((f) => [f.id, f.partition_revision]));
  return fields.filter(
    (f) =>
      Boolean(f.farm_id) && partitions.get(f.farm_id!) === f.partition_revision,
  );
}
function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / 86400000
    : NaN;
}
export function annualPeriods(start: string, end: string): DailyPeriod[] {
  const first = day(start),
    last = day(end);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    last - first > 1095
  )
    return [];
  const result = [];
  for (
    let year = Number(start.slice(0, 4));
    year <= Number(end.slice(0, 4));
    year++
  )
    result.push({
      id: `year-${year}`,
      start: start > `${year}-01-01` ? start : `${year}-01-01`,
      end: end < `${year}-12-31` ? end : `${year}-12-31`,
    });
  return result;
}
export function emptyDailyDraft(
  profile: DailyProfile,
  year = new Date().getFullYear() + 1,
): DailyDraft {
  const start = `${year}-01-01`,
    end = `${year}-12-31`;
  return {
    model_version: DAILY_MODEL,
    profile_id: profile.id,
    fields: [],
    start,
    end,
    allowed_crop_ids: Object.keys(profile.crops),
    periods: annualPeriods(start, end),
    field_conditions: {},
    farm_resources: {},
    sources: {},
    baseline: [],
    weights: { ...profile.default_weights },
    disabled_metrics: {},
    scenario: { temperature_change_c: 0, rainfall_change_pct: 0 },
    accept_engineering_assumptions: false,
  };
}
/** Called only after an explicit field/crop/period choice, never to accept a newer server version implicitly. */
export function selectDailyFields(
  draft: DailyDraft,
  selected: Field[],
  profile: DailyProfile,
): DailyDraft {
  if (selected.length > 10)
    throw new Error(
      "每次最多计算 10 个地块；请明确分批，系统不会自动丢弃地块。",
    );
  if (
    new Set(selected.map((f) => f.id)).size !== selected.length ||
    selected.some((f) => !f.farm_id)
  )
    throw new Error("请选择已同步到农场的经营地块。");
  const next = clone(draft),
    ids = new Set(selected.map((f) => f.id));
  next.fields = selected.map((f) => ({
    id: f.id,
    expected_version:
      draft.fields.find((c) => c.id === f.id)?.expected_version ?? f.version,
  }));
  next.field_conditions = Object.fromEntries(
    selected.map((f) => [
      f.id,
      next.field_conditions[f.id] ?? blankFieldConditions(),
    ]),
  );
  next.baseline = next.baseline.filter(
    (b) => ids.has(b.field_id) && next.allowed_crop_ids.includes(b.crop_id),
  );
  const farms = [...new Set(selected.map((f) => f.farm_id!))];
  next.farm_resources = Object.fromEntries(
    farms.map((id) => [
      id,
      next.farm_resources[id] ?? { daily: {}, period_limits: [] },
    ]),
  );
  const machineTypes = [
    ...new Set(
      next.allowed_crop_ids.flatMap(
        (id) => profile.crops[id]?.operations.map((op) => op.machine) ?? [],
      ),
    ),
  ];
  for (const farmId of farms) {
    const fields = selected.filter((f) => f.farm_id === farmId),
      farm = next.farm_resources[farmId];
    for (const resource of Object.values(farm.daily))
      resource.field_ids = resource.field_ids.filter((id) =>
        fields.some(
          (f) =>
            f.id === id &&
            (resource.kind !== "water" || f.irrigation_available),
        ),
      );
    for (const field of fields)
      if (!field.irrigation_available)
        next.field_conditions[field.id].water_system_id = null;
    // Supply blank groups as an editable scaffold; ownership/membership still needs review.
    const irrigated = fields.filter((f) => f.irrigation_available);
    const waterId = `${farmId}-water`;
    if (
      !Object.values(farm.daily).some((r) => r.kind === "water") &&
      irrigated.length
    )
      farm.daily[waterId] = {
        kind: "water",
        field_ids: irrigated.map((f) => f.id),
        water_basis: null,
        default: blankCapacity("m3/day"),
        overrides: {},
      };
    for (const f of irrigated) {
      const prior = next.field_conditions[f.id].water_system_id;
      if (!prior && farm.daily[waterId]) {
        next.field_conditions[f.id].water_system_id = waterId;
        if (!farm.daily[waterId].field_ids.includes(f.id))
          farm.daily[waterId].field_ids.push(f.id);
      }
    }
    for (const machine of machineTypes) {
      const id = `resource-${crypto.randomUUID()}`;
      if (
        !Object.values(farm.daily).some(
          (r) => r.kind === "machine" && r.machine_type === machine,
        )
      )
        farm.daily[id] = {
          kind: "machine",
          machine_type: machine,
          field_ids: fields.map((f) => f.id),
          default: blankCapacity("h/day"),
          overrides: {},
        };
    }
    farm.period_limits = next.periods.flatMap((period) =>
      next.allowed_crop_ids.flatMap((crop) =>
        (["seed", "market"] as const).map(
          (kind) =>
            farm.period_limits.find(
              (p) =>
                p.kind === kind &&
                p.crop_id === crop &&
                p.period_id === period.id,
            ) ?? {
              kind,
              crop_id: crop,
              period_id: period.id,
              limit: blankCapacity("kg"),
            },
        ),
      ),
    );
  }
  return next;
}

export function applyEngineeringFixture(
  draft: DailyDraft,
  fields: Field[],
  profile: DailyProfile,
): DailyDraft {
  if (profile.scope !== "benchmark_not_locally_calibrated")
    throw new Error("工程假设仅适用于工程基准参数包。");
  const next = clone(draft),
    source = "engineering-fixture";
  next.sources[source] = {
    id: source,
    kind: "engineering_assumption",
    title: "Explicit engineering fixture / 用户选择的工程演示假设",
    locator: "integration:model-v3-engineering-fixture",
    region_id: profile.region_id,
    applicable_start: next.start,
    applicable_end: next.end,
    quality: "estimated",
    confirmed: true,
    limitations: [
      "Synthetic operating assumptions, not field measurements or farmer records; requires local calibration.",
    ],
  };
  for (const choice of next.fields) {
    const field = fields.find((f) => f.id === choice.id);
    if (!field) continue;
    const conditions = next.field_conditions[choice.id],
      values = conditions.values;
    const assumptions: Record<
      FieldParameter,
      Exclude<RecordedValue["value"], null>
    > = {
      field_capacity: 0.3,
      wilting_point: 0.12,
      depth_m: 1,
      ph: 6.5,
      salinity_ds_m: 0.5,
      drainage: "well",
      slope_deg: 2,
      aspect: "flat",
      terrain_position: "level",
      mechanical_access: true,
      effective_rain_fraction: 0.8,
      history_reviewed: true,
      history_state:
        field.history.length || field.history_events?.length
          ? "recorded"
          : "no_prior_crop",
      history_absence_reason:
        "Engineering fixture assumes previously uncropped land; not a real farmer declaration.",
      initial_water_policy: "independent_wilting_point_v1",
      management_reviewed: true,
      baseline_confirmed: true,
    };
    for (const name of FIELD_PARAMETERS)
      if (values[name]?.value == null)
        values[name] = suppliedRecord(
          assumptions[name],
          fieldParameters[name].unit,
          [source],
        );
    if (!conditions.bare_limit && !conditions.bare_limit_disabled)
      conditions.bare_limit_disabled =
        "Engineering fixture: no bare-day cap imposed; confirm local requirements before use.";
    if (!next.baseline.some((b) => b.field_id === field.id)) {
      const crop = next.allowed_crop_ids[0];
      const dates = annualPeriods(next.start, next.end)
        .flatMap((p) =>
          (profile.crops[crop]?.sow_windows ?? []).map(
            ([from]) => `${p.start.slice(0, 4)}-${from}`,
          ),
        )
        .filter((d) => d >= next.start && d <= next.end);
      if (dates[0])
        next.baseline.push({
          field_id: field.id,
          crop_id: crop,
          sow_date: dates[0],
        });
    }
  }
  function fill(cap: DailyCapacity, value: number, unit: string) {
    if (cap.amount.value == null)
      cap.amount = suppliedRecord(value, unit, [source]);
    if (cap.remediable === null) cap.remediable = false;
  }
  for (const farm of Object.values(next.farm_resources)) {
    for (const r of Object.values(farm.daily)) {
      fill(
        r.default,
        r.kind === "water" ? 1000 : 16,
        r.kind === "water" ? "m3/day" : "h/day",
      );
      if (r.kind === "water" && !r.water_basis) r.water_basis = "net";
    }
    for (const p of farm.period_limits) fill(p.limit, 100000, "kg");
  }
  // A separate acknowledgement is required; this action never changes saved fields/history.
  return next;
}

export function prepareDailyRequest(
  draft: DailyDraft,
  profile: DailyProfile,
  fields: Field[],
  farms: ServerFarmHeader[],
  idempotency_key: string,
): DailyInput {
  const parsed = dailyDraftSchema.safeParse(draft);
  if (!parsed.success) throw new Error("规划草稿格式有误，请检查输入后重试。");
  if (draft.profile_id !== profile.id)
    throw new Error("参数包已改变，请重新核对草稿。");
  if (!draft.fields.length || !draft.allowed_crop_ids.length)
    throw new Error("请选择经营地块和候选作物。");
  const active = activePlanningFields(fields, farms);
  for (const choice of draft.fields) {
    const field = active.find((f) => f.id === choice.id);
    if (!field)
      throw new Error("所选地块已不在当前农场分割中，请返回地图核对。");
    if (field.version !== choice.expected_version)
      throw new Error("地块版本已更新，请核对新资料并确认版本。");
  }
  const weights = draft.weights ?? profile.default_weights;
  if (
    weights.water <= 0 ||
    Object.values(weights).some((v) => v < 0 || v > 1) ||
    Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) > 1e-9
  )
    throw new Error(
      "六项偏好权重合计须为 100%，节水权重须大于 0；可按当前比例归一化。",
    );
  if (Object.values(draft.disabled_metrics).some((reason) => !reason.trim()))
    throw new Error("请说明停用可选指标的原因。");
  if (
    Object.values(draft.sources).some(
      (source) =>
        !source.title.trim() ||
        !source.locator.trim() ||
        !source.limitations.some((value) => value.trim()),
    )
  )
    throw new Error("请补齐资料来源的名称、记录位置和适用限制。");
  const first = day(draft.start),
    last = day(draft.end);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    first > last ||
    last - first > 1095
  )
    throw new Error("规划日期须有效、有序且不超过三年。");
  let cursor = first;
  for (const period of [...draft.periods].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    if (day(period.start) !== cursor || day(period.end) < cursor)
      throw new Error("资源分期须连续覆盖规划日期，不得重叠或留空。");
    cursor = day(period.end) + 1;
  }
  if (cursor !== last + 1) throw new Error("资源分期须覆盖整个规划期。");
  if (
    draft.baseline.some(
      (b) =>
        !draft.fields.some((f) => f.id === b.field_id) ||
        !draft.allowed_crop_ids.includes(b.crop_id) ||
        !Number.isFinite(day(b.sow_date)) ||
        b.sow_date < draft.start ||
        b.sow_date > draft.end,
    )
  )
    throw new Error("原定种法的地块、作物或播种日期需重新核对。");
  // Missing scientific values deliberately reach readiness; they cannot reach a job until the server approves them.
  return pendingSchema.parse({ ...parsed.data, idempotency_key });
}
// These optional fields have the same absent/null meaning in the API contract.
// Required values (including a numeric zero versus unknown null) are never discarded.
const optionalNullDefaults = new Set([
  "missing_reason",
  "machine_type",
  "water_basis",
  "irrigation_efficiency",
  "observed_start",
  "observed_end",
  "applicable_start",
  "applicable_end",
]);
// PostgreSQL JSONB and API validation may reorder object keys; that is not an input edit.
function stableInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableInput);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, child]) => child !== null || !optionalNullDefaults.has(key),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableInput(child)]),
    );
  return value;
}
export function dailyChanges(
  before: DailyDraft | DailyInput,
  after: DailyDraft | DailyInput,
): ChangedCondition[] {
  const groups: [ChangedCondition, (keyof DailyDraft)[]][] = [
    ["fields", ["fields"]],
    ["dates", ["start", "end", "periods"]],
    ["crops", ["allowed_crop_ids", "profile_id"]],
    ["field_limits", ["field_conditions"]],
    [
      "farm_limits",
      ["farm_resources", "sources", "accept_engineering_assumptions"],
    ],
    ["weights", ["weights", "disabled_metrics"]],
    ["scenario", ["scenario"]],
    ["baseline", ["baseline"]],
  ];
  return groups
    .filter(([, keys]) =>
      keys.some(
        (key) =>
          JSON.stringify(stableInput(before[key])) !==
          JSON.stringify(stableInput(after[key])),
      ),
    )
    .map(([group]) => group);
}
export function saveDailyDraft(
  owner: string,
  profile: DailyProfile,
  draft: DailyDraft,
) {
  localStorage.setItem(
    `rotation-v3-draft:${owner}:${profile.id}`,
    JSON.stringify({ schema: 1, profile_sha256: profile.sha256, draft }),
  );
}
export function readDailyDraft(
  owner: string,
  profile: DailyProfile,
): DailyDraft | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(`rotation-v3-draft:${owner}:${profile.id}`) ??
        "null",
    );
    if (stored?.schema !== 1 || stored.profile_sha256 !== profile.sha256)
      return null;
    const value = dailyDraftSchema.safeParse(stored.draft);
    return value.success && value.data.profile_id === profile.id
      ? value.data
      : null;
  } catch {
    return null;
  }
}
export function savePendingDaily(owner: string, request: DailyInput) {
  const existing = readPendingDaily(owner);
  if (existing && existing.idempotency_key !== request.idempotency_key)
    throw new Error("此账号还有一次未确认提交，请先按原请求重试。");
  localStorage.setItem(`rotation-v3-pending:${owner}`, JSON.stringify(request));
}
export function readPendingDaily(owner: string): DailyInput | null {
  try {
    const result = pendingSchema.safeParse(
      JSON.parse(
        localStorage.getItem(`rotation-v3-pending:${owner}`) ?? "null",
      ),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function clearPendingDaily(owner: string, expectedKey: string) {
  if (readPendingDaily(owner)?.idempotency_key === expectedKey)
    localStorage.removeItem(`rotation-v3-pending:${owner}`);
}
