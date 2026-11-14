import { apiRequest } from "@/lib/api/client";
import type { AssistantMessage, Citation, Fact } from "@/lib/api/rotation-types";

export type AgentDomain = "field_management" | "remote_sensing" | "local_agriculture" | "rotation";
export type AgentConversation = {
  id: string;
  preset: AgentDomain;
  language: "en" | "zh";
  detail: "brief" | "detailed";
  kb_release_id: string;
  created_at: string;
  updated_at: string;
};
export type AgentConversationPage = AgentConversation & {
  messages: AssistantMessage[];
  next_before_sequence: number | null;
};

const path = (conversation: string) => `/farm-assistant/conversations/${encodeURIComponent(conversation)}`;

export const listConversations = () =>
  apiRequest<{ items: AgentConversation[] }>("/farm-assistant/conversations");

export const createConversation = (body: { preset: AgentDomain; language: "en" | "zh"; detail: "brief" | "detailed" }) =>
  apiRequest<AgentConversation>("/farm-assistant/conversations", { method: "POST", body });

export const getConversation = (conversation: string, before?: number) =>
  apiRequest<AgentConversationPage>(`${path(conversation)}${before ? `?before_sequence=${before}` : ""}`);

export const sendMessage = (conversation: string, body: { client_message_id: string; text: string; context: { page: "map"; revision: number } }) =>
  apiRequest<AssistantMessage>(`${path(conversation)}/messages`, { method: "POST", body });

export const getMessage = (conversation: string, message: string) =>
  apiRequest<AssistantMessage>(`${path(conversation)}/messages/${encodeURIComponent(message)}`);

export const getSource = (conversation: string, message: string, evidence: string) =>
  apiRequest<Fact | Citation>(`${path(conversation)}/messages/${encodeURIComponent(message)}/sources/${encodeURIComponent(evidence)}`);

export const setPreferences = (body: { language: "en" | "zh"; detail: "brief" | "detailed" }, conversation?: string) =>
  apiRequest<{ language: "en" | "zh"; detail: "brief" | "detailed" }>(
    conversation ? `${path(conversation)}/preferences` : "/farm-assistant/preferences",
    { method: "PUT", body },
  );
