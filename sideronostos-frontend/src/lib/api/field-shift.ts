import { apiRequest } from "./client";
import type { Analysis, Environment, Field, FieldInput, PlanningInputs, Profile, SavedPlan } from "./field-shift-types";

const fieldPath = (id: string) => `/field-shift/fields/${encodeURIComponent(id)}`;
export const listProfiles = () => apiRequest<{ items: Profile[] }>("/field-shift/profiles", { authenticate: false });
export const listFields = () => apiRequest<{ items: Field[] }>("/field-shift/fields");
export const getField = (id: string) => apiRequest<Field>(fieldPath(id));
export const createField = (body: FieldInput) => apiRequest<Field>("/field-shift/fields", { method: "POST", body });
export const updateField = (id: string, body: FieldInput, expectedVersion: number) => apiRequest<Field>(fieldPath(id), { method: "PATCH", body: { ...body, expected_version: expectedVersion } });
export const getEnvironment = (id: string, refresh = false) => apiRequest<Environment>(`${fieldPath(id)}/environment?refresh=${refresh}`);
export const createAnalysis = (id: string, body: PlanningInputs, expectedVersion: number) => apiRequest<Analysis>(`${fieldPath(id)}/analyses`, { method: "POST", body: { ...body, expected_field_version: expectedVersion } });
export const getAnalysis = (id: string) => apiRequest<Analysis>(`/field-shift/analyses/${encodeURIComponent(id)}`);
export const listPlans = (fieldId?: string) => apiRequest<{ items: SavedPlan[] }>(`/field-shift/plans${fieldId ? `?${new URLSearchParams({ field_id: fieldId })}` : ""}`);
export const savePlan = (body: { analysis_id: string; option_id: string; title: string; notes: string }) => apiRequest<SavedPlan>("/field-shift/plans", { method: "POST", body });
export const getPlan = (id: string) => apiRequest<SavedPlan>(`/field-shift/plans/${encodeURIComponent(id)}`);
