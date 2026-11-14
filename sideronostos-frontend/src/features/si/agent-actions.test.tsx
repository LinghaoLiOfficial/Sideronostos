import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentActions } from "./agent-actions";

const api = vi.hoisted(() => ({ postAction: vi.fn(), getAction: vi.fn(), listActions: vi.fn() }));
const field = vi.hoisted(() => ({ listProfiles: vi.fn() }));
const rotation = vi.hoisted(() => ({ listLayers: vi.fn() }));
vi.mock("./agent-api", () => api);
vi.mock("@/lib/api/field-shift", () => field);
vi.mock("@/lib/api/rotation", () => rotation);

beforeEach(() => { api.listActions.mockResolvedValue({ items: [] }); });
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it("continues a field creation with the same key and opens only the confirmed result", async () => {
  const user = userEvent.setup();
  field.listProfiles.mockResolvedValue({ items: [{ id: "demo", name: "Demo profile" }] });
  api.postAction.mockResolvedValueOnce({ status: "needs_input", action: "field.create", text: "Please provide: name, area_ha.", missing_fields: ["name", "area_ha"], pending: { arguments: {} }, result: null, href: null })
    .mockResolvedValueOnce({ status: "succeeded", action: "field.create", text: "Field created.", missing_fields: [], pending: null, result: { id: "4c4d54e7-9450-4f31-ae48-5893098d690e" }, href: "/field-shift?field=4c4d54e7-9450-4f31-ae48-5893098d690e&step=field" });
  render(<AgentActions conversationId="chat-1" ensureConversation={async () => "chat-1"} domain="field_management" language="en" userId="owner-1" />);
  await user.click(screen.getByRole("button", { name: "Create field" }));
  expect(await screen.findByText(/Please provide/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open result" })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "Field name" }), "North plot");
  await user.type(screen.getByRole("spinbutton", { name: "Area (ha)" }), "2");
  await user.type(screen.getByRole("spinbutton", { name: "Latitude" }), "35");
  await user.type(screen.getByRole("spinbutton", { name: "Longitude" }), "-90");
  await user.selectOptions(screen.getByRole("combobox", { name: "Profile" }), "demo");
  await user.click(screen.getByRole("button", { name: "Continue action" }));
  await waitFor(() => expect(api.postAction).toHaveBeenCalledTimes(2));
  expect(api.postAction.mock.calls[0][1].idempotency_key).toBe(api.postAction.mock.calls[1][1].idempotency_key);
  expect(api.postAction.mock.calls[1][1].arguments).toEqual(expect.objectContaining({ name: "North plot", area_ha: 2, latitude: 35, longitude: -90, profile_id: "demo", history: [] }));
  expect(await screen.findByRole("link", { name: "Open result" })).toHaveAttribute("href", "/field-shift?field=4c4d54e7-9450-4f31-ae48-5893098d690e&step=field");
});

it("offers published layers and preserves an unfinished action after refresh", async () => {
  const user = userEvent.setup();
  rotation.listLayers.mockResolvedValue({ items: [{ id: "water-layer", title: "Water layer" }] });
  api.postAction.mockResolvedValue({ status: "needs_input", action: "remote_sensing.layer", text: "Please provide: layer_id.", missing_fields: ["layer_id"], pending: { arguments: {} }, result: null, href: null });
  api.getAction.mockResolvedValue({ status: "needs_input", action: "remote_sensing.layer", text: "Please provide: layer_id.", missing_fields: ["layer_id"], pending: { arguments: {} }, result: null, href: null });
  const props = { conversationId: "chat-2", ensureConversation: async () => "chat-2", domain: "remote_sensing" as const, language: "en" as const, userId: "owner-1" };
  const first = render(<AgentActions {...props} />);
  await user.click(screen.getByRole("button", { name: "Open published layer" }));
  expect(await screen.findByRole("combobox", { name: "Published layer" })).toBeInTheDocument();
  const key = api.postAction.mock.calls[0][1].idempotency_key;
  first.unmount();
  render(<AgentActions {...props} />);
  await waitFor(() => expect(api.getAction).toHaveBeenCalledWith("chat-2", key));
  expect(await screen.findByRole("combobox", { name: "Published layer" })).toBeInTheDocument();
});

it("never renders an unconfirmed action URL", async () => {
  const user = userEvent.setup();
  rotation.listLayers.mockResolvedValue({ items: [] });
  api.postAction.mockResolvedValue({ status: "unavailable", action: "remote_sensing.layer", text: "No layer available.", missing_fields: [], pending: null, result: null, href: "/evil" });
  render(<AgentActions conversationId="chat-3" ensureConversation={async () => "chat-3"} domain="remote_sensing" language="en" userId="owner-1" />);
  await user.click(screen.getByRole("button", { name: "Open published layer" }));
  expect(await screen.findByText("No layer available.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open result" })).not.toBeInTheDocument();
});

it("restores the newest pending action from the owned server history", async () => {
  rotation.listLayers.mockResolvedValue({ items: [{ id: "water-layer", title: "Water layer" }] });
  api.listActions.mockResolvedValue({ items: [{ idempotency_key: "saved-key", outcome: { status: "needs_input", action: "remote_sensing.layer", text: "Please provide: layer_id.", missing_fields: ["layer_id"], pending: { arguments: {} }, result: null, href: null } }] });
  render(<AgentActions conversationId="chat-4" ensureConversation={async () => "chat-4"} domain="remote_sensing" language="en" userId="owner-1" />);
  expect(await screen.findByRole("combobox", { name: "Published layer" })).toBeInTheDocument();
  expect(localStorage.getItem("agrisata-action:owner-1:chat-4")).toBe("saved-key");
});

it("offers each remote specialist only its supported actions and observations", async () => {
  const user = userEvent.setup();
  api.postAction.mockResolvedValue({ status: "needs_input", action: "remote_sensing.fact", text: "Please provide a selection.", missing_fields: ["selection_id"], pending: { arguments: {} }, result: null, href: null });
  const common = { conversationId: "chat-5", ensureConversation: async () => "chat-5", domain: "remote_sensing" as const, language: "en" as const, userId: "owner-1" };
  const weather = render(<AgentActions {...common} botId="remote-weather" />);
  expect(screen.queryByRole("button", { name: "Open published layer" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Find published observation" }));
  const weatherMetrics = screen.getByRole("combobox", { name: "Observation" });
  expect(within(weatherMetrics).queryByRole("option", { name: "Surface soil moisture" })).not.toBeInTheDocument();
  expect(within(weatherMetrics).getByRole("option", { name: "Rainfall total" })).toBeInTheDocument();
  weather.unmount();
  localStorage.clear();
  render(<AgentActions {...common} botId="remote-soil" />);
  await user.click(screen.getByRole("button", { name: "Find published observation" }));
  const soilMetrics = screen.getByRole("combobox", { name: "Observation" });
  expect(within(soilMetrics).getByRole("option", { name: "Surface soil moisture" })).toBeInTheDocument();
  expect(within(soilMetrics).queryByRole("option", { name: "Rainfall total" })).not.toBeInTheDocument();
});
