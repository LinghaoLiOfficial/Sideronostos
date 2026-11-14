import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerTasks } from "./farmer-tasks";

const field = { id: "field-7", name: "North meadow", area_ha: 4, latitude: 35, longitude: -90,
  soil_texture: "loam", irrigation_available: true, profile_id: "demo", history: [], version: 3,
  created_at: "2026-01-01", updated_at: "2026-01-01" };
const calls: { path: string; body: Record<string, unknown> }[] = [];
let failWrite = false;
let emptyFields = false;
const props = { conversationId: "chat", ensureConversation: async () => "chat", userId: "owner",
  botId: "field-guide", language: "en" as const, onAsk: vi.fn() };

beforeEach(() => {
  calls.length = 0; failWrite = false; emptyFields = false;
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, options?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    calls.push({ path, body });
    let data: unknown = { items: [] };
    if (path === "/field-shift/fields") data = { items: emptyFields ? [] : [field] };
    if (path === "/field-shift/profiles") data = { items: [{ id: "demo", name: "Crop example", is_demo: true, crops: [] }] };
    if (path === "/agri-data/selections") data = { id: "selection-2", revision: 3, geometry: body.geometry };
    if (path.endsWith("/actions") && options?.method === "POST") {
      if (failWrite) { failWrite = false; throw new TypeError("Network lost"); }
      data = { status: "succeeded", action: body.action, text: "Confirmed by the server.", missing_fields: [], pending: null,
        result: body.action === "field.create" ? { id: "field-new", name: "East field" } : { value: 0, unit: "mm", limitations: ["Historical observations only."] },
        href: body.action === "field.create" ? "/field-shift?field=field-new&step=field" : "/field-shift/map?selection=selection-2" };
    }
    if (path === "/rotation-optimizer/runs") data = { items: [{ id: "run-1", status: "running", created_at: "2026-11-01T00:00:00Z", field_snapshots: [field], request: {}, result: null }] };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("lets a farmer choose a saved field by name and opens its actual page", async () => {
  render(<FarmerTasks {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "My fields" }));
  expect(await screen.findByRole("link", { name: "Open North meadow" })).toHaveAttribute("href", "/field-shift?field=field-7&step=field");
  expect(screen.queryByText(/GET \/|POST \/|analysis_id/)).not.toBeInTheDocument();
});

it("preserves field input and retries an uncertain creation with the same key", async () => {
  const user = userEvent.setup();
  const view = render(<FarmerTasks {...props} />);
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  await user.type(await screen.findByLabelText("Field name"), "East field");
  await user.type(screen.getByLabelText("Area (ha)"), "2");
  await user.type(screen.getByLabelText("Latitude"), "35");
  await user.type(screen.getByLabelText("Longitude"), "-90");
  await user.selectOptions(screen.getByLabelText("Crop settings"), "demo");
  failWrite = true;
  await user.click(screen.getByRole("button", { name: "Save field" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/confirm|connection/i);
  expect(screen.queryByRole("link", { name: "Open saved field" })).not.toBeInTheDocument();
  view.unmount();
  render(<FarmerTasks {...props} />);
  expect(await screen.findByLabelText("Field name")).toHaveValue("East field");
  await user.click(screen.getByRole("button", { name: /Check again/ }));
  expect(await screen.findByRole("link", { name: "Open saved field" })).toHaveAttribute("href", "/field-shift?field=field-new&step=field");
  const writes = calls.filter((c) => c.body.action === "field.create");
  expect(writes).toHaveLength(2);
  expect(writes[0].body.idempotency_key).toBe(writes[1].body.idempotency_key);
  expect(writes[1].body.arguments).toMatchObject({ name: "East field", area_ha: 2, latitude: 35, longitude: -90, profile_id: "demo" });
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
  expect(await screen.findByRole("link", { name: "Open observation map" })).toHaveAttribute("href", "/field-shift/map?selection=selection-2");
  expect(screen.getByText("0 mm")).toBeInTheDocument();
  expect(calls.find((c) => c.path === "/agri-data/selections")?.body).toMatchObject({ geometry: { type: "Point", coordinates: [-90, 35] } });
  expect(calls.find((c) => c.body.action === "remote_sensing.fact")?.body.arguments).toMatchObject({ selection_id: "selection-2", metric, start: "2026-01-01", end: "2026-01-07" });
});

it("explains the no-field state with a working way to add one", async () => {
  emptyFields = true;
  render(<FarmerTasks {...props} botId="remote-soil" />);
  await userEvent.click(screen.getByRole("button", { name: "Check soil moisture" }));
  expect(await screen.findByRole("link", { name: "Add your first field" })).toHaveAttribute("href", "/field-shift?field=new&step=field");
  expect(screen.queryByRole("textbox", { name: /ID/ })).not.toBeInTheDocument();
});

it("distinguishes running calculations from completed plans and offers progress", async () => {
  render(<FarmerTasks {...props} botId="rotation-guide" />);
  await userEvent.click(screen.getByRole("button", { name: "My calculations" }));
  expect(await screen.findByText("Calculating")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute("href", "/field-shift/rotation?run=run-1");
  expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
});

it("asks local knowledge with the farmer's region and crop, without implying live prices", async () => {
  const user = userEvent.setup();
  render(<FarmerTasks {...props} botId="local-knowledge-guide" />);
  await user.click(screen.getByRole("button", { name: "Ask about my area" }));
  await user.type(screen.getByLabelText("Region or nearest town"), "Nakuru, Kenya");
  await user.type(screen.getByLabelText("Crop"), "Maize");
  await user.type(screen.getByLabelText("Your question"), "Which planting dates should I consider?");
  await user.click(screen.getByRole("button", { name: "Ask local knowledge" }));
  await waitFor(() => expect(props.onAsk).toHaveBeenCalledWith(expect.stringContaining("Nakuru, Kenya")));
  expect(props.onAsk.mock.calls[0][0]).toContain("Maize");
  expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
});

it("edits the selected owned field with its version and preserves its planting history", async () => {
  const base = fetch;
  const writes: Record<string, unknown>[] = [];
  const history = [{ year: 2025, crop_id: "maize" }];
  let savedField = { ...field, history };
  vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/field-shift/fields") return Response.json({ items: [savedField] });
    if (path.endsWith("/operations") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      savedField = { ...savedField, area_ha: 5, version: savedField.version + 1 };
      return Response.json({ status: "succeeded", operation_id: "edit", text: "Saved", result: savedField, href: "/field-shift?field=field-7&step=field" });
    }
    if (path.endsWith("/operations")) return Response.json({ items: [{ operation_id: "edit", method: "PATCH", path: "/field-shift/fields/{field_id}" }] });
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<FarmerTasks {...props} />);
  await user.click(screen.getByRole("button", { name: "My fields" }));
  await user.click(await screen.findByRole("button", { name: "Edit details" }));
  const area = await screen.findByLabelText("Area (ha)");
  await user.clear(area); await user.type(area, "5");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("link", { name: "Open saved field" })).toHaveAttribute("href", "/field-shift?field=field-7&step=field");
  expect(writes[0]).toMatchObject({ path_params: { field_id: "field-7" }, body: { area_ha: 5, expected_version: 3, history } });
  await user.click(screen.getByRole("button", { name: "Back to my fields" }));
  await user.click(await screen.findByRole("button", { name: "Edit details" }));
  expect(await screen.findByLabelText("Area (ha)")).toHaveValue(5);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toMatchObject({ body: { expected_version: 4 } });
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
  await user.click(await screen.findByRole("button", { name: "Manage this calculation" }));
  await user.click(screen.getByRole("button", { name: "Cancel calculation" }));
  expect(writes).toBe(0);
  await user.click(screen.getByRole("button", { name: "Keep calculating" }));
  expect(writes).toBe(0);
  await user.click(screen.getByRole("button", { name: "Cancel calculation" }));
  await user.click(screen.getByRole("button", { name: "Stop calculation" }));
  expect(await screen.findByRole("link", { name: "View progress" })).toHaveAttribute("href", "/field-shift/rotation?run=run-1");
  expect(writes).toBe(1);
  expect(screen.getByText(/Stopping this calculation/)).toBeInTheDocument();
  expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
});

it("keeps local input for retry after a send failure", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn().mockRejectedValue(new Error("offline"));
  render(<FarmerTasks {...props} botId="local-knowledge-guide" onAsk={onAsk} />);
  await user.click(screen.getByRole("button", { name: "Ask about my area" }));
  await user.type(screen.getByLabelText("Region or nearest town"), "Nakuru");
  await user.type(screen.getByLabelText("Crop"), "Maize");
  await user.type(screen.getByLabelText("Your question"), "Which local sources are available?");
  await user.click(screen.getByRole("button", { name: "Ask local knowledge" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your input is kept");
  expect(screen.getByLabelText("Region or nearest town")).toHaveValue("Nakuru");
});

it("isolates unfinished forms by account and conversation", async () => {
  const user = userEvent.setup();
  const first = render(<FarmerTasks {...props} />);
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  await user.type(await screen.findByLabelText("Field name"), "Private field draft");
  first.unmount();
  render(<FarmerTasks {...props} userId="another-owner" />);
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  expect(await screen.findByLabelText("Field name")).toHaveValue("");
});
