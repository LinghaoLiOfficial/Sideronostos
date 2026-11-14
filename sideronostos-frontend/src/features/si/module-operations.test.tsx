import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModuleOperations } from "./module-operations";

const api = vi.hoisted(() => ({ listModuleOperations: vi.fn(), listModuleOperationHistory: vi.fn(), postModuleOperation: vi.fn() }));
vi.mock("./agent-api", () => api);

beforeEach(() => { api.listModuleOperationHistory.mockResolvedValue({ items: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("restores the last completed result link after reopening a conversation", async () => {
  api.listModuleOperations.mockResolvedValue({ items: [] });
  api.listModuleOperationHistory.mockResolvedValue({ items: [{
    idempotency_key: "prior-1", outcome: {
      status: "succeeded", operation_id: "create_field", text: "Your field is ready.",
      missing_inputs: [], status_code: 201, result: { id: "field-7", name: "North field" },
      content_type: "application/json", href: "/field-shift?field=field-7&step=field",
    },
  }] });
  render(<ModuleOperations conversationId="chat-restored" language="en" />);
  await userEvent.setup().click(await screen.findByText(/Module operations/));
  expect(await screen.findByRole("link", { name: "Open result" })).toHaveAttribute("href", "/field-shift?field=field-7&step=field");
  expect(screen.getByText("North field")).toBeInTheDocument();
});

it("collects required API inputs, reports missing information, and opens a completed module result", async () => {
  const user = userEvent.setup();
  api.listModuleOperations.mockResolvedValue({ items: [{
    operation_id: "get_field", method: "GET", path: "/field-shift/fields/{field_id}",
    path_parameters: ["field_id"], query_parameters: [], required_query_parameters: [],
    body: null, body_required: false, required_body_parameters: [], required_inputs: ["field_id"],
  }] });
  api.postModuleOperation.mockResolvedValueOnce({
    status: "needs_input", operation_id: "get_field", text: "Please provide field_id",
    missing_inputs: ["field_id"], status_code: null, result: null, content_type: null, href: null,
  }).mockResolvedValueOnce({
    status: "succeeded", operation_id: "get_field", text: "Operation completed.",
    missing_inputs: [], status_code: 200, result: { id: "field-7" }, content_type: "application/json",
    href: "/field-shift?field=field-7&step=field",
  });
  render(<ModuleOperations conversationId="chat-1" language="en" />);
  await user.click(await screen.findByText(/Module operations/));
  await user.click(screen.getByRole("button", { name: "Run operation" }));
  expect(await screen.findByText("Please provide field_id")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "field_id *" }), "field-7");
  await user.click(screen.getByRole("button", { name: "Run operation" }));
  await waitFor(() => expect(api.postModuleOperation).toHaveBeenCalledTimes(2));
  expect(api.postModuleOperation.mock.calls[1][1]).toEqual(expect.objectContaining({
    operation_id: "get_field", path_params: { field_id: "field-7" },
  }));
  expect(await screen.findByRole("link", { name: "Open result" })).toHaveAttribute("href", "/field-shift?field=field-7&step=field");
});

it("does not render an unsafe result URL", async () => {
  const user = userEvent.setup();
  api.listModuleOperations.mockResolvedValue({ items: [{
    operation_id: "list_profiles", method: "GET", path: "/field-shift/profiles",
    path_parameters: [], query_parameters: [], required_query_parameters: [], body: null,
    body_required: false, required_body_parameters: [], required_inputs: [],
  }] });
  api.postModuleOperation.mockResolvedValue({
    status: "succeeded", operation_id: "list_profiles", text: "Completed", missing_inputs: [],
    status_code: 200, result: [], content_type: "application/json", href: "//evil.example",
  });
  render(<ModuleOperations conversationId="chat-2" language="en" />);
  await user.click(await screen.findByText(/Module operations/));
  await user.click(screen.getByRole("button", { name: "Run operation" }));
  expect(await screen.findByText("Completed")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open result" })).not.toBeInTheDocument();
});

it("shows a progress link for an accepted job without a completion screenshot", async () => {
  const user = userEvent.setup();
  api.listModuleOperations.mockResolvedValue({ items: [{
    operation_id: "create_run", method: "POST", path: "/rotation-optimizer/runs",
    path_parameters: [], query_parameters: [], required_query_parameters: [], body: null,
    body_required: false, required_body_parameters: [], required_inputs: [],
  }] });
  api.postModuleOperation.mockResolvedValue({
    status: "pending", operation_id: "create_run", text: "Your task is underway.",
    missing_inputs: [], status_code: 202, result: { id: "run-1" },
    content_type: "application/json", href: "/field-shift/rotation?run=run-1",
  });
  render(<ModuleOperations conversationId="chat-3" language="en" />);
  await user.click(await screen.findByText(/Module operations/));
  await user.click(screen.getByRole("button", { name: "Run operation" }));
  expect(await screen.findByRole("link", { name: "View progress" })).toHaveAttribute("href", "/field-shift/rotation?run=run-1");
  expect(screen.queryByRole("img", { name: "Completed task screenshot" })).not.toBeInTheDocument();
});
