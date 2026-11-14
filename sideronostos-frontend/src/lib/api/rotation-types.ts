import type { Field } from "./field-shift-types";

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };
export type RegionSelection = {
  id: string;
  revision: number;
  kind: "point" | "polygon" | "viewport";
  geometry: Geometry;
  center: [number, number];
  area_ha: number | null;
  created_at: string;
};
export type Source = {
  release_id?: string;
  product?: string;
  product_version?: string;
  sha256?: string;
  recipe?: string;
  url?: string;
  kind?: string;
  field_id?: string;
  run_id?: string;
  option_id?: string;
  [key: string]: unknown;
};
export type ScienceFact = {
  id: string;
  metric: string;
  value: number | null;
  unit?: string;
  status: string;
  pass?: string;
  acquired_at?: string | null;
  retrieval_qual_flag?: number | null;
  surface_flag?: number | null;
  data_kind: string;
  source: Source;
  period: { start: string; end: string };
  limitations: string[];
};
export type RegionFacts = {
  selection: RegionSelection;
  facts: ScienceFact[];
  unavailable: { reason: string; release_id?: string; detail?: string }[];
  online_fetch_performed: false;
};
export type ScienceLayer = {
  id: string;
  title: string;
  pass: string;
  start: string;
  end: string;
  unit: string;
  source: Source;
};
export type LayerManifest = ScienceLayer & {
  type: "raster";
  tile_size: number;
  minzoom: number;
  maxzoom: number;
  tiles: string[];
  bounds: [number, number, number, number];
  legend: { min: number; max: number; colors: string[]; missing: string };
  resampling: string;
  spatial_support: string;
  limitations: string[];
};
export type ResourceLimit = {
  water_m3: number;
  cost_usd: number;
  labor_days: number;
};
export type RotationWeights = {
  cover: number;
  diversity: number;
  water: number;
  cost: number;
};
export type CropV2 = {
  id: string;
  name: string;
  family: string;
  sow_start_mmdd: string;
  sow_end_mmdd: string;
  gdd_required: number;
  turnaround_days: number;
  base_c: number;
  upper_c: number;
  max_growing_days: number;
  kc: [number, number, number];
  stage_fractions: [number, number, number, number];
  cost_usd_ha: number;
  labor_days_ha: number;
  parameter_origins: Record<string, string>;
};
export type ProfileV2 = {
  id: string;
  name: string;
  scope: string;
  sha256: string;
  crops: CropV2[];
  limitations: string[];
  weather_release_id: string;
  weather_center: [number, number];
  weather_radius_km: number;
  history_catalogue: Record<string, string>;
  default_weights: RotationWeights;
  sources: Record<
    string,
    { title: string; url: string | null; kind: string; limitations?: string[] }
  >;
  parameter_origins: Record<string, string>;
  sowing_step_days: number;
};
export type RotationProfileCatalogue = {
  items: ProfileV2[];
  default_profile_id: string;
};
export type RotationInput = {
  idempotency_key: string;
  profile_id: string;
  fields: {
    id: string;
    expected_version: number;
    require_crop: boolean;
    history_reviewed: boolean;
  }[];
  start: string;
  end: string;
  allowed_crop_ids: string[];
  sow_windows: Record<string, [string, string]>;
  farm_limits: Record<string, ResourceLimit>;
  field_limits: Record<string, Record<string, ResourceLimit>>;
  weights: RotationWeights | null;
  scenario: { temperature_change_c: number; rainfall_change_pct: number };
  baseline: { field_id: string; crop_id: string; sow_date: string }[];
  accept_benchmark_assumptions: boolean;
  data_release_id?: string | null;
  horizon_mode?: "1y" | "2y" | "3y" | null;
  max_options?: number;
  solver_time_limit_seconds?: number;
};
export type RotationPreflightInput = Pick<
  RotationInput,
  | "profile_id"
  | "start"
  | "end"
  | "allowed_crop_ids"
  | "sow_windows"
  | "scenario"
  | "data_release_id"
  | "horizon_mode"
> & {
  fields: Array<{
    id: string;
    expected_version: number;
    require_crop: boolean;
  }>;
};
export type CapacityViolation = {
  dimension: "candidates" | "transition_edges";
  count: number;
  limit: number;
  truncated: boolean;
  factors: {
    field_count: number;
    crop_count: number;
    year_count: number;
    sampling_step_days: number;
  };
  message: string;
  suggestion: string;
};
export type RotationPreflight = {
  recipe: string;
  profile_id: string;
  profile_sha256: string;
  sampling_step_days: number;
  candidate_count: number;
  candidate_count_truncated: boolean;
  rejected_candidate_count: number;
  transition_edge_count: number | null;
  transition_edge_count_truncated: boolean;
  limits: { max_candidates: number; max_transition_edges: number };
  within_capacity: boolean;
  violations: CapacityViolation[];
};
export type NasaDataRelease = {
  id: string;
  manifest_sha256: string;
  status: string;
  start: string;
  end: string;
  bounds: [number, number, number, number];
  crs: string;
  center: [number, number];
  applicability: string;
  model_usable: boolean;
  complete_days: number;
  expected_days: number;
  products: Record<string, { model_usable: boolean; evidence_only?: boolean; valid_days?: number; expected_days?: number; product_version?: string; availability?: unknown }>;
  layers: Array<{ id: string; product: string; asset: string; unit: string; bounds: [number, number, number, number]; time?: string; resolution?: string; native_resolution?: string; spatial_support?: string }>;
  evidence_only: string[];
  limitations: string[];
  published_at: string | null;
};
export type Metrics = ResourceLimit & {
  cover_ha_days: number;
  diversity_ha_families: number;
};
export type Verification = {
  valid: boolean;
  violations: string[];
  totals: Metrics;
  farm_years: Record<string, ResourceLimit & { cover_ha_days: number }>;
  field_years: Record<
    string,
    Record<string, ResourceLimit & { cover_ha_days: number }>
  >;
  objective: number;
};
export type SolverResult = {
  status: string;
  objective: number | null;
  bound: number | null;
  gap: number | null;
  runtime_seconds: number;
  solution_count: number;
  optimality_scope: string;
  verification?: Verification;
};
export type SeasonV2 = {
  id: string;
  field_id: string;
  crop_id: string;
  family: string;
  sow_date: string;
  harvest_date: string;
  occupied_until: string;
  growing_days: number;
  turnaround_days: number;
  water_gap_mm: number;
};
export type OptionV2 = {
  id: string;
  label: string;
  seasons: SeasonV2[];
  feasible: boolean;
  complete?: boolean;
  verification: Verification;
  solver: SolverResult | null;
  input_errors?: { reason: string; field_id: string }[];
  scientific_verification?: { valid: boolean; violations: string[] };
};
export type RunResult = {
  status: string;
  error_code?: string;
  options?: OptionV2[];
  baseline?: OptionV2 | null;
  solver_attempts?: SolverResult[];
  weather_basis?: string;
  candidate_count?: number;
  transition_edge_count?: number;
  capacity?: RotationPreflight;
  sampling_step_days?: number;
  rejected_by_reason?: Record<string, number>;
  limitations?: string[];
  scenario_recipe?: string;
  data_release_id?: string | null;
  solver_time_limit_seconds?: number;
  solver_total_runtime_seconds?: number;
  options_requested?: number;
  options_generated?: number;
  evidence_only?: string[];
};
export type RunV2 = {
  id: string;
  job_id: string;
  status: string;
  generation: number;
  created_at: string;
  updated_at: string;
  request: RotationInput;
  field_snapshots: Field[];
  provenance: {
    profile_id: string;
    profile_sha256: string;
    weather_release_id: string;
    weather_sha256: string;
    benchmark_scope: string;
    limitations: string[];
    sources: ProfileV2["sources"];
    parameter_origins: Record<string, string>;
    data_release_id?: string | null;
    data_release_sha256?: string | null;
    data_release?: NasaDataRelease | null;
  };
  result: RunResult | null;
};
export type SavedV2 = {
  id: string;
  run_id: string;
  option_id: string;
  title: string;
  notes: string;
  created_at: string;
  option: OptionV2;
  input_snapshot: {
    request: RotationInput;
    fields: Field[];
    profile: ProfileV2;
    provenance: RunV2["provenance"];
  };
  run_created_at: string;
};
export type PlanSummaryV2 = Pick<
  SavedV2,
  "id" | "run_id" | "option_id" | "title" | "created_at"
>;
export type ComparisonV2 = {
  first_run_id: string;
  second_run_id: string;
  first_option_id: string;
  second_option_id: string;
  delta: Metrics;
  input_changes: Record<string, { before: unknown; after: unknown }>;
  score_comparable: boolean;
  interpretation: string;
};

export type ChangedCondition =
  | "dates"
  | "crops"
  | "sowing_windows"
  | "farm_limits"
  | "field_limits"
  | "weights"
  | "scenario"
  | "baseline"
  | "fields";
export type AssistantContext = {
  revision: number;
  page: "map" | "rotation" | "v1";
  selection?: { id: string; revision: number } | null;
  dates?: { start: string; end: string } | null;
  fields?: { id: string; expected_version: number }[];
  run_id?: string | null;
  plan_id?: string | null;
  option_id?: string | null;
  compare_run_id?: string | null;
  compare_option_id?: string | null;
  analysis_id?: string | null;
  draft?: { dirty: boolean; changed_fields: ChangedCondition[] };
};
export type AssistantAction =
  | "open_planner"
  | "edit_conditions"
  | "choose_field"
  | "view_sources";
export type Fact = {
  id: string;
  key: string;
  label: string;
  value: unknown;
  unit: string;
  display: string;
  source: Source;
  limitations: string[];
};
export type Citation = {
  id: string;
  release_id: string;
  chunk_id: string;
  page: number;
  excerpt: string;
  source: {
    id: string;
    title: string;
    url: string | null;
    access_scope: string;
    locator_type: "pdf_page" | "section";
    regions: string[];
    limitations: string[];
    sha256: string;
    product_version?: string | null;
  };
  claims: {
    statement: string;
    applicability: string[];
    limitations: string[];
  }[];
};
export type AssistantAnswer = {
  paragraphs: { text: string; evidence_ids: string[] }[];
  actions: AssistantAction[];
  needs_clarification: boolean;
  facts?: Fact[];
  citations?: Citation[];
  warnings?: string[];
  retrieval_mode?: string;
  kb_release_id?: string;
};
export type AssistantMessage = {
  id: string;
  sequence: number;
  client_message_id: string;
  status: "pending" | "complete" | "failed" | "interrupted";
  text: string;
  context: AssistantContext;
  context_labels: {
    fields: { id: string; name: string; version: number }[];
    selection_kind: string | null;
    run_id: string | null;
    option_id: string | null;
    plan_id?: string | null;
  };
  response: AssistantAnswer | null;
  facts: Fact[];
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
};
export type AssistantPreferences = {
  language: "zh" | "en";
  detail: "brief" | "detailed";
};
export type Conversation = AssistantPreferences & {
  id: string;
  preset: "rotation";
  kb_release_id: string;
  created_at: string;
  updated_at: string;
};
export type ConversationPage = Conversation & {
  messages: AssistantMessage[];
  next_before_sequence: number | null;
};
