import { apiBlob, apiRequest } from "./client";
import type {
  AssistantContext,
  AssistantMessage,
  AssistantPreferences,
  Citation,
  ComparisonV2,
  Conversation,
  ConversationPage,
  Fact,
  Geometry,
  LayerManifest,
  NasaDataRelease,
  PlanSummaryV2,
  RegionFacts,
  RegionSelection,
  RotationInput,
  RotationPreflight,
  RotationPreflightInput,
  RotationProfileCatalogue,
  RunV2,
  SavedV2,
  ScienceLayer,
} from "./rotation-types";

const id = encodeURIComponent;
const conversationPath = (value: string) =>
  `/farm-assistant/conversations/${id(value)}`;
export const createSelection = (
  kind: RegionSelection["kind"],
  geometry: Geometry,
  revision: number,
  signal?: AbortSignal,
) =>
  apiRequest<RegionSelection>("/agri-data/selections", {
    method: "POST",
    body: { kind, geometry, revision },
    signal,
  });
export const getSelection = (value: string) =>
  apiRequest<RegionSelection>(`/agri-data/selections/${id(value)}`);
export const getRegionFacts = (
  selection: RegionSelection,
  dates?: { start: string; end: string },
  signal?: AbortSignal,
) =>
  apiRequest<RegionFacts>(
    `/agri-data/selections/${id(selection.id)}/facts?${new URLSearchParams({ expected_revision: String(selection.revision), ...dates })}`,
    { signal },
  );
export const listLayers = () =>
  apiRequest<{ items: ScienceLayer[] }>("/agri-data/layers");
export const getLayerManifest = (value: string) =>
  apiRequest<LayerManifest>(`/agri-data/layers/${id(value)}/manifest`);
export const listRotationProfiles = () =>
  apiRequest<RotationProfileCatalogue>("/rotation-optimizer/profiles");
export const preflightRotation = (body: RotationPreflightInput) =>
  apiRequest<RotationPreflight>("/rotation-optimizer/preflight", {
    method: "POST",
    body,
  });
export const listNasaDataReleases = () =>
  apiRequest<{ items: NasaDataRelease[] }>("/rotation-optimizer/data-releases");
export const getNasaDataRelease = (value: string) =>
  apiRequest<NasaDataRelease>(`/rotation-optimizer/data-releases/${id(value)}`);
export const createRun = (body: RotationInput) =>
  apiRequest<RunV2>("/rotation-optimizer/runs", { method: "POST", body });
export const listRuns = () =>
  apiRequest<{ items: RunV2[] }>("/rotation-optimizer/runs");
export const getRun = (value: string) =>
  apiRequest<RunV2>(`/rotation-optimizer/runs/${id(value)}`);
export const cancelRun = (value: string) =>
  apiRequest<RunV2>(`/rotation-optimizer/runs/${id(value)}/cancel`, {
    method: "POST",
  });
export const retryRun = (value: string) =>
  apiRequest<RunV2>(`/rotation-optimizer/runs/${id(value)}/retry`, {
    method: "POST",
  });
export const exportRun = (value: string) =>
  apiRequest<RunV2 & { input_snapshot: unknown }>(
    `/rotation-optimizer/runs/${id(value)}/export`,
  );
export const exportRunCsv = (value: string) =>
  apiBlob(`/rotation-optimizer/runs/${id(value)}/export.csv`);
export const listRotationPlans = () =>
  apiRequest<{ items: PlanSummaryV2[] }>("/rotation-optimizer/plans");
export const getRotationPlan = (value: string) =>
  apiRequest<SavedV2>(`/rotation-optimizer/plans/${id(value)}`);
export const saveRotationPlan = (body: {
  run_id: string;
  option_id: string;
  title: string;
  notes: string;
}) =>
  apiRequest<SavedV2>("/rotation-optimizer/plans", { method: "POST", body });
export const compareRuns = (body: {
  first_run_id: string;
  second_run_id: string;
  first_option_id: string;
  second_option_id: string;
}) =>
  apiRequest<ComparisonV2>("/rotation-optimizer/compare", {
    method: "POST",
    body,
  });
export const listPresets = () =>
  apiRequest<{
    items: {
      id: "rotation";
      enabled: true;
      name: string;
      name_en: string;
      description: string;
      color: string;
    }[];
  }>("/farm-assistant/presets");
export const getPreferences = () =>
  apiRequest<AssistantPreferences>("/farm-assistant/preferences");
export const setPreferences = (
  body: AssistantPreferences,
  conversation?: string,
) =>
  apiRequest<AssistantPreferences>(
    conversation
      ? `${conversationPath(conversation)}/preferences`
      : "/farm-assistant/preferences",
    { method: "PUT", body },
  );
export const listConversations = () =>
  apiRequest<{ items: Conversation[] }>("/farm-assistant/conversations");
export const createConversation = (body: Partial<AssistantPreferences> = {}) =>
  apiRequest<Conversation>("/farm-assistant/conversations", {
    method: "POST",
    body: { preset: "rotation", ...body },
  });
export const getConversation = (
  value: string,
  before?: number,
  signal?: AbortSignal,
) =>
  apiRequest<ConversationPage>(
    `${conversationPath(value)}${before ? `?before_sequence=${before}` : ""}`,
    { signal },
  );
export const sendMessage = (
  conversation: string,
  body: { client_message_id: string; text: string; context: AssistantContext },
  signal?: AbortSignal,
) =>
  apiRequest<AssistantMessage>(`${conversationPath(conversation)}/messages`, {
    method: "POST",
    body,
    signal,
  });
export const getMessage = (conversation: string, message: string) =>
  apiRequest<AssistantMessage>(
    `${conversationPath(conversation)}/messages/${id(message)}`,
  );
export const getMessageSource = (
  conversation: string,
  message: string,
  evidence: string,
) =>
  apiRequest<Fact | Citation>(
    `${conversationPath(conversation)}/messages/${id(message)}/sources/${id(evidence)}`,
  );
