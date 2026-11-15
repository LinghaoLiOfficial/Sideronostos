import type { FarmFeature, FieldFeature } from "@/types/workspace";
import type { Field } from "@/lib/api/field-shift-types";
import type { NasaDataRelease, ProfileV2, RotationInput, RotationPreflight, RunV2 } from "@/lib/api/rotation-types";

export const stamp = "2026-11-15T00:00:00.000Z";
export const DEMO_FARM_ID = "iowa-nasa-benchmark-v1";
export const DEMO_RELEASE_ID = "iowa-nasa-2022-2024-v1";
export const DEMO_PROFILE_ID = "iowa-engineering-v3-20261114";

const rings = [
  [[-93.5096306562, 41.9963549948], [-93.4999717999, 41.9963974692], [-93.5, 42], [-93.509659401, 41.9999575203], [-93.5096306562, 41.9963549948]],
  [[-93.4998510641, 41.996397995], [-93.4901921869, 41.9964396466], [-93.4902198355, 42.0000421826], [-93.4998792574, 42.0000005259], [-93.4998510641, 41.996397995]],
  [[-93.5096601197, 42.0000475834], [-93.5000007051, 42.0000900632], [-93.5000289104, 42.0036925917], [-93.5096888699, 42.0036501065], [-93.5096601197, 42.0000475834]],
  [[-93.4998799623, 42.0000905891], [-93.4902205267, 42.000132246], [-93.4902481804, 42.0037347798], [-93.4999081608, 42.0036931176], [-93.4998799623, 42.0000905891]],
] as [number, number][][];

export const demoFarm: FarmFeature = {
  type: "Feature", id: DEMO_FARM_ID,
  geometry: { type: "Polygon", coordinates: [[[-93.5096888699, 41.9963549948], [-93.4901921869, 41.9963549948], [-93.4901921869, 42.0037347798], [-93.5096888699, 42.0037347798], [-93.5096888699, 41.9963549948]]] },
  properties: {
    id: DEMO_FARM_ID, name: "Iowa NASA benchmark", boundarySource: "synthetic", partitionCount: 4,
    partitionMethod: "regular-grid", partitionOrientation: "cardinal", partitionGridRows: 2,
    partitionGridColumns: 2, partitionStatus: "confirmed", createdAt: stamp, updatedAt: stamp,
    sourceReleaseId: DEMO_RELEASE_ID, sampleVersion: "iowa-four-fields-v1",
  },
};

export const demoFields: FieldFeature[] = rings.map((ring, index) => {
  const id = `${DEMO_FARM_ID}-field-${index + 1}`;
  return {
    type: "Feature", id, geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      id, farmId: DEMO_FARM_ID, name: `Field ${index + 1}`, status: "confirmed",
      partitionIndex: index + 1, boundarySource: "generated", farmerConfirmed: true,
      backendFieldId: id, backendVersion: 1, syncStatus: "synced", createdAt: stamp, updatedAt: stamp,
    },
  };
});

export function demoWorkspace() {
  return { version: 1, farms: [structuredClone(demoFarm)], fields: structuredClone(demoFields), initialized_from: "iowa-four-fields-v1", created_at: stamp, updated_at: stamp };
}

export function demoFieldsApi(): Field[] {
  return demoFields.map((field, index) => ({
    id: field.properties.id, version: 1, farm_id: DEMO_FARM_ID, local_id: field.properties.id,
    name: field.properties.name, area_ha: 8.7, latitude: 42.0005 + index * 0.0018, longitude: -93.505 + (index % 2) * 0.01,
    geometry: { type: "Polygon", coordinates: field.geometry.coordinates as [number, number][][] }, soil_texture: "loam", irrigation_available: index !== 3,
    profile_id: DEMO_PROFILE_ID, history: [{ year: 2025, crop_id: index % 2 ? "soybean" : "maize" }], history_events: [],
    updated_at: stamp, created_at: stamp, partition_revision: "iowa-four-fields-v1",
  }));
}

export const demoProfile: ProfileV2 = {
  id: DEMO_PROFILE_ID, name: "Iowa engineering benchmark", region: "Iowa, USA", scope: "Demonstration benchmark",
  sha256: "demo-profile-sha256", profile_version_id: "iowa-demo-v1", revision: 1,
  crops: [
    { id: "maize", name: "Field maize", family: "cereal", gdd_recipe: "bounded_both_v1", sow_start_mmdd: "04-15", sow_end_mmdd: "05-25", gdd_required: 2600, turnaround_days: 14, base_c: 10, upper_c: 34, max_growing_days: 150, kc: [0.35, 1.2, 0.6], stage_fractions: [0.2, 0.5, 0.3, 0], cost_usd_ha: 410, labor_days_ha: 1.4, parameter_origins: { source: "benchmark" } },
    { id: "soybean", name: "Soybean", family: "legume", gdd_recipe: "bounded_both_v1", sow_start_mmdd: "05-01", sow_end_mmdd: "06-10", gdd_required: 2400, turnaround_days: 12, base_c: 8, upper_c: 35, max_growing_days: 145, kc: [0.4, 1.15, 0.5], stage_fractions: [0.2, 0.5, 0.3, 0], cost_usd_ha: 290, labor_days_ha: 1.1, parameter_origins: { source: "benchmark" } },
    { id: "oats", name: "Oats", family: "cereal", gdd_recipe: "draft_one_sided_v1", sow_start_mmdd: "03-20", sow_end_mmdd: "05-01", gdd_required: 1500, turnaround_days: 10, base_c: 5, upper_c: 30, max_growing_days: 120, kc: [0.4, 1.05, 0.45], stage_fractions: [0.25, 0.45, 0.3, 0], cost_usd_ha: 210, labor_days_ha: 0.9, parameter_origins: { source: "benchmark" } },
  ], limitations: ["Engineering benchmark for demonstration only."], weather_release_id: DEMO_RELEASE_ID, weather_center: [-93.5, 42], weather_radius_km: 25,
  history_catalogue: { maize: "Field maize", soybean: "Soybean", oats: "Oats" }, history_turnaround_days: 14, family_gaps: { cereal: 1, legume: 1 }, effective_rain_fraction: 0.8,
  default_weights: { cover: 0.3, diversity: 0.3, water: 0.2, cost: 0.2 }, references: { cover: 0.3, diversity: 0.3, water: 0.2, cost: 0.2 }, sources: {}, parameter_origins: { profile: "demo fixture" }, sowing_step_days: 7,
};

export const demoRelease: NasaDataRelease = {
  id: DEMO_RELEASE_ID, manifest_sha256: "demo-release-sha256", status: "published", start: "2022-01-01", end: "2024-12-31", bounds: [-93.6, 41.9, -93.4, 42.1], crs: "EPSG:4326", center: [-93.5, 42], applicability: "Iowa benchmark demonstration", model_usable: true, complete_days: 1096, expected_days: 1096,
  products: { weather: { model_usable: true, valid_days: 1096, expected_days: 1096 }, precipitation: { model_usable: true, valid_days: 1096, expected_days: 1096 } }, layers: [], evidence_only: [], limitations: ["Historical benchmark data; not a forecast."], published_at: stamp,
};

export const demoPreflight: RotationPreflight = {
  recipe: "iowa-demo-preflight-v1", profile_id: DEMO_PROFILE_ID, profile_sha256: demoProfile.sha256, profile_version_id: "iowa-demo-v1", sampling_step_days: 7, candidate_count: 84, candidate_count_truncated: false, rejected_candidate_count: 12, transition_edge_count: 48, transition_edge_count_truncated: false, formulation: "annual-layered-state-v1", formulation_eligible: true, formulation_ineligible_reason: null, estimated_variable_count: 128, estimated_constraint_count: 244, solver_capacity_mode: "unrestricted", limits: { max_candidates: 5000, max_transition_edges: 20000, solver_capacity_mode: "unrestricted", max_solver_variables: 10000, max_solver_constraints: 20000 }, within_capacity: true, violations: [],
};

export function demoRun(request: unknown): RunV2 {
  const seasons = demoFields.flatMap((field, index) => [{ id: `season-${field.properties.id}`, field_id: field.properties.id, crop_id: index % 2 ? "soybean" : "maize", family: index % 2 ? "legume" : "cereal", sow_date: "2027-05-01", harvest_date: "2027-09-25", occupied_until: "2027-10-10", growing_days: 147, turnaround_days: 14, water_gap_mm: 38 }]);
  const verification = { valid: true, violations: [], totals: { water_m3: 12500, cost_usd: 10120, labor_days: 42, cover_ha_days: 8200, diversity_ha_families: 4 }, farm_years: {}, field_years: {}, objective: 0.86 };
  const option = { id: "demo-option-balanced", label: "Balanced Iowa rotation", seasons, feasible: true, complete: true, verification, solver: { status: "optimal", objective: 0.86, bound: 0.86, gap: 0, runtime_seconds: 0.04, solution_count: 1, optimality_scope: "demo fixture" } };
  return { id: "demo-run-1", job_id: "demo-job-1", status: "succeeded", generation: 1, created_at: stamp, updated_at: stamp, request: (request ?? {}) as RotationInput, field_snapshots: demoFieldsApi(), provenance: { profile_id: DEMO_PROFILE_ID, profile_sha256: demoProfile.sha256, weather_release_id: DEMO_RELEASE_ID, weather_sha256: "demo-weather", benchmark_scope: "Iowa demonstration benchmark", limitations: ["This is a precomputed demonstration result."], sources: {}, parameter_origins: { demo: "precomputed" }, data_release_id: DEMO_RELEASE_ID, data_release_sha256: demoRelease.manifest_sha256, data_release: demoRelease }, result: { status: "succeeded", options: [option, { ...option, id: "demo-option-cover", label: "Cover-first rotation" }], baseline: option, candidate_count: 84, transition_edge_count: 48, capacity: demoPreflight, limitations: ["Demonstration result; not a planting prescription."], data_release_id: DEMO_RELEASE_ID, options_requested: 2, options_generated: 2 } };
}
