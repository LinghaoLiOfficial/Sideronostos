import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentWorkspace } from "./agent-workspace";
import { setLocale } from "@/lib/i18n/locale";

const api = vi.hoisted(() => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  getMessage: vi.fn(),
  getSource: vi.fn(),
  setPreferences: vi.fn(),
  listActions: vi.fn().mockResolvedValue({ items: [] }),
  listModuleOperations: vi.fn().mockResolvedValue({ items: [] }),
  listModuleOperationHistory: vi.fn().mockResolvedValue({ items: [] }),
  postModuleOperation: vi.fn(),
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
  window.history.replaceState({}, "", "/");
  setLocale("en");
  vi.clearAllMocks();
});

it("resizes the assistants panel with the keyboard and remembers its width", async () => {
  api.listConversations.mockResolvedValue({ items: [] });
  const user = userEvent.setup();
  const view = render(<AgentWorkspace />);
  const divider = await screen.findByRole("separator", { name: "Resize assistants panel" });
  const workspace = divider.closest("main") as HTMLElement;
  const before = Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10);

  await user.click(divider);
  await user.keyboard("{ArrowRight}");
  const after = Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10);
  expect(after).toBeGreaterThan(before);
  expect(divider).toHaveAttribute("aria-valuenow", String(after));
  expect(localStorage.getItem("agrisata-assistant-panel-width")).toBe(String(after));

  view.unmount();
  render(<AgentWorkspace />);
  expect(await screen.findByRole("separator", { name: "Resize assistants panel" })).toHaveAttribute("aria-valuenow", String(after));
});

it("resizes the assistants panel when its divider is dragged", async () => {
  api.listConversations.mockResolvedValue({ items: [] });
  render(<AgentWorkspace />);
  const divider = await screen.findByRole("separator", { name: "Resize assistants panel" });
  const workspace = divider.closest("main") as HTMLElement;
  const before = Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10);
  Object.defineProperty(divider, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(divider, "releasePointerCapture", { configurable: true, value: vi.fn() });

  function pointer(type: string, x: number) {
    const event = Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x }), { pointerId: 1 });
    fireEvent(divider, event);
  }
  pointer("pointerdown", 400);
  pointer("pointermove", 520);
  expect(Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10)).toBeGreaterThan(before);
  pointer("pointerup", 520);
});

it("returns to the requested conversation instead of the most recent one", async () => {
  window.history.replaceState({}, "", "/si/multi-agent?conversation=chat-older1");
  const older = { id: "chat-older1", preset: "field_management", bot_id: "field-guide", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z" };
  const recent = { ...older, id: "chat-recent", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" };
  api.listConversations.mockResolvedValue({ items: [recent, older] });
  api.getConversation.mockImplementation(async (id: string) => ({ ...(id === older.id ? older : recent), messages: [], next_before_sequence: null }));
  render(<AgentWorkspace />);
  const history = await screen.findByRole("navigation", { name: "Conversations" });
  await waitFor(() => expect(within(history).getByRole("button", { name: /older1/ })).toHaveAttribute("aria-current", "page"));
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
  expect(await screen.findByRole("heading", { name: "Your SI assistants" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Agrisata home" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Language" })).not.toBeInTheDocument();
  const identities = screen.getByRole("navigation", { name: "Bot identities" });
  expect(identities.children).toHaveLength(5);
  for (const name of ["All farm tasks", "Field management", "Remote sensing", "Local agriculture", "Crop rotation"]) {
    expect(within(identities).getByRole("group", { name }).parentElement).toBe(identities);
  }
  expect(within(identities).getByRole("button", { name: "Field guide" })).toBeInTheDocument();
  expect(within(identities).getAllByRole("button")).toHaveLength(7);
  await user.click(within(identities).getByRole("button", { name: "Water specialist" }));
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
  await screen.findByRole("heading", { name: "Your SI assistants" });
  const identities = screen.getByRole("navigation", { name: "Bot identities" });
  expect(within(within(identities).getByRole("group", { name: "Remote sensing" })).getAllByRole("button")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Soil specialist" }));
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith({ preset: "remote_sensing", bot_id: "remote-soil", language: "en", detail: "brief" }));
  expect(screen.getByRole("heading", { name: "Soil specialist" })).toBeInTheDocument();
});

it("keeps multiple chat sessions available for the same assistant", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  const first = { id: "field-1", bot_id: "field-guide", preset: "field_management", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" };
  const second = { ...first, id: "field-2", created_at: "2026-11-14T09:00:00Z", updated_at: "2026-11-14T09:00:00Z" };
  api.createConversation.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  render(<AgentWorkspace />);
  await screen.findByRole("heading", { name: "Your SI assistants" });
  const create = screen.getByRole("button", { name: "New chat" });
  const history = screen.getByRole("navigation", { name: "Conversations" });

  await user.click(create);
  await waitFor(() => expect(within(history).getAllByRole("button")).toHaveLength(1));
  await waitFor(() => expect(create).toBeEnabled());
  await user.click(create);

  await waitFor(() => expect(within(history).getAllByRole("button", { name: /Field guide/ })).toHaveLength(2));
  const titles = within(history).getAllByRole("button").map((button) => button.querySelector("span")?.textContent);
  expect(new Set(titles).size).toBe(2);
  expect(titles.every((title) => title?.startsWith("Field guide · Nov 14 · "))).toBe(true);
  expect(api.createConversation).toHaveBeenCalledTimes(2);
  expect(api.createConversation).toHaveBeenNthCalledWith(2, {
    preset: "field_management", bot_id: "field-guide", language: "en", detail: "brief",
  });
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
  await user.click(screen.getByRole("button", { name: "Field guide" }));
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

it("lets a farmer choose a supported follow-up from a retrieved answer", async () => {
  const chat = { id: "water-choices", bot_id: "remote-water", preset: "remote_sensing", language: "en", detail: "brief", kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z" };
  const message = { id: "message-choices", sequence: 1, client_message_id: "client-choices", status: "complete", text: "Check water conditions", context: { page: "map", revision: 1 }, context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null }, response: { paragraphs: [{ text: "Available demo data", evidence_ids: [] }], actions: [], needs_clarification: false, suggestions: ["2024 rainfall"] }, facts: [], error_code: null, created_at: "2026-11-14T08:00:00Z", completed_at: "2026-11-14T08:00:01Z" };
  api.listConversations.mockResolvedValue({ items: [chat] });
  api.getConversation.mockResolvedValue({ ...chat, messages: [message], next_before_sequence: null });
  api.sendMessage.mockResolvedValue({ ...message, id: "message-followup", sequence: 2, text: "2024 rainfall", response: { paragraphs: [{ text: "1049.312467 mm", evidence_ids: [] }], actions: [], needs_clarification: false } });
  render(<AgentWorkspace />);
  await userEvent.click(await screen.findByRole("button", { name: "2024 rainfall" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("water-choices", expect.objectContaining({ text: "2024 rainfall" })));
  expect(await screen.findByText("1049.312467 mm")).toBeInTheDocument();
});

it("opens a cited knowledge source from the main assistant workspace", async () => {
  const user = userEvent.setup();
  const chat = {
    id: "field-1", preset: "field_management", language: "en", detail: "brief",
    kb_release_id: "kb", created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z",
  };
  api.listConversations.mockResolvedValue({ items: [chat] });
  api.getConversation.mockResolvedValue({ ...chat, messages: [{
    id: "message-1", sequence: 1, client_message_id: "client-1", status: "complete",
    text: "How do I prepare soil?", context: { page: "map", revision: 1 },
    context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
    response: { paragraphs: [{ text: "Start with a soil test.", evidence_ids: ["E1"] }], actions: [], needs_clarification: false },
    facts: [], error_code: null, created_at: "2026-11-13T08:00:00Z", completed_at: "2026-11-13T08:00:01Z",
  }], next_before_sequence: null });
  api.getSource.mockResolvedValue({
    id: "E1", release_id: "kb", chunk_id: "chunk-1", page: 1,
    excerpt: "A soil test helps guide preparation.",
    source: { id: "source-1", title: "Soil preparation guide", url: "https://example.org/soil", access_scope: "public", locator_type: "section", regions: [], limitations: [], sha256: "hash" },
    claims: [],
  });

  render(<AgentWorkspace />);
  await user.click(await screen.findByRole("button", { name: "View source E1" }));
  expect(await screen.findByText("A soil test helps guide preparation.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.org/soil");
});

it("keeps Chinese after a reload and labels local prices and varieties as mock", async () => {
  const user = userEvent.setup();
  api.listConversations.mockResolvedValue({ items: [] });
  setLocale("zh-CN");
  const first = render(<AgentWorkspace />);
  await screen.findByRole("heading", { name: /你的助手|Your SI assistants/ });
  expect(localStorage.getItem("agrisata-locale")).toBe("zh-CN");
  first.unmount();
  render(<AgentWorkspace />);
  await user.click(await screen.findByRole("button", { name: "本地知识助手" }));
  expect(await screen.findByText(/价格与品种数据为模拟数据/)).toBeInTheDocument();
});

it("recovers the conversation list after a temporary load failure", async () => {
  const user = userEvent.setup();
  api.listConversations.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce({ items: [] });
  render(<AgentWorkspace />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.queryByRole("heading", { name: "Your SI assistants" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Message Field guide" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Your SI assistants" })).toBeInTheDocument();
  expect(screen.getByText("No conversations yet")).toBeInTheDocument();
});

it("renders a late load failure in the currently selected language", async () => {
  let fail!: (error: Error) => void;
  api.listConversations.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  setLocale("zh-CN");
  render(<AgentWorkspace />);
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
