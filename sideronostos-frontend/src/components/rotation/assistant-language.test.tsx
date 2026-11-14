import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "@/lib/i18n/provider";
import { LanguageSwitch } from "@/components/language-switch";
import { AssistantDock } from "./assistant-dock";
const api = vi.hoisted(() => ({ createConversation: vi.fn(), getConversation: vi.fn(), sendMessage: vi.fn(), getPreferences: vi.fn(), setPreferences: vi.fn(), listConversations: vi.fn(), getMessageSource: vi.fn() }));
vi.mock("@/lib/api/rotation", () => api);
const context = { page: "map" as const, revision: 1, fields: [{ id: "field", expected_version: 1 }] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<LocaleProvider initialLocale="en"><QueryClientProvider client={client}><LanguageSwitch /><AssistantDock ownerId="language-owner" context={context} contextLabel="West field" onAction={() => {}} /></QueryClientProvider></LocaleProvider>);
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  api.getPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.createConversation.mockImplementation(async (prefs) => ({ id: "chat", ...prefs }));
  api.getConversation.mockResolvedValue({ id: "chat", language: "zh", detail: "brief", messages: [], next_before_sequence: null });
  api.setPreferences.mockImplementation(async (prefs) => prefs);
  api.sendMessage.mockImplementation(async (_id, body) => ({ id: "reply", sequence: 1, client_message_id: body.client_message_id, text: body.text, status: "complete", response: { paragraphs: [{ text: "Reply received", evidence_ids: [] }], actions: [] }, context, facts: [], context_labels: { fields: [], selection_kind: null }, created_at: "2026-11-14T01:00:00Z" }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function ask() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain this field" } });
  fireEvent.click(screen.getByRole("button", { name: /Send message|发送消息/ }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
}
it("uses English for a new conversation despite a stored Chinese account preference", async () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: /Open Rotation assistant/ }));
  await waitFor(() => expect(api.getPreferences).toHaveBeenCalled());
  await ask();
  expect(api.createConversation).toHaveBeenCalledWith({ language: "en", detail: "brief" });
});
it("updates an old conversation to the UI language before sending, even after a late Chinese page load", async () => {
  sessionStorage.setItem("field-shift:assistant:language-owner", "chat");
  let resolvePage!: (value: unknown) => void;
  api.getConversation.mockReturnValue(new Promise(resolve => { resolvePage = resolve; }));
  setup(); fireEvent.click(screen.getByRole("button", { name: /Open Rotation assistant/ }));
  fireEvent.change(screen.getByRole("combobox", { name: /Language/ }), { target: { value: "zh" } });
  fireEvent.change(screen.getByRole("combobox", { name: /Language/ }), { target: { value: "en" } });
  await act(async () => resolvePage({ id: "chat", language: "zh", detail: "brief", messages: [], next_before_sequence: null }));
  await ask();
  expect(api.setPreferences).toHaveBeenCalledWith({ language: "en", detail: "brief" }, "chat");
  expect(api.setPreferences.mock.invocationCallOrder[0]).toBeLessThan(api.sendMessage.mock.invocationCallOrder[0]);
});
it("preserves the question and does not send in the wrong language when preference update fails", async () => {
  sessionStorage.setItem("field-shift:assistant:language-owner", "chat");
  api.setPreferences.mockRejectedValue(new Error("Preference save failed"));
  setup(); fireEvent.click(screen.getByRole("button", { name: /Open Rotation assistant/ }));
  await waitFor(() => expect(screen.queryByText("Restoring conversation…")).not.toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this question" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Keep this question"));
  expect(api.sendMessage).not.toHaveBeenCalled();
});
