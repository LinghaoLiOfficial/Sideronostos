import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { botsForModule } from "@/lib/bot-catalog";
import { MultiBotDock } from "./MultiBotDock";

const api = vi.hoisted(() => ({
  listConversations: vi.fn(), createConversation: vi.fn(), getConversation: vi.fn(),
  sendMessage: vi.fn(), getMessage: vi.fn(), getSource: vi.fn(), setPreferences: vi.fn(),
  listModuleOperations: vi.fn(), listModuleOperationHistory: vi.fn(), postModuleOperation: vi.fn(),
  listActions: vi.fn(), getAction: vi.fn(), postAction: vi.fn(),
}));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/features/si/agent-api", () => api);
vi.mock("@/lib/api/client", () => auth);

const conversation = (id: string, bot_id: string) => ({
  id, bot_id, preset: "remote_sensing", language: "en", detail: "brief",
  kb_release_id: "kb", created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T08:00:00Z",
});
const message = (id: string, text: string, status: "complete" | "pending" | "failed" = "complete") => ({
  id, sequence: 1, client_message_id: "client-1", status, text,
  context: { page: "map", revision: 1 },
  context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null },
  response: status === "complete" ? { paragraphs: [{ text: "Water reading is unavailable.", evidence_ids: ["source-1"] }], actions: [], needs_clarification: false } : null,
  facts: [], error_code: status === "failed" ? "upstream_failed" : null,
  created_at: "2026-11-14T08:00:00Z", completed_at: status === "pending" ? null : "2026-11-14T08:00:01Z",
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  });
  auth.getCurrentUser.mockResolvedValue({ id: "farmer-1", email: "farmer@example.test", display_name: "Ava", email_verified: true });
  api.listConversations.mockResolvedValue({ items: [] });
  api.setPreferences.mockResolvedValue({ language: "zh", detail: "brief" });
  api.listModuleOperations.mockResolvedValue({ items: [] });
  api.listModuleOperationHistory.mockResolvedValue({ items: [] });
  api.listActions.mockResolvedValue({ items: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("keeps stable catalog identities across the four module routes", () => {
  expect(botsForModule("remote-sensing").map((bot) => bot.id)).toEqual(["remote-water", "remote-soil", "remote-weather"]);
  expect(botsForModule("field-management").map((bot) => bot.id)).toEqual(["field-guide"]);
  expect(botsForModule("local-knowledge").map((bot) => bot.id)).toEqual(["local-knowledge-guide"]);
  expect(botsForModule("rotation-recommendation").map((bot) => bot.id)).toEqual(["rotation-guide"]);
});

it("loads only the chosen bot's authenticated conversation and restores focus on collapse", async () => {
  api.listConversations.mockResolvedValue({ items: [conversation("soil-1", "remote-soil"), conversation("water-1", "remote-water"), conversation("legacy", "")] });
  api.getConversation.mockImplementation(async (id: string) => ({
    ...conversation(id, id === "water-1" ? "remote-water" : "remote-soil"),
    messages: [message(id + "-message", id === "water-1" ? "Water question" : "Soil question")], next_before_sequence: null,
  }));
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Water specialist" }));
  expect(await screen.findByText("Water question")).toBeVisible();
  expect(screen.queryByText("Soil question")).not.toBeInTheDocument();
  expect(api.getConversation).toHaveBeenCalledWith("water-1");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("button", { name: "Open Water specialist" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Open Soil specialist" }));
  expect(await screen.findByText("Soil question")).toBeVisible();
  expect(screen.queryByText("Water question")).not.toBeInTheDocument();
});

it("updates only the active bot conversation language when the UI locale changes", async () => {
  api.listConversations.mockResolvedValue({ items: [conversation("water-1", "remote-water")] });
  api.getConversation.mockResolvedValue({ ...conversation("water-1", "remote-water"), messages: [], next_before_sequence: null });
  const { rerender } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await screen.findByRole("textbox", { name: "Message Water specialist" });
  rerender(<MultiBotDock module="remote-sensing" locale="zh-CN" />);
  await waitFor(() => expect(api.setPreferences).toHaveBeenCalledWith({ language: "zh", detail: "brief" }, "water-1"));
  expect(screen.getByRole("textbox", { name: "给水分助手留言" })).toBeInTheDocument();
});

it("creates a scoped conversation, sends, and shows the server reply and source", async () => {
  const user = userEvent.setup();
  api.createConversation.mockResolvedValue(conversation("water-1", "remote-water"));
  api.sendMessage.mockResolvedValue(message("message-1", "How wet is this field?"));
  api.getSource.mockResolvedValue({ id: "source-1", label: "Soil moisture", display: "No current observation", value: null, unit: "", key: "moisture", source: {}, limitations: [] });
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await screen.findByRole("textbox", { name: "Message Water specialist" });
  await user.type(screen.getByRole("textbox"), "How wet is this field?");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith({ preset: "remote_sensing", bot_id: "remote-water", language: "en", detail: "brief" }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("water-1", expect.objectContaining({ text: "How wet is this field?" })));
  expect(await screen.findByText("Water reading is unavailable.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /View source/ }));
  expect(await screen.findByText("No current observation")).toBeVisible();
});

it("opens a module API from a fresh field specialist chat and returns the completed page", async () => {
  const user = userEvent.setup();
  const fieldChat = { ...conversation("field-1", "field-guide"), preset: "field_management" };
  api.createConversation.mockResolvedValue(fieldChat);
  api.listModuleOperations.mockResolvedValue({ items: [{
    operation_id: "list_fields", title: "List fields", method: "GET", path: "/field-shift/fields",
    path_parameters: [], query_parameters: [], required_query_parameters: [], body: null,
    body_required: false, required_body_parameters: [], required_inputs: [],
  }] });
  api.postModuleOperation.mockResolvedValue({
    status: "succeeded", operation_id: "list_fields", text: "Fields are ready.",
    missing_inputs: [], status_code: 200, result: { items: [{ id: "north" }] },
    content_type: "application/json", href: "/field-shift",
  });
  render(<MultiBotDock module="field-management" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Field guide" }));
  await user.click(await screen.findByRole("button", { name: "Use module tools" }));
  expect(api.createConversation).toHaveBeenCalledWith({ preset: "field_management", bot_id: "field-guide", language: "en", detail: "brief" });
  await user.click(await screen.findByText(/Module operations/));
  await user.click(screen.getByRole("button", { name: "Run operation" }));
  await waitFor(() => expect(api.postModuleOperation).toHaveBeenCalledWith("field-1", expect.objectContaining({ operation_id: "list_fields" })));
  expect(await screen.findByRole("link", { name: "Open result" })).toHaveAttribute("href", "/field-shift");
});

it("opens cited web search results from the source panel", async () => {
  const user = userEvent.setup();
  api.createConversation.mockResolvedValue(conversation("water-1", "remote-water"));
  api.sendMessage.mockResolvedValue(message("message-1", "Find current water guidance"));
  api.getSource.mockResolvedValue({
    id: "source-1",
    release_id: "mock-release",
    chunk_id: "web-chunk",
    page: 1,
    excerpt: "External guidance snippet",
    source: {
      id: "web-remote-water-1",
      title: "NASA water guidance",
      url: "https://earthdata.nasa.gov/example",
      access_scope: "web_snapshot",
      locator_type: "section",
      regions: ["external"],
      limitations: ["Verify the linked source."],
      sha256: "",
    },
    claims: [],
  });
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await user.type(await screen.findByRole("textbox", { name: "Message Water specialist" }), "Find current guidance");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Water reading is unavailable.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /View source/ }));
  const link = await screen.findByRole("link", { name: "Open source" });
  expect(link).toHaveAttribute("href", "https://earthdata.nasa.gov/example");
  expect(link).toHaveAttribute("target", "_blank");
});

it("explains when the backend has no published knowledge release", async () => {
  const user = userEvent.setup();
  api.createConversation.mockRejectedValue({ status: 503 });
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await user.type(await screen.findByRole("textbox", { name: "Message Water specialist" }), "Explain this area");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("published knowledge base is not ready");
  expect(screen.getByRole("textbox")).toHaveValue("Explain this area");
});

it("polls a pending response and reports a failed reply honestly", async () => {
  const user = userEvent.setup();
  api.createConversation.mockResolvedValue(conversation("water-1", "remote-water"));
  api.sendMessage.mockResolvedValue(message("message-1", "Question", "pending"));
  api.getMessage.mockResolvedValue(message("message-1", "Question", "failed"));
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await screen.findByRole("textbox");
  await user.type(screen.getByRole("textbox"), "Question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText(/Working on your request/)).toBeVisible();
  await waitFor(() => expect(api.getMessage).toHaveBeenCalledWith("water-1", "message-1"), { timeout: 2500 });
  expect(await screen.findByRole("alert")).toHaveTextContent("This reply could not be completed");
});

it("distinguishes a failed refresh from a failed send after the server accepted a message", async () => {
  const user = userEvent.setup();
  api.createConversation.mockResolvedValue(conversation("water-1", "remote-water"));
  api.sendMessage.mockResolvedValue(message("message-1", "Question", "pending"));
  api.getMessage.mockRejectedValue(new Error("offline"));
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await screen.findByRole("textbox");
  await user.type(screen.getByRole("textbox"), "Question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert", {}, { timeout: 2500 })).toHaveTextContent("Reply status could not be refreshed");
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(api.sendMessage).toHaveBeenCalledTimes(1);
});

it("keeps a draft after a send error and lets the user retry", async () => {
  const user = userEvent.setup();
  api.createConversation.mockResolvedValue(conversation("water-1", "remote-water"));
  api.sendMessage.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(message("message-1", "Question"));
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  await user.click(screen.getByRole("button", { name: "Open Water specialist" }));
  await screen.findByRole("textbox");
  await user.type(screen.getByRole("textbox"), "Question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is safe");
  expect(screen.getByRole("textbox")).toHaveValue("Question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Water reading is unavailable.")).toBeVisible();
  expect(api.createConversation).toHaveBeenCalledTimes(1);
  expect(api.sendMessage.mock.calls[0][1].client_message_id).toBe(api.sendMessage.mock.calls[1][1].client_message_id);
});

it("shows sign-in instead of loading private history when unauthenticated", async () => {
  auth.getCurrentUser.mockRejectedValue({ status: 401 });
  render(<MultiBotDock module="field-management" locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Field guide" }));
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fsi%2Ffield-management&authRequired=1");
  expect(api.listConversations).not.toHaveBeenCalled();
});

it("expands the cluster and preserves localized accessible controls", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const { container, rerender } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  const dock = container.querySelector("[data-multi-bot-dock]")!;
  const cluster = container.querySelector("[data-bot-cluster]")!;
  fireEvent.pointerEnter(cluster, { pointerType: "mouse" });
  expect(dock).toHaveAttribute("data-expanded", "true");
  fireEvent.pointerLeave(cluster, { pointerType: "mouse" });
  expect(dock).toHaveAttribute("data-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "3 specialists. Expand" }));
  expect(screen.getByText("Water")).toHaveAttribute("aria-hidden", "false");
  rerender(<MultiBotDock module="remote-sensing" locale="zh-CN" />);
  expect(screen.getByText("水分")).toHaveAttribute("aria-hidden", "false");
  fireEvent.click(screen.getByRole("button", { name: "打开天气助手" }));
  expect(screen.getByRole("dialog", { name: "天气助手" })).toBeVisible();
});
