import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentWorkspace } from "./agent-workspace";

const api = vi.hoisted(() => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  getMessage: vi.fn(),
  getSource: vi.fn(),
  setPreferences: vi.fn(),
  listActions: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("./agent-api", () => api);
vi.mock("@/lib/api/client", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "farmer-1", email: "farmer@example.test", display_name: "Ava", email_verified: true,
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

it("creates a conversation in the chosen domain and keeps it selectable in history", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  api.createConversation.mockResolvedValue({
    id: "remote-1", preset: "remote_sensing", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
  });
  api.getConversation.mockResolvedValue({
    id: "remote-1", preset: "remote_sensing", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
    messages: [], next_before_sequence: null,
  });
  render(<AgentWorkspace />);
  expect(await screen.findByRole("heading", { name: "Your assistants" })).toBeInTheDocument();
  for (const name of ["Field management", "Remote sensing", "Local agriculture", "Crop rotation"]) {
    expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("button", { name: /Remote sensing/ }));
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith({
    preset: "remote_sensing", bot_id: "remote-water", language: "en", detail: "brief",
  }));
  expect(await screen.findByRole("heading", { name: "Water specialist" })).toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Conversations" })).getByRole("button", { name: /Water specialist/ })).toBeInTheDocument();
});

it("creates a conversation for the selected specialist identity", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  api.createConversation.mockResolvedValue({ id: "soil-1", bot_id: "remote-soil", preset: "remote_sensing", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" });
  render(<AgentWorkspace />);
  await screen.findByRole("heading", { name: "Your assistants" });
  await user.click(screen.getByRole("button", { name: "Soil specialist" }));
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith({ preset: "remote_sensing", bot_id: "remote-soil", language: "en", detail: "brief" }));
  expect(screen.getByRole("heading", { name: "Soil specialist" })).toBeInTheDocument();
});

it("keeps history separate for water and soil specialists in the same module", async () => {
  const user = userEvent.setup();
  const water = { id: "water-1", bot_id: "remote-water", preset: "remote_sensing", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" };
  const soil = { ...water, id: "soil-1", bot_id: "remote-soil", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z" };
  api.listConversations.mockResolvedValue({ items: [water, soil] });
  api.getConversation.mockImplementation(async (id: string) => ({ ...(id === water.id ? water : soil), messages: [], next_before_sequence: null }));
  render(<AgentWorkspace />);
  const history = await screen.findByRole("navigation", { name: "Conversations" });
  await waitFor(() => expect(within(history).getAllByRole("button")).toHaveLength(1));
  expect(within(history).getByRole("button", { name: /Water specialist/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Soil specialist" }));
  expect(within(history).getByRole("button", { name: /Soil specialist/ })).toBeInTheDocument();
  expect(within(history).queryByRole("button", { name: /Water specialist/ })).not.toBeInTheDocument();
});

it("shows only the selected domain's conversation history", async () => {
  const user = userEvent.setup();
  const first = { id: "remote-1", preset: "remote_sensing", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" };
  const second = { ...first, id: "field-1", preset: "field_management", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z" };
  api.listConversations.mockResolvedValue({ items: [first, second] });
  api.getConversation.mockImplementation(async (id: string) => ({ ...(id === first.id ? first : second), messages: [], next_before_sequence: null }));
  render(<AgentWorkspace />);
  const history = await screen.findByRole("navigation", { name: "Conversations" });
  await waitFor(() => expect(within(history).getAllByRole("button")).toHaveLength(1));
  expect(within(history).getByRole("button", { name: /Water specialist/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Field management/ }));
  expect(within(history).getByRole("button", { name: /Field guide/ })).toBeInTheDocument();
  expect(within(history).queryByRole("button", { name: /Water specialist/ })).not.toBeInTheDocument();
});

it("restores an existing conversation and submits its message to that conversation", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [{
    id: "field-1", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z",
  }] });
  api.getConversation.mockResolvedValue({
    id: "field-1", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z",
    messages: [], next_before_sequence: null,
  });
  api.sendMessage.mockResolvedValue({
    id: "message-1", sequence: 1, client_message_id: "client-1", status: "complete",
    text: "How is my field?", context: { page: "map", revision: 1 },
    context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
    response: { paragraphs: [{ text: "I can help with your field.", evidence_ids: [] }], actions: [], needs_clarification: false },
    facts: [], error_code: null, created_at: "2026-11-14T08:00:00Z", completed_at: "2026-11-14T08:00:01Z",
  });
  render(<AgentWorkspace />);
  const composer = await screen.findByRole("textbox", { name: "Message Field guide" });
  await user.type(composer, "How is my field?");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("field-1", expect.objectContaining({ text: "How is my field?" })));
  expect(await screen.findByText("I can help with your field.")).toBeInTheDocument();
});

it("keeps Chinese after a reload and labels local prices and varieties as mock", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  api.setPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  const first = render(<AgentWorkspace />);
  await screen.findByRole("heading", { name: "Your assistants" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh-CN");
  expect(localStorage.getItem("agrisata-locale")).toBe("zh-CN");
  first.unmount();
  render(<AgentWorkspace />);
  expect(await screen.findByText(/价格与品种数据为模拟数据/)).toBeInTheDocument();
});

it("recovers the conversation list after a temporary load failure", async () => {
  const user = userEvent.setup();
  api.listConversations.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce({ items: [] });
  render(<AgentWorkspace />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Your assistants" })).toBeInTheDocument();
  expect(screen.getByText("No conversations yet")).toBeInTheDocument();
});

it("renders a late load failure in the currently selected language", async () => {
  const user = userEvent.setup();
  let fail!: (error: Error) => void;
  api.listConversations.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  api.setPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  render(<AgentWorkspace />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh-CN");
  await act(async () => fail(new Error("offline")));
  expect(await screen.findByRole("alert")).toHaveTextContent("发生错误。草稿已保留。");
});

it("keeps the first reply when an empty-chat load finishes late", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  api.createConversation.mockResolvedValue({
    id: "new-field", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
  });
  let finishLoad!: (value: unknown) => void;
  api.getConversation.mockReturnValue(new Promise((resolve) => { finishLoad = resolve; }));
  api.sendMessage.mockResolvedValue({
    id: "message-1", sequence: 1, client_message_id: "client-1", status: "complete",
    text: "Tell me about my field", context: { page: "map", revision: 1 },
    context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
    response: { paragraphs: [{ text: "Here is your field.", evidence_ids: [] }], actions: [], needs_clarification: false },
    facts: [], error_code: null, created_at: "2026-11-14T08:00:00Z", completed_at: "2026-11-14T08:00:01Z",
  });
  render(<AgentWorkspace />);
  const composer = await screen.findByRole("textbox", { name: "Message Field guide" });
  await user.type(composer, "Tell me about my field");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Here is your field.")).toBeInTheDocument();
  await act(async () => finishLoad({
    id: "new-field", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
    messages: [], next_before_sequence: null,
  }));
  expect(screen.getByText("Here is your field.")).toBeInTheDocument();
});

it("uses a new idempotency key when a failed message is edited", async () => {
  const user = userEvent.setup();
  const chat = {
    id: "field-1", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
  };
  api.listConversations.mockResolvedValue({ items: [chat] });
  api.getConversation.mockResolvedValue({ ...chat, messages: [], next_before_sequence: null });
  api.sendMessage.mockRejectedValueOnce(new Error("lost connection")).mockResolvedValueOnce({
    id: "message-2", sequence: 1, client_message_id: "client-2", status: "complete",
    text: "Corrected text", context: { page: "map", revision: 1 },
    context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
    response: { paragraphs: [{ text: "Confirmed reply", evidence_ids: [] }], actions: [], needs_clarification: false },
    facts: [], error_code: null, created_at: "2026-11-14T08:00:00Z", completed_at: "2026-11-14T08:00:01Z",
  });
  render(<AgentWorkspace />);
  const composer = await screen.findByRole("textbox", { name: "Message Field guide" });
  await user.type(composer, "Original text");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("alert");
  await user.clear(composer);
  await user.type(composer, "Corrected text");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Confirmed reply")).toBeInTheDocument();
  const first = api.sendMessage.mock.calls[0][1].client_message_id;
  const second = api.sendMessage.mock.calls[1][1].client_message_id;
  expect(first).not.toBe(second);
});
