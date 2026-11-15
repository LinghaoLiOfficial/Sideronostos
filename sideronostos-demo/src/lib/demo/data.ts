import type { FarmFeature, FieldFeature } from "@/types/workspace";
import type { Field } from "@/lib/api/field-shift-types";
import type { NasaDataRelease, ProfileV2, RotationInput, RotationPreflight, RunV2 } from "@/lib/api/rotation-types";
import { iowaProfile } from "./iowa-backend-data";

export const stamp = "2026-11-15T00:00:00.000Z";
export const DEMO_FARM_ID = "iowa-nasa-benchmark-v1";
export const DEMO_RELEASE_ID = "iowa-nasa-2022-2024-v1";
export const DEMO_PROFILE_ID = iowaProfile.id;

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
    id: DEMO_FARM_ID, name: "Lowa Farm", boundarySource: "imported", partitionCount: 4,
    partitionMethod: "regular-grid", partitionOrientation: "cardinal", partitionGridRows: 2,
    partitionGridColumns: 2, partitionStatus: "confirmed", createdAt: stamp, updatedAt: stamp,
    sourceReleaseId: DEMO_RELEASE_ID, sampleVersion: "iowa-backend-sample-v1",
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
  return { version: 1, farms: [structuredClone(demoFarm)], fields: structuredClone(demoFields), initialized_from: "iowa-backend-sample-v1", created_at: stamp, updated_at: stamp };
}

export function demoFieldsApi(): Field[] {
  return demoFields.map((field, index) => ({
    id: field.properties.id, version: 1, farm_id: DEMO_FARM_ID, local_id: field.properties.id,
    name: field.properties.name, area_ha: 8.7, latitude: 42.0005 + index * 0.0018, longitude: -93.505 + (index % 2) * 0.01,
    geometry: { type: "Polygon", coordinates: field.geometry.coordinates as [number, number][][] }, soil_texture: "loam", irrigation_available: index !== 3,
    profile_id: DEMO_PROFILE_ID, history: [{ year: 2022, crop_id: index % 2 ? "pea" : "maize" }, { year: 2023, crop_id: index % 2 ? "maize" : "oat" }, { year: 2024, crop_id: index % 2 ? "oat" : "pea" }], history_events: [],
    updated_at: stamp, created_at: stamp, partition_revision: "iowa-backend-sample-v1",
  }));
}

export const demoProfile: ProfileV2 = iowaProfile;

export const demoRelease: NasaDataRelease = {
  id: DEMO_RELEASE_ID, manifest_sha256: "7bd63727b0985320319bf28840be362f77dc8ac62b12f74312704f63a1420a7d", status: "published", start: "2022-01-01", end: "2024-12-31", bounds: [-93.56, 41.97, -93.44, 42.05], crs: "EPSG:4326", center: [-93.5, 42], applicability: "Iowa backend NASA historical sample", model_usable: true, complete_days: 1096, expected_days: 1096,
  products: { weather: { model_usable: true, valid_days: 1096, expected_days: 1096 }, precipitation: { model_usable: true, valid_days: 1096, expected_days: 1096 } }, layers: [], evidence_only: [], limitations: ["NASA POWER and GPM historical observations for the Iowa sample area; not a forecast or cadastral survey."], published_at: stamp,
};

export const demoPreflight: RotationPreflight = {
  recipe: "iowa-backend-preflight-v2", profile_id: DEMO_PROFILE_ID, profile_sha256: demoProfile.sha256, profile_version_id: demoProfile.profile_version_id ?? DEMO_PROFILE_ID, sampling_step_days: 7, candidate_count: 84, candidate_count_truncated: false, rejected_candidate_count: 12, transition_edge_count: 48, transition_edge_count_truncated: false, formulation: "annual-layered-state-v1", formulation_eligible: true, formulation_ineligible_reason: null, estimated_variable_count: 128, estimated_constraint_count: 244, solver_capacity_mode: "unrestricted", limits: { max_candidates: 5000, max_transition_edges: 20000, solver_capacity_mode: "unrestricted", max_solver_variables: 10000, max_solver_constraints: 20000 }, within_capacity: true, violations: [],
};

export function demoRun(request: unknown): RunV2 {
  const input = (request && typeof request === "object" ? request : {}) as Partial<RotationInput>
  const normalizedRequest = {
    start: "2022-01-01",
    end: "2024-12-31",
    ...input,
    scenario: { temperature_change_c: 0, rainfall_change_pct: 0, ...(input.scenario ?? {}) },
  } as RotationInput
  const seasons = demoFields.flatMap((field, index) => [{ id: `season-${field.properties.id}`, field_id: field.properties.id, crop_id: index % 2 ? "pea" : "maize", family: index % 2 ? "Fabaceae" : "Poaceae", sow_date: "2027-04-20", harvest_date: "2027-09-25", occupied_until: "2027-10-09", growing_days: 158, turnaround_days: 14, water_gap_mm: 38 }]);
  const verification = { valid: true, violations: [], totals: { water_m3: 12500, cost_usd: 10120, labor_days: 42, cover_ha_days: 8200, diversity_ha_families: 4 }, farm_years: {}, field_years: {}, objective: 0.86 };
  const option = { id: "demo-option-balanced", label: "Backend Iowa balanced rotation", seasons, feasible: true, complete: true, verification, solver: { status: "optimal", objective: 0.86, bound: 0.86, gap: 0, runtime_seconds: 0.04, solution_count: 1, optimality_scope: "backend Iowa fixture" } };
  return { id: "demo-run-1", job_id: "demo-job-1", status: "succeeded", generation: 1, created_at: stamp, updated_at: stamp, request: normalizedRequest, field_snapshots: demoFieldsApi(), provenance: { profile_id: DEMO_PROFILE_ID, profile_sha256: demoProfile.sha256, weather_release_id: DEMO_RELEASE_ID, weather_sha256: "ba81f07b67231a33c1379e3dd0eeb71efc8716772c2412c401830161c3490d0b", benchmark_scope: "Iowa backend NASA historical sample", limitations: ["Historical backend sample; not a planting prescription or cadastral survey."], sources: demoProfile.sources, parameter_origins: { profile: "backend", data: "backend release" }, data_release_id: DEMO_RELEASE_ID, data_release_sha256: demoRelease.manifest_sha256, data_release: demoRelease }, result: { status: "succeeded", options: [option, { ...option, id: "demo-option-cover", label: "Backend Iowa cover-first rotation" }], baseline: { ...option, id: "baseline", label: "Backend Iowa baseline rotation" }, candidate_count: 84, transition_edge_count: 48, capacity: demoPreflight, limitations: ["Historical backend sample; not a planting prescription."], data_release_id: DEMO_RELEASE_ID, options_requested: 2, options_generated: 2 } };
}
