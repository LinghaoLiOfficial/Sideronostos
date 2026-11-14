import type { Field } from "./field-shift-types";
import type { RunV2, SavedV2, SeasonV2 } from "./rotation-types";

export const DAILY_MODEL = "rotation-milp-v3.0" as const;
export const DAILY_METRICS = [
  "profit",
  "water",
  "rotation",
  "soil",
  "risk",
  "bare",
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];
export type OptionalDailyMetric = Exclude<DailyMetric, "water" | "bare">;
export type DailyWeights = Record<DailyMetric, number>;
export type DailyMetrics = Record<DailyMetric, number | null>;
export type EvidenceSource = {
  id: string;
  kind:
    | "farmer_record"
    | "expert_reference"
    | "observation"
    | "model_estimate"
    | "engineering_assumption";
  title: string;
  locator: string;
  region_id: string;
  observed_start?: string | null;
  observed_end?: string | null;
  applicable_start?: string | null;
  applicable_end?: string | null;
  quality: "confirmed" | "estimated" | "missing" | "rejected";
  confirmed: boolean;
  limitations: string[];
};
export type RecordedValue = {
  value: number | string | boolean | null;
  unit: string;
  source_ids: string[];
  missing_reason?: string | null;
};
export type DailyCapacity = {
  amount: RecordedValue;
  remediable: boolean | null;
  gap_unit_cost: RecordedValue | null;
  remedy: RecordedValue | null;
};
export type DailyResource = {
  kind: "water" | "machine";
  machine_type?: string | null;
  field_ids: string[];
  water_basis?: "net" | "gross" | null;
  irrigation_efficiency?: RecordedValue | null;
  default: DailyCapacity;
  overrides: Record<string, RecordedValue>;
};
export type DailyPeriod = { id: string; start: string; end: string };
export type DailyFarmResources = {
  daily: Record<string, DailyResource>;
  period_limits: {
    kind: "seed" | "market";
    crop_id: string;
    period_id: string;
    limit: DailyCapacity;
  }[];
};
export const FIELD_PARAMETERS = [
  "field_capacity",
  "wilting_point",
  "depth_m",
  "ph",
  "salinity_ds_m",
  "drainage",
  "slope_deg",
  "aspect",
  "terrain_position",
  "mechanical_access",
  "effective_rain_fraction",
  "history_reviewed",
  "history_state",
  "history_absence_reason",
  "initial_water_policy",
  "management_reviewed",
  "baseline_confirmed",
] as const;
export type FieldParameter = (typeof FIELD_PARAMETERS)[number];
export type DailyFieldConditions = {
  values: Partial<Record<FieldParameter, RecordedValue>>;
  forbidden_crop_ids: string[];
  water_system_id: string | null;
  bare_limit: DailyCapacity | null;
  bare_limit_disabled: string | null;
};
export type DailyDraft = {
  model_version: typeof DAILY_MODEL;
  profile_id: string;
  fields: { id: string; expected_version: number }[];
  start: string;
  end: string;
  allowed_crop_ids: string[];
  periods: DailyPeriod[];
  field_conditions: Record<string, DailyFieldConditions>;
  farm_resources: Record<string, DailyFarmResources>;
  sources: Record<string, EvidenceSource>;
  baseline: { field_id: string; crop_id: string; sow_date: string }[];
  weights: DailyWeights | null;
  disabled_metrics: Partial<Record<OptionalDailyMetric, string>>;
  scenario: { temperature_change_c: number; rainfall_change_pct: number };
  accept_engineering_assumptions: boolean;
};
export type DailyInput = DailyDraft & { idempotency_key: string };
export type DailyCrop = {
  name: string;
  species_id: string;
  family: string;
  sow_windows: [string, string][];
  phenology: {
    turnaround_days: number;
    maturity_gdd: number;
    base_c: number;
    upper_c: number;
    gdd_recipe: string;
    max_growing_days: number;
  };
  seed_kg_ha: number;
  yield_kg_ha: number;
  economics: { price_usd_kg: number; cost_usd_ha: number } | null;
  operations: {
    machine: string;
    anchor: "sow" | "harvest";
    offset_days: number;
    hours_ha: number;
  }[];
};
export type DailyProfile = {
  id: string;
  name: string;
  sha256: string;
  scope: "benchmark_not_locally_calibrated" | "locally_calibrated";
  region_id: string;
  region: string;
  timezone: string;
  weather_day_policy: "utc_daily_proxy_v1" | "require_local_daily";
  weather_release_id: string;
  weather_center: [number, number];
  weather_radius_km: number;
  crops: Record<string, DailyCrop>;
  history_catalogue: Record<
    string,
    { species_id: string; family: string; turnaround_days: number }
  >;
  compatible_history_profile_ids: string[];
  family_gaps: Record<string, number>;
  sowing_step_days: number;
  default_weights: DailyWeights;
  scales: DailyWeights;
  sources: Record<string, EvidenceSource>;
  parameter_origins: Record<string, string[]>;
  parameter_records?: Record<string, RecordedValue>;
  limitations: string[];
};
export type ReadinessItem = {
  path: string;
  value: RecordedValue["value"];
  unit: string;
  expected_unit: string;
  sources: EvidenceSource[];
  missing_reason: string | null;
  status: "not_enabled" | "blocked" | "ready";
  issues: string[];
  warnings: string[];
  engineering_assumption: boolean;
  blocks: string[];
};
export type DailyReadiness = {
  schema: "rotation-readiness-v3.0";
  ready: boolean;
  stage: "data_preflight";
  blocked_features: string[];
  items: ReadinessItem[];
  fingerprint: string;
  farm_versions: { id: string; version: number; partition_revision: string }[];
  weather: {
    ready: boolean;
    issues: string[];
    warnings: string[];
    basis?: string;
    [key: string]: unknown;
  };
};
export type DailyResourceUse = {
  id: string;
  kind: string;
  used: number;
  capacity: number;
  gap: number;
  unit: string;
  remediable: boolean;
  gap_unit_cost: number | null;
  gap_cost: number;
  remedy: string | null;
  evidence_ids: string[];
};
export type DailyVerification = {
  valid: boolean;
  violations: string[];
  metrics: DailyMetrics;
  normalized: Partial<DailyWeights>;
  score: number;
  gap_cost: number;
  resources: DailyResourceUse[];
  diagnostic: boolean;
  resource_feasible: boolean;
  paths: { field_id: string; candidate_ids: string[] }[];
  recipe: string;
  scope: string;
};
export type DailyObjective = {
  weights: DailyWeights;
  scales: Partial<DailyWeights>;
  disabled_metrics: Partial<Record<OptionalDailyMetric, string>>;
  priority: string[];
};
export type DailySolver = {
  status: string;
  selected_ids: string[];
  gap_optimality_proven: boolean;
  score_optimality_proven: boolean;
  gap_cost?: number;
  score?: number;
  runtime_seconds?: number;
  error_code?: string;
  optimality_scope: string;
  preference_id?: string;
};
export type DailyOption = {
  id: string;
  label: string;
  model_version: typeof DAILY_MODEL;
  seasons: SeasonV2[];
  complete: boolean;
  feasible: boolean;
  execution_label:
    | "invalid_baseline"
    | "diagnostic_requires_remedies"
    | "engineering_benchmark"
    | "resource_feasible_scenario";
  verification: DailyVerification;
  scientific_verification: {
    valid: boolean;
    violations: string[];
    recipe: string;
  };
  solver: DailySolver | null;
  objective_definition: DailyObjective;
  preference_id?: string;
  non_dominated_among_generated?: boolean;
};
export type DailyPreparationIssue =
  | string
  | { code: string; field_id?: string; crop_id?: string; sow_date?: string };
export type DailyResult = {
  schema: "rotation-result-v3.0";
  model_version: typeof DAILY_MODEL;
  status: string;
  error_code?: string;
  options: DailyOption[];
  baseline: DailyOption | null;
  solver_attempts?: DailySolver[];
  candidate_count?: number;
  edge_count?: number;
  candidate_recipe?: string;
  limitations?: string[];
  weather_basis?: string;
  weather?: { warnings?: string[]; [key: string]: unknown };
  rejected_by_reason?: Record<string, number>;
  preparation?: {
    stage: string;
    errors: DailyPreparationIssue[];
    rejected_by_reason?: Record<string, number>;
    readiness?: DailyReadiness;
    [key: string]: unknown;
  };
  alternatives?: {
    scope: string;
    distinct_options: number;
    reason: string | null;
    gap_ceiling: number | null;
    gap_ceiling_is_proven_minimum: boolean;
    interpretation: string;
  };
};
export type DailyProvenance = {
  profile_id: string;
  profile_sha256: string;
  weather_release_id: string;
  weather_sha256: string;
  benchmark_scope: string;
  limitations: string[];
  sources: Record<string, EvidenceSource>;
  parameter_origins: Record<string, string[]>;
};
export type DailyRun = {
  id: string;
  job_id: string;
  status: string;
  generation: number;
  created_at: string;
  updated_at: string;
  request: DailyInput;
  field_snapshots: Field[];
  provenance: DailyProvenance;
  result: DailyResult | null;
};
export type DailySaved = {
  schema: "rotation-saved-v3.0";
  id: string;
  run_id: string;
  option_id: string;
  title: string;
  notes: string;
  created_at: string;
  run_created_at: string;
  option: DailyOption;
  input_snapshot: {
    request: DailyInput;
    fields: Field[];
    profile: Omit<DailyProfile, "sha256"> & { sha256?: string };
    provenance: DailyProvenance;
    sources?: unknown;
    farms: unknown[];
  };
};
export type AnyRotationRun = RunV2 | DailyRun;
export type AnySavedPlan = SavedV2 | DailySaved;
export const isDailyRun = (run: AnyRotationRun): run is DailyRun =>
  "model_version" in run.request && run.request.model_version === DAILY_MODEL;
export const isDailySaved = (plan: AnySavedPlan): plan is DailySaved =>
  "schema" in plan && plan.schema === "rotation-saved-v3.0";
export type DailyComparison = {
  first_run_id: string;
  second_run_id: string;
  first_option_id: string;
  second_option_id: string;
  delta: DailyMetrics;
  unavailable_metrics: DailyMetric[];
  model_version: typeof DAILY_MODEL;
  input_changes: Record<string, { before: unknown; after: unknown }>;
  score_comparable: boolean;
  interpretation: string;
};
