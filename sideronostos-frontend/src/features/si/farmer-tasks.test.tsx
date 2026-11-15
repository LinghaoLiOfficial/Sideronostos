import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerTasks } from "./farmer-tasks";

const field = { id: "field-7", name: "North meadow", area_ha: 4, latitude: 35, longitude: -90,
  soil_texture: "loam", irrigation_available: true, profile_id: "demo", history: [], version: 3,
  created_at: "2026-01-01", updated_at: "2026-01-01" };
const calls: { path: string; body: Record<string, unknown> }[] = [];
let emptyFields = false;
let emptyRuns = false;
let actionFailure = false;
const props = { conversationId: "chat", ensureConversation: async () => "chat", userId: "owner",
  botId: "field-guide", language: "en" as const, onAsk: vi.fn() };

beforeEach(() => {
  calls.length = 0; emptyFields = false; emptyRuns = false; actionFailure = false;
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, options?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    calls.push({ path, body });
    let data: unknown = { items: [] };
    if (path === "/field-shift/fields") data = { items: emptyFields ? [] : [field] };
    if (path === "/field-shift/profiles") data = { items: [{ id: "demo", name: "Crop example", is_demo: true, crops: [] }] };
    if (path === "/agri-data/selections") data = { id: "selection-2", revision: 3, geometry: body.geometry };
    if (path.endsWith("/actions") && options?.method === "POST") {
      data = { status: actionFailure ? "failed" : "succeeded", action: body.action, text: actionFailure ? "Please correct the inputs and try again." : "Confirmed by the server.", missing_fields: [], pending: null,
        result: body.action === "field.create" ? { id: "field-new", name: "East field" } : { value: 0, unit: "mm", limitations: ["Historical observations only."] },
        href: body.action === "field.create" ? "/field-shift?field=field-new&step=field" : "/si/field-management?selection=selection-2" };
    }
    if (path === "/rotation-optimizer/runs") data = { items: emptyRuns ? [] : [{ id: "run-1", status: "running", created_at: "2026-11-01T00:00:00Z", field_snapshots: [field], request: {}, result: null }] };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});

it("shows the confirmed failure reason while keeping the observation inputs", async () => {
  actionFailure = true;
  const user = userEvent.setup();
  render(<FarmerTasks {...props} botId="remote-water" />);
  await user.click(screen.getByRole("button", { name: "Check water conditions" }));
  await user.selectOptions(await screen.findByLabelText("Which field?"), "field-7");
  await user.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText("Please correct the inputs and try again.")).toBeInTheDocument();
  expect(screen.getByLabelText("Which field?")).toHaveValue("field-7");
});

it("does not offer progress refresh before the first calculation", async () => {
  emptyRuns = true;
  render(<FarmerTasks {...props} botId="rotation-guide" />);
  await userEvent.click(screen.getByRole("button", { name: "My calculations" }));
  expect(await screen.findByText(/No calculations yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Start a new plan" })).toHaveAttribute("href", "/si/fields?step=planning");
  expect(screen.queryByRole("button", { name: "Refresh progress" })).not.toBeInTheDocument();
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("opens field creation and saved planting plans in their published workspaces", () => {
  render(<FarmerTasks {...props} />);
  expect(screen.getByRole("link", { name: "Add a field" })).toHaveAttribute("href", "/si/fields?field=new&step=field");
  expect(screen.getByRole("link", { name: "My planting plans" })).toHaveAttribute("href", "/si/fields?step=saved");
  expect(screen.queryByRole("button", { name: "Add a field" })).not.toBeInTheDocument();
});

it("opens field editing and history in the same published field page", async () => {
  render(<FarmerTasks {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "My fields" }));
  expect(await screen.findByRole("link", { name: "Edit details" })).toHaveAttribute("href", "/si/fields?field=field-7&step=field");
  expect(screen.getByRole("link", { name: "Planting history" })).toHaveAttribute("href", "/si/fields?field=field-7&step=field");
});

it("hides unfinished comparison and map actions", () => {
  const rotation = render(<FarmerTasks {...props} botId="rotation-guide" />);
  expect(screen.queryByRole("button", { name: "Compare saved plans" })).not.toBeInTheDocument();
  rotation.unmount();
  render(<FarmerTasks {...props} botId="remote-water" />);
  expect(screen.queryByRole("button", { name: "Explore observation maps" })).not.toBeInTheDocument();
});

it("opens the local knowledge workspace instead of a second question form", () => {
  render(<FarmerTasks {...props} botId="local-knowledge-guide" />);
  expect(screen.getByRole("link", { name: "Ask about my area" })).toHaveAttribute("href", "/si/local-knowledge");
  expect(screen.queryByRole("button", { name: "Ask about my area" })).not.toBeInTheDocument();
});

it("lets a farmer choose a saved field by name and opens its actual page", async () => {
  render(<FarmerTasks {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "My fields" }));
  expect(await screen.findByRole("link", { name: "Open North meadow" })).toHaveAttribute("href", "/si/fields?field=field-7&step=field");
  expect(screen.queryByText(/GET \/|POST \/|analysis_id/)).not.toBeInTheDocument();
});

it.each([
  ["remote-water", "Check water conditions", "Rainfall", "rainfall_total"],
  ["remote-soil", "Check soil moisture", "Surface soil moisture", "surface_soil_moisture"],
  ["remote-weather", "Check past weather", "Rainfall", "rainfall_total"],
])("uses a named field and the scoped observation action for %s", async (botId, task, label, metric) => {
  const user = userEvent.setup();
  render(<FarmerTasks {...props} botId={botId} />);
  await user.click(screen.getByRole("button", { name: task }));
  await user.selectOptions(await screen.findByLabelText("Which field?"), "field-7");
  const metrics = screen.getByLabelText("What would you like to check?");
  await user.selectOptions(metrics, metric);
  expect(within(metrics).getByRole("option", { name: label })).toBeInTheDocument();
  if (botId === "remote-soil") expect(within(metrics).queryByRole("option", { name: "Rainfall" })).not.toBeInTheDocument();
  if (botId === "remote-weather") expect(within(metrics).queryByRole("option", { name: "Surface soil moisture" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("From"), "2026-01-01");
  await user.type(screen.getByLabelText("To"), "2026-01-07");
  await user.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText("0 mm")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open observation map" })).not.toBeInTheDocument();
  expect(screen.getByText("0 mm")).toBeInTheDocument();
  expect(calls.find((c) => c.path === "/agri-data/selections")?.body).toMatchObject({ geometry: { type: "Point", coordinates: [-90, 35] } });
  expect(calls.find((c) => c.body.action === "remote_sensing.fact")?.body.arguments).toMatchObject({ selection_id: "selection-2", metric, start: "2026-01-01", end: "2026-01-07" });
});

it("explains the no-field state with a working way to add one", async () => {
  emptyFields = true;
  render(<FarmerTasks {...props} botId="remote-soil" />);
  await userEvent.click(screen.getByRole("button", { name: "Check soil moisture" }));
  expect(await screen.findByRole("link", { name: "Add your first field" })).toHaveAttribute("href", "/si/fields?field=new&step=field");
  expect(screen.queryByRole("textbox", { name: /ID/ })).not.toBeInTheDocument();
});

it("distinguishes running calculations from completed plans and offers progress", async () => {
  render(<FarmerTasks {...props} botId="rotation-guide" />);
  await userEvent.click(screen.getByRole("button", { name: "My calculations" }));
  expect(await screen.findByText("Calculating")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View and manage calculation" })).toBeInTheDocument();
  expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
});

it("keeps the new-plan link out of a calculation's save form", async () => {
  const base = fetch;
  vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
    if (new URL(String(url)).pathname === "/rotation-optimizer/runs") return Response.json({ items: [{ id: "run-1", status: "succeeded", created_at: "2026-11-01T00:00:00Z", field_snapshots: [field], request: {}, result: { options: [{ id: "option-1", label: "Plan A", feasible: true, complete: true }] } }] });
    return base(url, init);
  });
  render(<FarmerTasks {...props} botId="rotation-guide" />);
  await userEvent.click(screen.getByRole("button", { name: "My calculations" }));
  expect(await screen.findByRole("link", { name: "Start a new plan" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "View and manage calculation" }));
  expect(await screen.findByRole("button", { name: "Save this plan" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Start a new plan" })).not.toBeInTheDocument();
});

it("requires an explicit stop confirmation and never presents an accepted cancellation as completion", async () => {
  const base = fetch;
  let writes = 0;
  vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/operations") && init?.method === "POST") {
      writes++;
      return Response.json({ status: "pending", operation_id: "cancel", result: { status: "cancel_requested" }, href: "/field-shift/rotation?run=run-1" });
    }
    if (path.endsWith("/operations")) return Response.json({ items: [{ operation_id: "cancel", method: "POST", path: "/rotation-optimizer/runs/{run_id}/cancel" }] });
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<FarmerTasks {...props} botId="rotation-guide" />);
  await user.click(screen.getByRole("button", { name: "My calculations" }));
  await user.click(await screen.findByRole("button", { name: "View and manage calculation" }));
  await user.click(screen.getByRole("button", { name: "Cancel calculation" }));
  expect(writes).toBe(0);
  await user.click(screen.getByRole("button", { name: "Keep calculating" }));
  expect(writes).toBe(0);
  await user.click(screen.getByRole("button", { name: "Cancel calculation" }));
  await user.click(screen.getByRole("button", { name: "Stop calculation" }));
  expect(await screen.findByText(/Stopping this calculation/)).toBeInTheDocument();
  expect(writes).toBe(1);
  expect(screen.getByText(/Stopping this calculation/)).toBeInTheDocument();
  expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
});
